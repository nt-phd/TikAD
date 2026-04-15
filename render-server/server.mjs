/**
 * LaTeX render server
 * POST /render  { latex: string }  → { svg: string } | { error: string }
 *
 * Production protections:
 * - bounded queue
 * - bounded concurrency
 * - in-memory LRU cache
 * - inflight deduplication
 * - request body limit
 * - input complexity limits
 * - explicit subprocess timeouts/kills
 */

import http from 'http';
import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const PORT = Number.parseInt(process.env.PORT ?? '3737', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const REQUEST_BODY_LIMIT = 256 * 1024;
const MAX_CONCURRENT_RENDERS = 2;
const MAX_QUEUE_LENGTH = 32;
const CACHE_LIMIT = 100;
const MAX_LATEX_LENGTH = 20_000;
const MAX_LATEX_LINES = 400;
const MAX_TIKZ_TOKENS = 300;
const PDFLATEX_TIMEOUT_MS = 12_000;
const PDF2SVG_TIMEOUT_MS = 8_000;

// Rate limiting: grace period on first visit, then sliding window
const RATE_GRACE_MS = 30 * 1000;        // 30 seconds free on first request
const RATE_WINDOW_MS = 60 * 1000;       // sliding window duration
const RATE_MAX = 30;                     // max renders per window after grace

/** @type {Map<string, { firstSeen: number, windowStart: number, count: number }>} */
const ipRateMap = new Map();

// Periodically evict stale entries to avoid unbounded growth
setInterval(() => {
  const cutoff = Date.now() - Math.max(RATE_GRACE_MS, RATE_WINDOW_MS) * 2;
  for (const [ip, state] of ipRateMap) {
    if (state.firstSeen < cutoff) ipRateMap.delete(ip);
  }
}, 5 * 60 * 1000);

function checkRateLimit(ip) {
  const now = Date.now();
  let state = ipRateMap.get(ip);
  if (!state) {
    state = { firstSeen: now, windowStart: now, count: 0 };
    ipRateMap.set(ip, state);
  }
  // Still within grace period — allow freely
  if (now - state.firstSeen < RATE_GRACE_MS) return null;
  // Reset sliding window if it has expired
  if (now - state.windowStart >= RATE_WINDOW_MS) {
    state.windowStart = now;
    state.count = 0;
  }
  if (state.count >= RATE_MAX) {
    const retryAfter = Math.ceil((state.windowStart + RATE_WINDOW_MS - now) / 1000);
    return retryAfter;
  }
  state.count += 1;
  return null;
}

const inflight = new Map();
const resultCache = new Map();
const queue = [];

const metrics = {
  cacheHits: 0,
  cacheMisses: 0,
  completed: 0,
  deduped: 0,
  queueRejected: 0,
  running: 0,
  timeouts: 0,
  totalRequests: 0,
};

const LATEX_WRAPPER = (src) => {
  if (src.includes('\\documentclass')) return src;
  return `\\documentclass[tikz,border=2pt]{standalone}
\\usepackage{circuitikz}
\\begin{document}
${src}
\\end{document}
`;
};

function normalizePictureEnvironmentForRender(src) {
  return src
    .replace(/\\begin\{circuitikz\}(\s*\[[^\]]*\])?/g, '\\begin{tikzpicture}$1')
    .replace(/\\end\{circuitikz\}/g, '\\end{tikzpicture}');
}

function log(event, details = {}) {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...details }));
}

function touchCache(key, value) {
  if (resultCache.has(key)) resultCache.delete(key);
  resultCache.set(key, value);
  while (resultCache.size > CACHE_LIMIT) {
    const oldestKey = resultCache.keys().next().value;
    resultCache.delete(oldestKey);
  }
}

function getCached(key) {
  const value = resultCache.get(key);
  if (!value) return null;
  touchCache(key, value);
  return value;
}

function withinComplexityLimits(latex) {
  if (latex.length > MAX_LATEX_LENGTH) return `latex too large (${latex.length} chars)`;
  const lines = latex.split('\n').length;
  if (lines > MAX_LATEX_LINES) return `latex has too many lines (${lines})`;
  const tikzTokens = (latex.match(/\\(?:draw|node|path|coordinate|ctikzset)\b/g) ?? []).length;
  if (tikzTokens > MAX_TIKZ_TOKENS) return `latex too complex (${tikzTokens} tikz tokens)`;
  return null;
}

function runCommand(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      metrics.timeouts += 1;
      child.kill('SIGKILL');
      if (!settled) {
        settled = true;
        reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      if (code === 0) {
        settled = true;
        resolve({ stdout, stderr });
        return;
      }
      settled = true;
      reject(new Error(stderr || stdout || `${cmd} failed with code ${code ?? 'null'} signal ${signal ?? 'none'}`));
    });
  });
}

async function renderLatex(latexBody) {
  const dir = await mkdtemp(join(tmpdir(), 'circuitikz-'));
  const startedAt = Date.now();
  try {
    const texFile = join(dir, 'circuit.tex');
    const normalizedSource = normalizePictureEnvironmentForRender(LATEX_WRAPPER(latexBody));
    await writeFile(texFile, normalizedSource, 'utf8');

    const compileStartedAt = Date.now();
    await runCommand('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'circuit.tex'], dir, PDFLATEX_TIMEOUT_MS);
    const compileMs = Date.now() - compileStartedAt;

    const svgStartedAt = Date.now();
    await runCommand('pdf2svg', ['circuit.pdf', 'circuit.svg', '1'], dir, PDF2SVG_TIMEOUT_MS);
    const svgMs = Date.now() - svgStartedAt;

    const svg = await readFile(join(dir, 'circuit.svg'), 'utf8');
    const match = svg.match(/transform="matrix\(1,\s*0,\s*0,\s*-1,\s*([\d.+-]+),\s*([\d.+-]+)\)"/);
    const tx = match ? parseFloat(match[1]) : 0;
    const ty = match ? parseFloat(match[2]) : 0;
    const totalMs = Date.now() - startedAt;
    log('render_success', { compileMs, svgBytes: svg.length, svgMs, totalMs });
    return { svg, tx, ty };
  } catch (err) {
    let detail = err.message;
    try {
      const logFile = await readFile(join(dir, 'circuit.log'), 'utf8');
      const lines = logFile.split('\n');
      const errorLines = lines.filter((line) => line.startsWith('!') || line.includes('Error'));
      detail = errorLines.slice(0, 8).join('\n') || logFile.slice(-1200);
    } catch {
      // Keep original detail.
    }
    log('render_error', { detail });
    return { error: detail };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function drainQueue() {
  while (metrics.running < MAX_CONCURRENT_RENDERS && queue.length > 0) {
    const task = queue.shift();
    if (!task) return;
    metrics.running += 1;
    task()
      .finally(() => {
        metrics.running -= 1;
        drainQueue();
      });
  }
}

function enqueueRender(cacheKey, latex) {
  const cached = getCached(cacheKey);
  if (cached) {
    metrics.cacheHits += 1;
    return Promise.resolve(cached);
  }
  metrics.cacheMisses += 1;

  const existing = inflight.get(cacheKey);
  if (existing) {
    metrics.deduped += 1;
    return existing;
  }

  if (queue.length >= MAX_QUEUE_LENGTH) {
    metrics.queueRejected += 1;
    return Promise.resolve({ error: 'render queue is full, retry later' });
  }

  const promise = new Promise((resolve) => {
    queue.push(async () => {
      const result = await renderLatex(latex);
      if (!result.error) touchCache(cacheKey, result);
      inflight.delete(cacheKey);
      metrics.completed += 1;
      resolve(result);
    });
    drainQueue();
  });

  inflight.set(cacheKey, promise);
  return promise;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, {
      cacheEntries: resultCache.size,
      inflight: inflight.size,
      ok: true,
      queueLength: queue.length,
      running: metrics.running,
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/metrics') {
    sendJson(res, 200, {
      ...metrics,
      cacheEntries: resultCache.size,
      inflight: inflight.size,
      queueLength: queue.length,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/render') {
    metrics.totalRequests += 1;
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() ?? req.socket.remoteAddress ?? 'unknown';
    let body = '';
    let tooLarge = false;
    for await (const chunk of req) {
      body += chunk;
      if (body.length > REQUEST_BODY_LIMIT) {
        tooLarge = true;
        break;
      }
    }

    if (tooLarge) {
      sendJson(res, 413, { error: 'request body too large' });
      return;
    }

    try {
      const { latex } = JSON.parse(body);
      if (!latex || typeof latex !== 'string') throw new Error('missing latex field');
      const complexityError = withinComplexityLimits(latex);
      if (complexityError) {
        sendJson(res, 422, { error: complexityError });
        return;
      }

      // Cache hits are free — check rate limit only for real renders
      if (!getCached(latex) && !inflight.has(latex)) {
        const retryAfter = checkRateLimit(ip);
        if (retryAfter !== null) {
          res.setHeader('Retry-After', String(retryAfter));
          sendJson(res, 429, { error: 'rate limit exceeded, retry later' });
          return;
        }
      }

      const result = await enqueueRender(latex, latex);
      sendJson(res, result.error ? 422 : 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, HOST, () => {
  log('server_started', { host: HOST, port: PORT });
});
