import { execFile } from 'child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const CATALOG_PATH = 'src/data/component-catalog.json';
const OUTPUT_PATH = 'public/component-catalog-previews.json';
const FAILURE_REPORT_PATH = 'src/data/component-catalog-preview-failures.json';

const DEFAULT_PREAMBLE = String.raw`\usepackage{amsmath}
\usepackage{amsfonts}
\usepackage{amssymb}
\usepackage{siunitx}
\usepackage[american,siunitx]{circuitikz}`;

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 20000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message));
      else resolve(stdout);
    });
  });
}

function wrapLatex(body) {
  return [
    String.raw`\documentclass[tikz,border=2pt]{standalone}`,
    DEFAULT_PREAMBLE,
    String.raw`\begin{document}`,
    body,
    String.raw`\end{document}`,
    '',
  ].join('\n');
}

async function renderSvg(latex) {
  const dir = await mkdtemp(join(tmpdir(), 'circuitikz-catalog-preview-'));
  try {
    const texFile = join(dir, 'preview.tex');
    await writeFile(texFile, latex, 'utf8');
    await run('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'preview.tex'], dir);
    await run('pdf2svg', ['preview.pdf', 'preview.svg', '1'], dir);
    return await readFile(join(dir, 'preview.svg'), 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function latexBodyFor(component) {
  if (component.kind === 'bipole') {
    return String.raw`\begin{tikzpicture}[scale=0.7]
\draw (0,0) to[${component.tag}] (2,0);
\end{tikzpicture}`;
  }
  return String.raw`\begin{tikzpicture}[scale=0.7]
\node[${component.tag}] at (0,0) {};
\end{tikzpicture}`;
}

async function main() {
  const catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  const previews = {};
  const failures = [];

  for (const component of catalog.components || []) {
    if (component.hidden) continue;
    try {
      previews[component.tag] = await renderSvg(wrapLatex(latexBodyFor(component)));
      console.log(`rendered ${component.tag}`);
    } catch (error) {
      failures.push({
        tag: component.tag,
        displayName: component.displayName,
        group: component.group,
        kind: component.kind,
        previewDefId: component.previewDefId ?? null,
        error: error.message,
      });
      console.warn(`failed ${component.tag}: ${error.message}`);
    }
  }

  await mkdir('src/data', { recursive: true });
  await mkdir('public', { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(previews), 'utf8');
  await writeFile(FAILURE_REPORT_PATH, JSON.stringify({ failures }, null, 2), 'utf8');
  console.log(`wrote ${Object.keys(previews).length} previews to ${OUTPUT_PATH}`);
  console.log(`wrote ${failures.length} preview failures to ${FAILURE_REPORT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
