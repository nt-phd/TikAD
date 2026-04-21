#!/usr/bin/env node
/**
 * Generates landing/public/landing-examples/example{i}-code.svg from the .tex source files.
 * Run: node landing/scripts/gen-landing-examples-code-svg.mjs
 */
import { createHighlighter } from 'shiki';
import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = resolve(__dirname, '../public/landing-examples');

const SHIKI_THEME = 'material-theme-darker';

const FONT_FAMILY = 'Roboto Mono, SFMono-Regular, Consolas, monospace';
const FONT_SIZE = 11;
const LINE_HEIGHT = 1.6;
const PAD_X = 8;
const PAD_Y = 8;
const GUTTER_WIDTH = 36;
const GUTTER_PAD = 8;
const CHAR_WIDTH = FONT_SIZE * 0.601;

const lineHeightPx = Math.round(FONT_SIZE * LINE_HEIGHT);

async function generateForExample(highlighter, index) {
  const texPath = resolve(EXAMPLES_DIR, `example${index}.tex`);
  const outPath = resolve(EXAMPLES_DIR, `example${index}-code.svg`);

  const code = readFileSync(texPath, 'utf8').trimEnd();
  const codeLines = code.split('\n');

  const totalLines = codeLines.length;
  const maxLineLen = Math.max(...codeLines.map((l) => l.length));
  const svgWidth = GUTTER_WIDTH + GUTTER_PAD + maxLineLen * CHAR_WIDTH + PAD_X * 2;
  const svgHeight = totalLines * lineHeightPx + PAD_Y * 2;

  const result = highlighter.codeToTokens(code, {
    lang: 'latex',
    theme: SHIKI_THEME,
  });

  const svgLines = [];

  svgLines.push(`<rect width="${svgWidth}" height="${svgHeight}" fill="${result.bg}"/>`);

  const gutterX = GUTTER_WIDTH + PAD_X;
  svgLines.push(`<line x1="${gutterX}" y1="0" x2="${gutterX}" y2="${svgHeight}" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>`);

  for (let i = 0; i < result.tokens.length; i++) {
    const lineTokens = result.tokens[i];
    const baseline = PAD_Y + i * lineHeightPx + lineHeightPx * 0.78;

    svgLines.push('<g>');
    svgLines.push(
      `<text x="${PAD_X + GUTTER_WIDTH - 4}" y="${baseline}" ` +
      `font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" ` +
      `fill="rgba(255,255,255,0.3)" text-anchor="end">${i + 1}</text>`
    );

    let x = gutterX + GUTTER_PAD;
    for (const token of lineTokens) {
      const color = token.color || result.fg;
      const text = token.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      if (text.length === 0) { x += token.content.length * CHAR_WIDTH; continue; }
      svgLines.push(
        `<text x="${x.toFixed(1)}" y="${baseline}" ` +
        `font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" ` +
        `fill="${color}">${text}</text>`
      );
      x += token.content.length * CHAR_WIDTH;
    }

    svgLines.push('</g>');
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
${svgLines.join('\n')}
</svg>`;

  writeFileSync(outPath, svg, 'utf8');
  console.log(`Written: ${outPath}  (${svgWidth.toFixed(0)}x${svgHeight}px)`);
}

async function main() {
  const highlighter = await createHighlighter({
    themes: [SHIKI_THEME],
    langs: ['latex'],
  });

  for (let i = 0; i < 4; i++) {
    await generateForExample(highlighter, i);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
