import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const RAW_PATH = 'src/data/component-catalog.raw.json';
const OVERRIDES_PATH = 'src/data/component-catalog.overrides.json';
const OUTPUT_PATH = 'src/data/component-catalog.json';
const PUBLIC_OUTPUT_PATH = 'public/component-catalog.json';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function titleCaseFromTag(tag) {
  return tag
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function inferGroup(component) {
  if (component.group) return component.group;
  const family = component.family || '';
  if (family === 'resistors') return 'Resistive bipoles';
  if (family === 'capacitors') return 'Capacitive and dynamic bipoles';
  if (family === 'inductors') return 'Inductors';
  if (family === 'diodes') return 'Diodes';
  if (family === 'sources' || family === 'batteries' || family === 'csources') return 'Sources and generators';
  if (family === 'switches') return 'Switches, buttons and jumpers';
  if (family === 'mechanicals') return 'Mechanical';
  if (family === 'instruments') return 'Instruments';
  if (component.kind === 'node') return 'Miscellaneous';
  return 'Miscellaneous';
}

function toSearchTerms(entry) {
  return unique([
    entry.tag,
    entry.displayName,
    ...(entry.aliases || []),
    ...(entry.searchTerms || []),
  ]).sort((a, b) => a.localeCompare(b));
}

function inferStyleKind(component) {
  return component.metadata?.aliasOf ? 'alias style' : 'style';
}

function inferNodeOptions(component, raw) {
  const available = new Set(raw.packageOptions?.nodeOptions || []);
  const addIfKnown = (list, ...names) => {
    for (const name of names) {
      if (available.has(name) && !list.includes(name)) list.push(name);
    }
  };

  const options = [];
  const tag = component.tag || '';
  const className = component.className || '';
  const group = component.group || '';

  if (className === 'amplifiers' || group === 'Amplifiers' || /\bamp\b/.test(tag)) {
    addIfKnown(options, 'noinv input up', 'noinv input down');
    if (/\bfd\b/.test(tag)) {
      addIfKnown(options, 'noinv output up', 'noinv output down');
    }
  }

  if (className === 'logic' || group === 'Logic gates' || /\bport\b/.test(tag)) {
    addIfKnown(
      options,
      'number inputs',
      'logic ports',
      'logic ports origin',
      'logic ports draw input leads',
      'logic ports draw output leads',
      'logic ports draw leads',
      'american or shape',
      'european xnor style',
    );
  }

  return options.sort((a, b) => a.localeCompare(b));
}

function resolveRepresentativeStyleTag(component, defaults) {
  const pathInternal = component.metadata?.pathInternal || '';
  if (!pathInternal) return '';

  if (pathInternal === 'resistor') {
    if (defaults.includes('americanresistors')) return 'american resistor';
    if (defaults.includes('europeanresistors')) return 'european resistor';
  }
  if (pathInternal === 'vresistor') {
    if (defaults.includes('americanresistors')) return 'variable american resistor';
    if (defaults.includes('europeanresistors')) return 'variable european resistor';
  }
  if (pathInternal === 'resistivesens') {
    if (defaults.includes('americanresistors')) return 'american resistive sensor';
    if (defaults.includes('europeanresistors')) return 'european resistive sensor';
  }
  if (pathInternal === 'ldresistor') {
    if (defaults.includes('americanresistors')) return 'american light dependent resistor';
    if (defaults.includes('europeanresistors')) return 'european light dependent resistor';
  }
  if (pathInternal === 'potentiometer') {
    if (defaults.includes('americanresistors')) return 'american potentiometer';
    if (defaults.includes('europeanresistors')) return 'european potentiometer';
  }
  if (pathInternal === 'inductor') {
    if (defaults.includes('cuteinductors')) return 'cute inductor';
    if (defaults.includes('americaninductors')) return 'american inductor';
    if (defaults.includes('europeaninductors')) return 'european inductor';
  }
  if (pathInternal === 'vinductor') {
    if (defaults.includes('cuteinductors')) return 'variable cute inductor';
    if (defaults.includes('americaninductors')) return 'variable american inductor';
    if (defaults.includes('europeaninductors')) return 'variable european inductor';
  }
  if (pathInternal === 'inductivesens') {
    if (defaults.includes('cuteinductors')) return 'cute inductive sensor';
    if (defaults.includes('americaninductors')) return 'american inductive sensor';
    if (defaults.includes('europeaninductors')) return 'european inductive sensor';
  }
  if (component.tag === 'voltage source') {
    if (defaults.includes('europeanvoltages')) return 'european voltage source';
    if (defaults.includes('americanvoltages')) return 'american voltage source';
  }
  if (component.tag === 'controlled voltage source') {
    if (defaults.includes('europeanvoltages')) return 'european controlled voltage source';
    if (defaults.includes('americanvoltages')) return 'american controlled voltage source';
  }
  if (component.tag === 'current source') {
    if (defaults.includes('europeancurrents')) return 'european current source';
    if (defaults.includes('americancurrents')) return 'american current source';
  }
  if (component.tag === 'controlled current source') {
    if (defaults.includes('europeancurrents')) return 'european controlled current source';
    if (defaults.includes('americancurrents')) return 'american controlled current source';
  }
  if (component.tag === 'gas filled surge arrester' || component.tag === 'gf surge arrester') {
    if (defaults.includes('europeangfsurgearrester')) return 'european gas filled surge arrester';
    if (defaults.includes('americangfsurgearrester')) return 'american gas filled surge arrester';
  }

  return '';
}

async function main() {
  const raw = JSON.parse(await readFile(RAW_PATH, 'utf8'));
  const overrides = JSON.parse(await readFile(OVERRIDES_PATH, 'utf8'));
  const overrideEntries = overrides.entries || {};
  const rawByTag = new Map((raw.components || []).map((entry) => [entry.tag, entry]));
  const defaultOptions = raw.packageOptions?.defaults || [];
  const components = [];

  for (const rawEntry of raw.components || []) {
    const override = overrideEntries[rawEntry.tag] || {};
    const representativeStyleTag =
      override.representativeStyleTag ||
      override.metadata?.representativeStyleTag ||
      resolveRepresentativeStyleTag(rawEntry, defaultOptions);
    const representative =
      (representativeStyleTag ? rawByTag.get(representativeStyleTag) : undefined) ||
      (rawEntry.metadata?.aliasOf ? rawByTag.get(rawEntry.metadata.aliasOf) : undefined);
    const component = {
      tag: rawEntry.tag,
      kind: override.kind || rawEntry.kind || '',
      styleType: override.styleType || rawEntry.styleType || representative?.styleType || '',
      family: override.family || rawEntry.family || representative?.family || '',
      displayName: override.displayName || rawEntry.displayName || titleCaseFromTag(rawEntry.tag),
      group: override.group || inferGroup({ ...rawEntry, ...representative, ...override }),
      className: override.className || rawEntry.className || representative?.className || '',
      previewDefId: override.previewDefId || rawEntry.previewDefId || representative?.previewDefId || '',
      fillable: override.fillable ?? rawEntry.fillable ?? representative?.fillable,
      aliases: unique([...(rawEntry.aliases || []), ...(override.aliases || [])]).sort((a, b) => a.localeCompare(b)),
      anchors: unique([...(rawEntry.anchors || []), ...(override.anchors || [])]).sort((a, b) => a.localeCompare(b)),
      nodeOptions: unique([...(inferNodeOptions({ ...rawEntry, ...representative, ...override }, raw) || []), ...(rawEntry.nodeOptions || []), ...(override.nodeOptions || [])]).sort((a, b) => a.localeCompare(b)),
      hidden: override.hidden ?? false,
      metadata: {
        ...(rawEntry.metadata || {}),
        ...(representativeStyleTag ? { representativeStyleTag } : {}),
        ...(override.metadata || {}),
      },
      styleKind: override.styleKind || inferStyleKind({ ...rawEntry, ...override }),
      order: Number.isFinite(override.order) ? override.order : null,
      sourceFiles: unique([...(rawEntry.sourceFiles || []), ...(override.sourceFiles || [])]).sort((a, b) => a.localeCompare(b)),
      sourceKinds: unique([...(rawEntry.sourceKinds || []), ...(override.sourceKinds || [])]).sort((a, b) => a.localeCompare(b)),
      searchTerms: [],
      notes: override.notes || '',
    };
    component.searchTerms = toSearchTerms({
      ...component,
      searchTerms: override.searchTerms || [],
    });
    components.push(component);
  }

  for (const [tag, override] of Object.entries(overrideEntries)) {
    const exists = components.some((component) => component.tag === tag);
    if (exists) continue;
    const component = {
      tag,
      kind: override.kind || '',
      styleType: override.styleType || '',
      family: override.family || '',
      displayName: override.displayName || titleCaseFromTag(tag),
      group: override.group || 'Miscellaneous',
      className: override.className || '',
      previewDefId: override.previewDefId || '',
      fillable: override.fillable,
      aliases: unique(override.aliases || []).sort((a, b) => a.localeCompare(b)),
      anchors: unique(override.anchors || []).sort((a, b) => a.localeCompare(b)),
      nodeOptions: unique(override.nodeOptions || []).sort((a, b) => a.localeCompare(b)),
      hidden: override.hidden ?? false,
      metadata: { ...(override.metadata || {}) },
      styleKind: override.styleKind || 'style',
      order: Number.isFinite(override.order) ? override.order : null,
      sourceFiles: unique(override.sourceFiles || []).sort((a, b) => a.localeCompare(b)),
      sourceKinds: unique(override.sourceKinds || ['manual-override']).sort((a, b) => a.localeCompare(b)),
      searchTerms: [],
      notes: override.notes || '',
    };
    component.searchTerms = toSearchTerms({
      ...component,
      searchTerms: override.searchTerms || [],
    });
    components.push(component);
  }

  components.sort((a, b) => {
    const aHasOrder = Number.isFinite(a.order);
    const bHasOrder = Number.isFinite(b.order);
    if (aHasOrder && bHasOrder && a.order !== b.order) return a.order - b.order;
    if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
    if (a.tag.length !== b.tag.length) return a.tag.length - b.tag.length;
    return a.tag.localeCompare(b.tag);
  });

  const output = {
    generatedAt: new Date().toISOString(),
    sourceRawCatalog: RAW_PATH,
    sourceOverrides: OVERRIDES_PATH,
    packageOptions: raw.packageOptions || { all: [], groups: {} },
    components,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  await mkdir(path.dirname(PUBLIC_OUTPUT_PATH), { recursive: true });
  await writeFile(PUBLIC_OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`wrote ${components.length} final entries to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
