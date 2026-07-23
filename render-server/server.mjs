/**
 * LaTeX render server
 * POST /render  { latex: string, anchors?: AnchorRequest[], purpose?: string, forceRender?: boolean }
 *   → { svg: string, measuredPoints?: RenderSymbolPoint[], measuredBounds?: RenderComponentBounds[] } | { error: string }
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
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { mkdtemp, writeFile, readFile, rm, access } from 'fs/promises';
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
  downloadRequests: 0,
  downloadSvgPlusRequests: 0,
  previewRequests: 0,
  queueRejected: 0,
  running: 0,
  timeouts: 0,
  totalRequests: 0,
};

const RENDER_PURPOSES = new Set(['preview', 'download-svg', 'download-svg-plus']);

function normalizeRenderPurpose(value) {
  return RENDER_PURPOSES.has(value) ? value : 'preview';
}

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

function normalizeAnchorRequests(anchors) {
  if (!Array.isArray(anchors)) return [];
  const normalized = [];
  const seen = new Set();
  for (const entry of anchors) {
    if (!entry || typeof entry !== 'object') continue;
    const nodeName = typeof entry.nodeName === 'string' ? entry.nodeName.trim() : '';
    const anchor = typeof entry.anchor === 'string' ? entry.anchor.trim() : 'reference';
    if (!/^[A-Za-z][\w-]*$/.test(nodeName)) continue;
    if (!anchor || anchor.length > 80 || /[{}\\;]/.test(anchor)) continue;
    const key = anchor === 'reference' ? nodeName : `${nodeName}.${anchor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const componentId = typeof entry.componentId === 'string' ? entry.componentId.trim() : '';
    const defId = typeof entry.defId === 'string' ? entry.defId.trim() : '';
    const kind = entry.kind === 'pin' || entry.kind === 'anchor' ? entry.kind : 'reference';
    const role = typeof entry.role === 'string' ? entry.role.trim().slice(0, 80) : '';
    const names = Array.isArray(entry.names)
      ? entry.names
          .filter((value) => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value && value.length <= 80 && !/[{}\\;]/.test(value))
      : [anchor];
    normalized.push({
      key,
      nodeName,
      anchor,
      componentId,
      defId,
      kind,
      names: names.length > 0 ? names : [anchor],
      role,
      snap: Boolean(entry.snap),
      ghost: Boolean(entry.ghost),
    });
    if (normalized.length >= 600) break;
  }
  return normalized;
}

function buildAnchorProbeSource(latexBody, anchors) {
  if (anchors.length === 0) return null;
  let source = normalizePictureEnvironmentForRender(LATEX_WRAPPER(latexBody));
  const pointProbes = anchors.map((anchor, index) => ({
    ...anchor,
    id: `p${index}`,
  }));
  const boundsByNode = [];
  const seenBounds = new Set();
  for (const anchor of anchors) {
    if (seenBounds.has(anchor.nodeName)) continue;
    seenBounds.add(anchor.nodeName);
    boundsByNode.push({
      key: anchor.nodeName,
      nodeName: anchor.nodeName,
      componentId: anchor.componentId,
      defId: anchor.defId,
    });
  }
  const boundsProbes = boundsByNode.map((bound, index) => ({ ...bound, id: `b${index}` }));
  const macroDefs = `
\\usetikzlibrary{fit}
\\newcommand{\\tikadProbePoint}[2]{%
  \\path let \\p1=(#2) in \\pgfextra{%
    \\pgfmathsetmacro{\\tikadX}{\\x1/1cm}%
    \\pgfmathsetmacro{\\tikadY}{\\y1/1cm}%
    \\typeout{TIKAD_POINT|#1|\\tikadX|\\tikadY}%
  };%
}
\\newcommand{\\tikadProbeNodePointSafe}[2]{%
  \\begingroup
  \\def\\tikadNode{#2}%
  \\ifcsname pgf@sh@ns@\\tikadNode\\endcsname
    \\tikadProbePoint{#1}{#2}%
  \\else
    \\typeout{TIKAD_SKIP|#1|point|#2|node-not-found}%
  \\fi
  \\endgroup
}
\\newcommand{\\tikadProbePointSafe}[3]{%
  \\begingroup
  \\def\\tikadNode{#2}%
  \\def\\tikadAnchor{#3}%
  \\ifcsname pgf@sh@ns@\\tikadNode\\endcsname
    \\edef\\tikadShapeName{\\csname pgf@sh@ns@\\tikadNode\\endcsname}%
    \\ifcsname pgf@anchor@\\tikadShapeName @\\tikadAnchor\\endcsname
      \\tikadProbePoint{#1}{#2.#3}%
    \\else
      \\ifcsname pgf@anchor@generic@\\tikadAnchor\\endcsname
        \\tikadProbePoint{#1}{#2.#3}%
      \\else
        \\typeout{TIKAD_SKIP|#1|point|#2.#3|anchor-not-found}%
      \\fi
    \\fi
  \\else
    \\typeout{TIKAD_SKIP|#1|point|#2.#3|node-not-found}%
  \\fi
  \\endgroup
}
\\newcommand{\\tikadProbeBounds}[2]{%
  \\node[fit=(#2),inner sep=0pt,outer sep=0pt,draw=none] (tikadFit#1) {};
  \\path let \\p1=(tikadFit#1.south west), \\p2=(tikadFit#1.north east) in \\pgfextra{%
    \\pgfmathsetmacro{\\tikadXSW}{\\x1/1cm}%
    \\pgfmathsetmacro{\\tikadYSW}{\\y1/1cm}%
    \\pgfmathsetmacro{\\tikadXNE}{\\x2/1cm}%
    \\pgfmathsetmacro{\\tikadYNE}{\\y2/1cm}%
    \\typeout{TIKAD_BOUNDS|#1|\\tikadXSW|\\tikadYSW|\\tikadXNE|\\tikadYNE}%
  };%
}
\\newcommand{\\tikadProbeBoundsSafe}[2]{%
  \\begingroup
  \\def\\tikadNode{#2}%
  \\ifcsname pgf@sh@ns@\\tikadNode\\endcsname
    \\tikadProbeBounds{#1}{#2}%
  \\else
    \\typeout{TIKAD_SKIP|#1|bounds|#2|node-not-found}%
  \\fi
  \\endgroup
}
`.trim();
  const documentIndex = source.indexOf('\\begin{document}');
  if (documentIndex >= 0) {
    source = `${source.slice(0, documentIndex)}${macroDefs}\n${source.slice(documentIndex)}`;
  } else {
    source = `${macroDefs}\n${source}`;
  }

  const pointLines = pointProbes
    .map((probe) => {
      const target = probe.anchor === 'reference' ? probe.nodeName : `${probe.nodeName}.${probe.anchor}`;
      return [
        `\\typeout{TIKAD_PROBE_TARGET|${probe.id}|${target}}`,
        probe.anchor === 'reference'
          ? `\\tikadProbeNodePointSafe{${probe.id}}{${probe.nodeName}}`
          : `\\tikadProbePointSafe{${probe.id}}{${probe.nodeName}}{${probe.anchor}}`,
      ].join('\n');
    })
    .join('\n');
  const boundsLines = boundsProbes
    .map((probe) => {
      return [
        `\\typeout{TIKAD_BOUNDS_TARGET|${probe.id}|${probe.nodeName}}`,
        `\\tikadProbeBoundsSafe{${probe.id}}{${probe.nodeName}}`,
      ].join('\n');
    })
    .join('\n');
  const endToken = '\\end{tikzpicture}';
  const endIndex = source.lastIndexOf(endToken);
  if (endIndex < 0) return null;
  return {
    source: `${source.slice(0, endIndex)}${pointLines}\n${boundsLines}\n${source.slice(endIndex)}`,
    pointProbes,
    boundsProbes,
  };
}

function parseProbeResults(logText, probeContext) {
  const pointById = new Map();
  const boundsById = new Map();
  const probeTargetById = new Map();
  const skippedById = new Map();
  for (const rawLine of logText.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('TIKAD_')) continue;
    const pointMatch = /^TIKAD_POINT\|([^|]+)\|([^|]+)\|([^|]+)$/.exec(line);
    if (pointMatch) {
      const x = Number.parseFloat(pointMatch[2]);
      const y = Number.parseFloat(pointMatch[3]);
      if (Number.isFinite(x) && Number.isFinite(y)) pointById.set(pointMatch[1], { x, y });
      continue;
    }
    const boundsMatch = /^TIKAD_BOUNDS\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)$/.exec(line);
    if (boundsMatch) {
      const xSW = Number.parseFloat(boundsMatch[2]);
      const ySW = Number.parseFloat(boundsMatch[3]);
      const xNE = Number.parseFloat(boundsMatch[4]);
      const yNE = Number.parseFloat(boundsMatch[5]);
      if ([xSW, ySW, xNE, yNE].every(Number.isFinite)) boundsById.set(boundsMatch[1], { xSW, ySW, xNE, yNE });
      continue;
    }
    const targetMatch = /^TIKAD_PROBE_TARGET\|([^|]+)\|(.+)$/.exec(line);
    if (targetMatch) {
      probeTargetById.set(targetMatch[1], targetMatch[2]);
      continue;
    }
    const boundsTargetMatch = /^TIKAD_BOUNDS_TARGET\|([^|]+)\|(.+)$/.exec(line);
    if (boundsTargetMatch) {
      probeTargetById.set(boundsTargetMatch[1], boundsTargetMatch[2]);
      continue;
    }
    const skipMatch = /^TIKAD_SKIP\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)$/.exec(line);
    if (skipMatch) {
      skippedById.set(skipMatch[1], { kind: skipMatch[2], target: skipMatch[3], reason: skipMatch[4] });
    }
  }

  const measuredPoints = [];
  for (const probe of probeContext.pointProbes) {
    const coords = pointById.get(probe.id);
    if (!coords) continue;
    const names = probe.names?.length ? probe.names : [probe.anchor];
    for (const name of names) {
      const key = probe.kind === 'reference' || name === 'reference'
        ? probe.nodeName
        : `${probe.nodeName}.${name}`;
      measuredPoints.push({
        key,
        nodeName: probe.nodeName,
        anchor: name,
        componentId: probe.componentId,
        defId: probe.defId,
        kind: probe.kind,
        names: [...names],
        role: probe.role,
        snap: probe.snap,
        ghost: probe.ghost,
        point: { x: coords.x, y: -coords.y },
      });
    }
  }

  const measuredBounds = [];
  for (const probe of probeContext.boundsProbes) {
    const corners = boundsById.get(probe.id);
    if (!corners) continue;
    measuredBounds.push({
      componentId: probe.componentId,
      defId: probe.defId,
      nodeName: probe.nodeName,
      left: corners.xSW,
      top: -corners.yNE,
      width: corners.xNE - corners.xSW,
      height: corners.yNE - corners.ySW,
    });
  }

  const missingPointTargets = probeContext.pointProbes
    .filter((probe) => !pointById.has(probe.id) && !skippedById.has(probe.id))
    .map((probe) => probeTargetById.get(probe.id))
    .filter(Boolean);
  const missingBoundsTargets = probeContext.boundsProbes
    .filter((probe) => !boundsById.has(probe.id) && !skippedById.has(probe.id))
    .map((probe) => probeTargetById.get(probe.id))
    .filter(Boolean);
  const skippedPoints = probeContext.pointProbes
    .map((probe) => skippedById.get(probe.id))
    .filter((entry) => entry?.kind === 'point')
    .map((entry) => `${entry.target} (${entry.reason})`);
  const skippedBounds = probeContext.boundsProbes
    .map((probe) => skippedById.get(probe.id))
    .filter((entry) => entry?.kind === 'bounds')
    .map((entry) => `${entry.target} (${entry.reason})`);

  return {
    measuredPoints,
    measuredBounds,
    missingPointTargets,
    missingBoundsTargets,
    skippedPoints,
    skippedBounds,
  };
}

const domPurifyWindow = new JSDOM('').window;
const DOMPurify = createDOMPurify(domPurifyWindow);

DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  const attr = data.attrName.toLowerCase();
  if (attr === 'href' || attr === 'xlink:href') {
    const value = data.attrValue.trim();
    data.keepAttr = value.startsWith('#');
  }
});

function sanitizeSvg(svgText) {
  const sanitized = DOMPurify.sanitize(svgText, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'],
    FORBID_TAGS: [
      'script',
      'foreignObject',
      'iframe',
      'object',
      'embed',
      'audio',
      'video',
      'image',
      'animate',
      'set',
      'animateMotion',
      'animateTransform',
    ],
    FORBID_ATTR: [
      'style',
      'onload',
      'onclick',
      'onerror',
    ],
  }).trim();

  const svgMatches = sanitized.match(/<svg\b/gi) ?? [];
  if (svgMatches.length !== 1 || !/<\/svg>\s*$/i.test(sanitized)) {
    throw new Error('render produced malformed SVG root');
  }
  return normalizeRootSvgPhysicalSize(sanitized);
}

function normalizeRootSvgPhysicalSize(svgText) {
  const match = svgText.match(/<svg\b[^>]*\bwidth="([0-9.+-]+)"[^>]*\bheight="([0-9.+-]+)"/i);
  if (!match) return svgText;
  const width = Number.parseFloat(match[1]);
  const height = Number.parseFloat(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return svgText;
  return svgText
    .replace(/\bwidth="[0-9.+-]+"/i, `width="${width}pt"`)
    .replace(/\bheight="[0-9.+-]+"/i, `height="${height}pt"`);
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

function runCommandAllowFailure(cmd, args, cwd, timeoutMs) {
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
      settled = true;
      resolve({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

async function renderLatex(latexBody, anchors = [], purpose = 'preview') {
  const dir = await mkdtemp(join(tmpdir(), 'circuitikz-'));
  const startedAt = Date.now();
  try {
    const texFile = join(dir, 'circuit.tex');
    const probeContext = buildAnchorProbeSource(latexBody, anchors);
    const source = probeContext?.source ?? normalizePictureEnvironmentForRender(LATEX_WRAPPER(latexBody));
    await writeFile(texFile, source, 'utf8');

    const compileStartedAt = Date.now();
    const compileResult = await runCommandAllowFailure(
      'pdflatex',
      ['-interaction=nonstopmode', 'circuit.tex'],
      dir,
      PDFLATEX_TIMEOUT_MS,
    );
    const compileMs = Date.now() - compileStartedAt;
    const logText = await readFile(join(dir, 'circuit.log'), 'utf8').catch(() => '');
    const probeResults = probeContext ? parseProbeResults(logText, probeContext) : null;

    if (compileResult.code !== 0) {
      const pdfPath = join(dir, 'circuit.pdf');
      let hasPdf = false;
      try {
        await access(pdfPath);
        hasPdf = true;
      } catch {
        hasPdf = false;
      }
      if (!hasPdf) {
        throw new Error(compileResult.stderr || compileResult.stdout || `pdflatex failed with code ${compileResult.code}`);
      }
    }

    const svgStartedAt = Date.now();
    await runCommand('pdf2svg', ['circuit.pdf', 'circuit.svg', '1'], dir, PDF2SVG_TIMEOUT_MS);
    const svgMs = Date.now() - svgStartedAt;

    const measuredSvg = sanitizeSvg(await readFile(join(dir, 'circuit.svg'), 'utf8'));
    const match = measuredSvg.match(/transform="matrix\(1,\s*0,\s*0,\s*-1,\s*([\d.+-]+),\s*([\d.+-]+)\)"/);
    const tx = match ? parseFloat(match[1]) : 0;
    const ty = match ? parseFloat(match[2]) : 0;
    const totalMs = Date.now() - startedAt;
    log('render_success', { compileMs, purpose, svgBytes: measuredSvg.length, svgMs, totalMs });
    const result = { svg: measuredSvg, tx, ty };
    if (probeResults) {
      result.measuredPoints = probeResults.measuredPoints;
      result.measuredBounds = probeResults.measuredBounds;
      if (
        probeResults.skippedPoints.length > 0 ||
        probeResults.skippedBounds.length > 0 ||
        probeResults.missingPointTargets.length > 0 ||
        probeResults.missingBoundsTargets.length > 0
      ) {
        result.anchorError = [
          probeResults.skippedPoints.length > 0
            ? `skipped point probes: ${probeResults.skippedPoints.join(', ')}`
            : null,
          probeResults.skippedBounds.length > 0
            ? `skipped bounds probes: ${probeResults.skippedBounds.join(', ')}`
            : null,
          probeResults.missingPointTargets.length > 0
            ? `missing point probes: ${probeResults.missingPointTargets.join(', ')}`
            : null,
          probeResults.missingBoundsTargets.length > 0
            ? `missing bounds probes: ${probeResults.missingBoundsTargets.join(', ')}`
            : null,
        ].filter(Boolean).join(' | ');
      }
    }
    return result;
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
    log('render_error', { detail, purpose });
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

function enqueueRender(cacheKey, latex, anchors = [], purpose = 'preview', forceRender = false) {
  if (forceRender) {
    metrics.cacheMisses += 1;
    if (queue.length >= MAX_QUEUE_LENGTH) {
      metrics.queueRejected += 1;
      return Promise.resolve({ error: 'render queue is full, retry later' });
    }
    return new Promise((resolve) => {
      queue.push(async () => {
        const result = await renderLatex(latex, anchors, purpose);
        metrics.completed += 1;
        resolve(result);
      });
      drainQueue();
    });
  }

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
      const result = await renderLatex(latex, anchors, purpose);
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
      const { latex, anchors, purpose: rawPurpose, forceRender } = JSON.parse(body);
      if (!latex || typeof latex !== 'string') throw new Error('missing latex field');
      const purpose = normalizeRenderPurpose(rawPurpose);
      const anchorRequests = normalizeAnchorRequests(anchors);
      const shouldForceRender = Boolean(forceRender);
      const complexityError = withinComplexityLimits(latex);
      if (complexityError) {
        sendJson(res, 422, { error: complexityError });
        return;
      }

      if (purpose === 'download-svg') metrics.downloadRequests += 1;
      else if (purpose === 'download-svg-plus') metrics.downloadSvgPlusRequests += 1;
      else metrics.previewRequests += 1;

      // Cache hits are free — check rate limit only for real renders
      const cacheKey = anchorRequests.length > 0
        ? JSON.stringify({ anchors: anchorRequests.map(({ key }) => key), latex, purpose })
        : JSON.stringify({ latex, purpose });

      if (shouldForceRender || (!getCached(cacheKey) && !inflight.has(cacheKey))) {
        const retryAfter = checkRateLimit(ip);
        if (retryAfter !== null) {
          res.setHeader('Retry-After', String(retryAfter));
          sendJson(res, 429, { error: 'rate limit exceeded, retry later' });
          return;
        }
      }

      log('render_request', { anchorCount: anchorRequests.length, forceRender: shouldForceRender, purpose });
      const result = await enqueueRender(cacheKey, latex, anchorRequests, purpose, shouldForceRender);
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
