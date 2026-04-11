import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const DEFAULT_PREAMBLE = String.raw`\usepackage{amsmath}
\usepackage{amsfonts}
\usepackage{amssymb}

\usepackage{tikz}
\usepackage{circuitikz}

\ctikzset{resistors/scale=0.6}
\ctikzset{inductors/scale=0.8}
\ctikzset{capacitors/scale=0.6}
\ctikzset{sources/scale=0.6}
\ctikzset{amplifiers/scale=0.7}`;

const INVALID_TIKZ_NAMES = new Set(['generic', 'xgeneric', 'sgeneric', 'tgeneric', 'ageneric']);

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 20000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message));
      else resolve(stdout);
    });
  });
}

function parseAttributes(source) {
  const attrs = {};
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseSymbolsMetadata(svgText) {
  const metadataMatch = svgText.match(/<metadata>([\s\S]*?)<\/metadata>/);
  if (!metadataMatch) throw new Error('symbols.svg metadata not found');
  const metadata = metadataMatch[1];
  const defs = [];

  for (const componentMatch of metadata.matchAll(/<component\b([^>]*)>([\s\S]*?)<\/component>/g)) {
    const componentAttrs = parseAttributes(componentMatch[1]);
    const componentBody = componentMatch[2];
    const variants = [...componentBody.matchAll(/<variant\b([^>]*)>([\s\S]*?)<\/variant>/g)];
    if (variants.length === 0) continue;
    const variantAttrs = parseAttributes(variants[0][1]);
    const variantBody = variants[0][2];
    const pins = [...variantBody.matchAll(/<pin\b([^/>]*)\/>/g)].map((match) => parseAttributes(match[1]));
    const hasStart = pins.some((pin) => pin.name === 'START');
    const hasEnd = pins.some((pin) => pin.name === 'END');
    const placementType = componentAttrs.type === 'path' && hasStart && hasEnd ? 'bipole' : 'placed';
    const tikzName = componentAttrs.tikz || '';
    const defId = variantAttrs.for || '';
    if (!tikzName || !defId || INVALID_TIKZ_NAMES.has(tikzName)) continue;
    defs.push({
      defId,
      tikzName,
      placementType,
    });
  }

  return defs;
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
  const dir = await mkdtemp(join(tmpdir(), 'circuitikz-preview-'));
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

async function main() {
  const svgText = await readFile('src/data/symbols.svg', 'utf8');
  const defs = parseSymbolsMetadata(svgText);
  const previews = {};

  for (const def of defs) {
    const body = def.placementType === 'bipole'
      ? String.raw`\begin{tikzpicture}[scale=0.7]
\draw (0,0) to[${def.tikzName}] (2,0);
\end{tikzpicture}`
      : String.raw`\begin{tikzpicture}[scale=0.7]
\node[${def.tikzName}] at (0,0) {};
\end{tikzpicture}`;
    try {
      previews[def.defId] = await renderSvg(wrapLatex(body));
      console.log(`rendered ${def.tikzName}`);
    } catch (error) {
      console.warn(`failed ${def.tikzName}: ${error.message}`);
    }
  }

  await mkdir('public', { recursive: true });
  await writeFile('public/library-previews.json', JSON.stringify(previews), 'utf8');
  console.log(`wrote ${Object.keys(previews).length} previews to public/library-previews.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
