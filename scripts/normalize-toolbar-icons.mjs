import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const outputDir = resolve(root, 'src/components/icons/toolbar');
const strokeWidth = '1.5';

// Add future toolbar icons here. Use `filledOutline: true` for glyphs that must be
// both filled and outlined without drawing fill and stroke on the same path.
const icons = [
  { name: 'resistor', source: 'public/component-catalog-previews/resistor.svg' },
  { name: 'capacitor', source: 'public/component-catalog-previews/capacitor.svg' },
  { name: 'short', source: 'src/components/icons/short.svg' },
  { name: 'open', source: 'src/components/icons/open.svg' },
  { name: 'circ', source: 'src/components/icons/circ.svg', filledOutline: true },
  { name: 'ocirc', source: 'src/components/icons/ocirc.svg' },
];

function namespaceIds(svg, prefix) {
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  let next = svg;

  for (const id of ids) {
    const namespaced = `${prefix}-${id}`;
    next = next.replaceAll(`id="${id}"`, `id="${namespaced}"`);
    next = next.replaceAll(`url(#${id})`, `url(#${namespaced})`);
    next = next.replaceAll(`href="#${id}"`, `href="#${namespaced}"`);
    next = next.replaceAll(`xlink:href="#${id}"`, `xlink:href="#${namespaced}"`);
  }

  return next;
}

function normalizePaint(svg) {
  return svg
    .replaceAll(/stroke="rgb\(0%, 0%, 0%\)"/g, 'stroke="var(--rail-icon-ink)"')
    .replaceAll(/fill="rgb\(0%, 0%, 0%\)"/g, 'fill="var(--rail-icon-ink)"')
    .replaceAll(/fill="rgb\(100%, 100%, 100%\)"/g, 'fill="none"');
}

function normalizeStroke(svg) {
  return svg
    .replaceAll(/stroke-width="[^"]+"/g, `stroke-width="${strokeWidth}"`)
    .replaceAll(/<(?:path|line|polyline|polygon|circle|ellipse|rect)\b(?=[^>]*\bstroke="var\(--rail-icon-ink\)")[^>]*>/g, (tag) => {
      if (tag.includes('vector-effect=')) return tag;
      if (tag.endsWith('/>')) return tag.replace(/\s*\/>$/, ' vector-effect="non-scaling-stroke"/>');
      return tag.replace(/>$/, ' vector-effect="non-scaling-stroke">');
    });
}

function normalizeOpacity(svg) {
  return svg
    .replaceAll(/\s+opacity="[^"]*"/g, '')
    .replaceAll(/\s+stroke-opacity="[^"]*"/g, '')
    .replaceAll(/\s+fill-opacity="[^"]*"/g, '');
}

function normalizeFilledOutline(svg) {
  return svg.replace(
    /(<path\b(?=[^>]*\bfill="var\(--rail-icon-ink\)")(?=[^>]*\bstroke="var\(--rail-icon-ink\)")[^>]*)(?:><\/path>|\/>)/,
    (match, start) => {
      const fillOnly = start
        .replace(/\s+stroke="var\(--rail-icon-ink\)"/g, '')
        .replace(/\s+stroke-width="[^"]*"/g, '')
        .replace(/\s+stroke-linecap="[^"]*"/g, '')
        .replace(/\s+stroke-linejoin="[^"]*"/g, '')
        .replace(/\s+stroke-miterlimit="[^"]*"/g, '');
      const outlineOnly = start
        .replace(/\s+fill="var\(--rail-icon-ink\)"/, ' fill="none"');

      return `${fillOnly}/>${outlineOnly}/>`;
    },
  );
}

function normalizeRoot(svg) {
  return svg
    .replace(/<\?xml[^>]*>\s*/g, '')
    .replace(/\s+xmlns:xlink="[^"]*"/g, '')
    .replace(/\s+(?:width|height)="[^"]*"/g, '')
    .replace(/\s+style="[^"]*"/g, '')
    .replace(/<svg\b/, '<svg aria-hidden="true" focusable="false"');
}

async function normalizeIcon({ filledOutline = false, name, source }) {
  const sourcePath = resolve(root, source);
  const targetPath = resolve(outputDir, `${name}.svg`);
  const raw = await readFile(sourcePath, 'utf8');
  const prepared = normalizePaint(namespaceIds(normalizeRoot(raw), `toolbar-${name}`));
  const outlined = filledOutline ? normalizeFilledOutline(prepared) : prepared;
  const normalized = `${normalizeStroke(normalizeOpacity(outlined)).trim()}\n`;

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, normalized);
  return `${basename(sourcePath)} -> ${targetPath}`;
}

for (const icon of icons) {
  console.log(await normalizeIcon(icon));
}
