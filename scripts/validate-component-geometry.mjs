import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const TECTONIC = process.env.TECTONIC_BIN || '/snap/bin/tectonic';
const catalog = JSON.parse(readFileSync(new URL('../src/data/component-catalog.json', import.meta.url), 'utf8'));

function inflatePoint(def, sourceKinds) {
  return {
    name: def.names[0],
    tikz: def.names[0],
    role: def.role,
    required: true,
    snap: def.role === 'terminal',
    ghost: def.role === 'terminal',
    sources: [...(sourceKinds || [])],
  };
}

function expandAnchorDefs(anchorDefs = []) {
  const defs = [];
  for (const def of anchorDefs) {
    for (const name of def.names || []) defs.push({ names: [name], role: def.role });
  }
  return defs;
}

function inflateGeometry(entry) {
  const rawGeometry = entry.geometry;
  if (!rawGeometry) return undefined;
  const defs = expandAnchorDefs(entry.anchorDefs || []);
  const referenceDef = rawGeometry.referenceName
    ? defs.find((def) => def.names[0] === rawGeometry.referenceName)
    : undefined;
  return {
    source: rawGeometry.source,
    reference: referenceDef
      ? {
          ...inflatePoint(referenceDef, entry.sourceKinds),
          role: 'reference',
          snap: false,
          ghost: true,
        }
      : null,
    pins: defs.filter((def) => def.role === 'terminal').map((def) => inflatePoint(def, entry.sourceKinds)),
    anchors: defs.filter((def) => def.role !== 'terminal' && def.role !== 'reference').map((def) => inflatePoint(def, entry.sourceKinds)),
    rules: rawGeometry.rules || [],
  };
}

function parseArgs(argv) {
  const args = { limit: Infinity, tag: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tag') args.tag = argv[++i] || '';
    else if (arg === '--limit') args.limit = Number.parseInt(argv[++i] || '', 10);
    else if (arg === '--keep') args.keep = true;
  }
  return args;
}

function texEscapeComment(value) {
  return String(value).replace(/\r?\n/g, ' ');
}

function markerLine(nodeName, point, index) {
  const target = point.tikz === 'center' || point.role === 'reference'
    ? `(${nodeName})`
    : `(${nodeName}.${point.tikz})`;
  return [
    `% TIKAD_PROBE id=probe_${index} key=${nodeName}.${texEscapeComment(point.tikz)} role=${texEscapeComment(point.role)}`,
    `\\fill[red] ${target} circle[radius=0.02];`,
  ].join('\n');
}

function latexForComponent(entry) {
  const nodeName = 'TIKADprobe';
  const geometry = inflateGeometry(entry);
  const points = [
    ...(geometry?.reference ? [geometry.reference] : []),
    ...(geometry?.pins || []),
    ...(geometry?.anchors || []),
  ];

  if (entry.kind === 'bipole') {
    return [
      '\\documentclass[tikz,border=2pt]{standalone}',
      '\\usepackage{circuitikz}',
      '\\begin{document}',
      '\\begin{circuitikz}',
      `\\draw (0,0) to[${entry.tag}] (2,0);`,
      '\\end{circuitikz}',
      '\\end{document}',
    ].join('\n');
  }

  return [
    '\\documentclass[tikz,border=2pt]{standalone}',
    '\\usepackage{circuitikz}',
    '\\begin{document}',
    '\\begin{circuitikz}',
    `\\node[${entry.tag}] (${nodeName}) at (0,0) {};`,
    ...points.map((point, index) => markerLine(nodeName, point, index)),
    '\\end{circuitikz}',
    '\\end{document}',
  ].join('\n');
}

function validateEntry(entry, baseDir) {
  const safeTag = entry.tag.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'component';
  const workDir = path.join(baseDir, safeTag);
  const texPath = path.join(workDir, 'component.tex');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(texPath, latexForComponent(entry), 'utf8');
  const result = spawnSync(TECTONIC, ['-X', 'compile', '--outdir', workDir, texPath], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    stderr: result.stderr,
    stdout: result.stdout,
    texPath,
  };
}

function main() {
  if (!existsSync(TECTONIC)) {
    throw new Error(`Tectonic binary not found: ${TECTONIC}`);
  }

  const args = parseArgs(process.argv.slice(2));
  const entries = catalog.components
    .filter((entry) => entry.geometry?.source !== 'unresolved')
    .filter((entry) => !args.tag || entry.tag === args.tag)
    .slice(0, Number.isFinite(args.limit) ? args.limit : undefined);

  const baseDir = mkdtempSync(path.join(process.cwd(), '.geometry-validation-'));
  const failures = [];
  try {
    for (const entry of entries) {
      const result = validateEntry(entry, baseDir);
      if (!result.ok) {
        failures.push({ entry, result });
        console.error(`FAIL ${entry.tag}`);
        console.error((result.stdout || result.stderr).split('\n').slice(0, 18).join('\n'));
      } else {
        console.log(`OK ${entry.tag}`);
      }
    }
  } finally {
    if (!args.keep) rmSync(baseDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} component geometry validation failure(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${entries.length} component geometry entries.`);
}

main();
