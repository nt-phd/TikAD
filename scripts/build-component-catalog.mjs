import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const RAW_PATH = 'src/data/component-catalog.raw.json';
const OVERRIDES_PATH = 'src/data/component-catalog.overrides.json';
const OUTPUT_PATH = 'src/data/component-catalog.json';
const PUBLIC_OUTPUT_PATH = 'public/component-catalog.json';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function geometrySourceKinds(sourceKinds) {
  const filtered = unique(sourceKinds || [])
    .filter((kind) => kind !== 'symbols-metadata')
    .sort((a, b) => a.localeCompare(b));
  return filtered.length > 0 ? filtered : unique(sourceKinds || []).sort((a, b) => a.localeCompare(b));
}

const GEOMETRIC_ANCHORS = new Set([
  'center',
  'down',
  'east',
  'left',
  'leftedge',
  'north',
  'north east',
  'north west',
  'right',
  'rightedge',
  'south',
  'south east',
  'south west',
  'text',
  'up',
  'west',
]);

const INTERNAL_ANCHOR_NAMES = new Set([
  'bulk',
  'centergap',
  'circle base',
  'circle bottom',
  'circle C',
  'circle center',
  'circle E',
  'circle left',
  'circle right',
  'circle top',
  'inner down',
  'inner up',
  'kink',
  'nobase',
  'nobulk',
  'nogate',
  'pathend',
  'pathstart',
]);

const INTERNAL_ANCHOR_PREFIXES = [
  'body ',
  'circle ',
  'inner ',
];

function isInternalAnchor(name) {
  if (INTERNAL_ANCHOR_NAMES.has(name)) return true;
  return INTERNAL_ANCHOR_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function classifyAnchorRole(name) {
  if (name === 'center') return 'reference';
  if (name === 'text') return 'text';
  if (isInternalAnchor(name)) return 'internal';
  if (GEOMETRIC_ANCHORS.has(name)) return 'geometry';
  return 'terminal';
}

function pointSpec(name, sourceKinds, overrides = {}) {
  const role = overrides.role || classifyAnchorRole(name);
  return {
    name,
    tikz: overrides.tikz || name,
    role,
    required: overrides.required ?? true,
    snap: overrides.snap ?? role === 'terminal',
    ghost: overrides.ghost ?? role === 'terminal',
    sources: unique([...(overrides.sources || []), ...sourceKinds]).sort((a, b) => a.localeCompare(b)),
    ...(overrides.label ? { label: overrides.label } : {}),
  };
}

function mergePointSpecs(primary = [], secondary = []) {
  const byName = new Map();
  for (const point of [...primary, ...secondary]) {
    if (!point?.name) continue;
    const existing = byName.get(point.name) || {};
    byName.set(point.name, {
      ...existing,
      ...point,
      sources: unique([...(existing.sources || []), ...(point.sources || [])]).sort((a, b) => a.localeCompare(b)),
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function compactGeometry(geometry) {
  const compactPoints = [
    ...(geometry.reference ? [{ name: geometry.reference.name, role: geometry.reference.role }] : []),
    ...((geometry.pins || []).map((point) => ({ name: point.name, role: point.role }))),
    ...((geometry.anchors || []).map((point) => ({ name: point.name, role: point.role }))),
  ];
  return {
    source: geometry.source,
    referenceName: geometry.reference?.name ?? null,
    points: compactPoints.length > 0 ? compactPoints : undefined,
    rules: geometry.rules,
  };
}

function anchorSemanticBucket(name) {
  const lowered = String(name || '').toLowerCase();
  if (/^gate\d*$/.test(lowered) || /^g\d*$/.test(lowered)) return 'gate';
  if (/^drain\d*$/.test(lowered) || /^d\d*$/.test(lowered)) return 'drain';
  if (/^source\d*$/.test(lowered) || /^s\d*$/.test(lowered)) return 'source';
  if (/^base\d*$/.test(lowered) || /^b\d*$/.test(lowered)) return 'base';
  if (/^collector\d*$/.test(lowered) || /^c\d*$/.test(lowered)) return 'collector';
  if (/^emitter\d*$/.test(lowered) || /^e\d*$/.test(lowered)) return 'emitter';
  return lowered;
}

function componentSpecificBucketPriority(component, bucket) {
  const tag = String(component?.tag || '').toLowerCase();
  if (/(jfet|mos|igfet|fet)/.test(tag)) {
    if (bucket === 'gate') return 0;
    if (bucket === 'drain') return 1;
    if (bucket === 'source') return 2;
    if (bucket === 'base') return 3;
    if (bucket === 'collector') return 4;
    if (bucket === 'emitter') return 5;
  }
  if (/(npn|pnp|bjt|transistor)/.test(tag) && !/(jfet|mos|igfet|fet)/.test(tag)) {
    if (bucket === 'base') return 0;
    if (bucket === 'collector') return 1;
    if (bucket === 'emitter') return 2;
    if (bucket === 'gate') return 3;
    if (bucket === 'drain') return 4;
    if (bucket === 'source') return 5;
  }
  return 100;
}

function compareGroupedNames(component, a, b) {
  const bucketDiff = componentSpecificBucketPriority(component, anchorSemanticBucket(a.name))
    - componentSpecificBucketPriority(component, anchorSemanticBucket(b.name));
  if (bucketDiff !== 0) return bucketDiff;
  const aNumbered = /\d+$/.test(a.name);
  const bNumbered = /\d+$/.test(b.name);
  if (aNumbered !== bNumbered) return aNumbered ? 1 : -1;
  if (a.name.length !== b.name.length) return a.name.length - b.name.length;
  return a.name.localeCompare(b.name);
}

function compactAnchorDefs(component, anchorDefs = []) {
  const byKey = new Map();
  for (const def of anchorDefs) {
    if (!def?.name || !def.normalizedBody) continue;
    const key = `${def.normalizedBody}:::${def.role || classifyAnchorRole(def.name)}`;
    const bucket = byKey.get(key) ?? {
      names: [],
      normalizedBody: def.normalizedBody,
      role: def.role || classifyAnchorRole(def.name),
      _sortKey: def.order ?? Number.MAX_SAFE_INTEGER,
    };
    bucket.names.push({ name: def.name, order: def.order ?? Number.MAX_SAFE_INTEGER });
    bucket._sortKey = Math.min(bucket._sortKey, def.order ?? Number.MAX_SAFE_INTEGER);
    byKey.set(key, bucket);
  }
  return [...byKey.values()]
    .sort((a, b) => a._sortKey - b._sortKey || a.names[0].name.localeCompare(b.names[0].name))
    .map((group) => ({
      names: group.names
        .sort((a, b) => compareGroupedNames(component, a, b) || a.order - b.order || a.name.localeCompare(b.name))
        .map((entry) => entry.name),
      normalizedBody: group.normalizedBody,
      role: group.role,
    }));
}

function buildEquivalentNameGroups(component, points = []) {
  if (!Array.isArray(component.anchorDefs) || component.anchorDefs.length === 0 || points.length === 0) return undefined;
  const pointMap = new Map(points.map((point) => [point.name, point]));
  const byBody = new Map();

  for (const def of component.anchorDefs) {
    if (!def?.name || !def.normalizedBody) continue;
    if (!pointMap.has(def.name)) continue;
    const bucket = byBody.get(def.normalizedBody) ?? [];
    bucket.push(def);
    byBody.set(def.normalizedBody, bucket);
  }

  const groups = [];
  for (const defs of byBody.values()) {
    const names = defs
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((def) => def.name);
    if (names.length < 2) continue;
    groups.push({
      names,
      role: pointMap.get(names[0])?.role || 'terminal',
    });
  }

  return groups.length > 0 ? groups : undefined;
}

function buildGeometrySpec(component, override = {}) {
  if (override.geometry) {
    const sourceKinds = geometrySourceKinds([...(component.sourceKinds || []), 'manual-override']);
    const base = buildGeometrySpec({ ...component, sourceKinds }, {});
    return {
      ...base,
      ...override.geometry,
      reference: override.geometry.reference ?? base.reference,
      pinGroups: override.geometry.pinGroups ?? base.pinGroups,
      pins: mergePointSpecs(base.pins, override.geometry.pins || []),
      anchors: mergePointSpecs(base.anchors, override.geometry.anchors || []),
      rules: [...(base.rules || []), ...(override.geometry.rules || [])],
    };
  }

  const sourceKinds = geometrySourceKinds(component.sourceKinds || []);
  if (component.kind === 'bipole') {
    const anchorNames = unique(component.anchors || []).sort((a, b) => a.localeCompare(b));
    const anchorSpecs = anchorNames.map((name) => pointSpec(name, sourceKinds));
    const pins = [
      pointSpec('START', sourceKinds, { role: 'terminal' }),
      pointSpec('END', sourceKinds, { role: 'terminal' }),
    ];
    return {
      source: sourceKinds.includes('manual-override') ? 'manual-override' : 'official-tex',
      reference: anchorNames.includes('center') ? pointSpec('center', sourceKinds, { role: 'reference', snap: false, ghost: true }) : null,
      pinGroups: buildEquivalentNameGroups(component, pins),
      pins,
      anchors: anchorSpecs.filter((spec) => spec.role !== 'terminal'),
      rules: [],
    };
  }

  const anchorNames = unique(component.anchors || []).sort((a, b) => a.localeCompare(b));
  const specs = anchorNames.map((name) => pointSpec(name, sourceKinds));
  const pins = specs.filter((spec) => spec.role === 'terminal');
  const anchors = specs.filter((spec) => spec.role !== 'terminal');
  const reference = anchorNames.includes('center') ? pointSpec('center', sourceKinds, { role: 'reference', snap: false, ghost: true }) : null;
  return {
    source: anchorNames.length > 0 ? 'official-tex' : 'unresolved',
    reference,
    pinGroups: buildEquivalentNameGroups(component, pins),
    pins,
    anchors,
    rules: [],
  };
}

function titleCaseWord(word) {
  const upperWords = new Set(['vcc', 'vee', 'vdd', 'vss', 'gnd', 'adc', 'dac', 'jfet', 'nmos', 'pmos', 'mos']);
  const lower = word.toLowerCase();
  if (upperWords.has(lower)) return lower.toUpperCase();
  if (/^[vgin][a-z]{1,4}$/.test(lower) && lower === word) return lower.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function splitTagWords(tag) {
  return String(tag || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .replace(/([a-z])(american|european|cute|stroke|empty|full|normal|ieee|ieeestd|generic|variable|controlled|open|closed|left|right|north|south|double|sinusoidal|triangle|square|gas|light|noise)/gi, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function titleCaseFromTag(tag) {
  return splitTagWords(tag)
    .map((part) => titleCaseWord(part))
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

function resolveAliasTarget(componentByTag, aliasTargetTag) {
  const seen = new Set();
  let currentTag = aliasTargetTag;
  let current = componentByTag.get(currentTag);
  while (current && current.metadata?.aliasOf && !seen.has(currentTag)) {
    seen.add(currentTag);
    currentTag = current.metadata.aliasOf;
    current = componentByTag.get(currentTag);
  }
  return current;
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
    const backingTagCandidates = unique([
      rawEntry.metadata?.baseNodeName,
      rawEntry.metadata?.basePathName,
      rawEntry.metadata?.internalStyle,
      rawEntry.metadata?.pathInternal,
    ]);
    const backingEntry =
      backingTagCandidates
        .map((tag) => rawByTag.get(tag))
        .find(Boolean);
    const representativeStyleTag =
      override.representativeStyleTag ||
      override.metadata?.representativeStyleTag ||
      resolveRepresentativeStyleTag(rawEntry, defaultOptions);
    const representative =
      (representativeStyleTag ? rawByTag.get(representativeStyleTag) : undefined) ||
      (rawEntry.metadata?.aliasOf ? rawByTag.get(rawEntry.metadata.aliasOf) : undefined) ||
      backingEntry;
    const component = {
      tag: rawEntry.tag,
      kind: override.kind || rawEntry.kind || '',
      styleType: override.styleType || rawEntry.styleType || representative?.styleType || backingEntry?.styleType || '',
      family: override.family || rawEntry.family || representative?.family || backingEntry?.family || '',
      displayName: override.displayName || rawEntry.displayName || titleCaseFromTag(rawEntry.tag),
      group: override.group || inferGroup({ ...rawEntry, ...representative, ...override }),
      className: override.className || rawEntry.className || representative?.className || backingEntry?.className || '',
      previewDefId: override.previewDefId || rawEntry.previewDefId || representative?.previewDefId || backingEntry?.previewDefId || '',
      fillable: override.fillable ?? rawEntry.fillable ?? representative?.fillable ?? backingEntry?.fillable,
      aliases: unique([...(rawEntry.aliases || []), ...(override.aliases || [])]).sort((a, b) => a.localeCompare(b)),
      anchors: unique([...(rawEntry.anchors || []), ...(override.anchors || [])]).sort((a, b) => a.localeCompare(b)),
      anchorDefs: [...(rawEntry.anchorDefs || [])].map((def) => ({
        ...def,
        role: classifyAnchorRole(def.name),
      })),
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
    component.geometry = buildGeometrySpec(component, override);
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
      anchorDefs: [],
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
    component.geometry = buildGeometrySpec(component, override);
    component.searchTerms = toSearchTerms({
      ...component,
      searchTerms: override.searchTerms || [],
    });
    components.push(component);
  }

  const componentByTag = new Map(components.map((component) => [component.tag, component]));
  for (const component of components) {
    const aliasTargetTag = component.metadata?.aliasOf;
    if (!aliasTargetTag) continue;
    const target = resolveAliasTarget(componentByTag, aliasTargetTag);
    if (!target) continue;
    component.kind ||= target.kind;
    component.styleType ||= target.styleType;
    component.family ||= target.family;
    component.group ||= target.group;
    component.className ||= target.className;
    component.previewDefId ||= target.previewDefId;
    if (component.fillable == null) component.fillable = target.fillable;
    component.anchors = unique([...(target.anchors || []), ...(component.anchors || [])]).sort((a, b) => a.localeCompare(b));
    if ((!component.geometry || component.geometry.source === 'unresolved') && target.geometry) {
      component.geometry = {
        ...target.geometry,
        source: target.geometry.source,
        reference: target.geometry.reference ? {
          ...target.geometry.reference,
          sources: unique([...(target.geometry.reference.sources || []), ...(component.geometry?.reference?.sources || []), ...(component.sourceKinds || [])]).sort((a, b) => a.localeCompare(b)),
        } : null,
        pins: mergePointSpecs(target.geometry.pins || [], component.geometry?.pins || []),
        anchors: mergePointSpecs(target.geometry.anchors || [], component.geometry?.anchors || []),
        rules: [...(target.geometry.rules || []), ...(component.geometry?.rules || [])],
      };
    }
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
    components: components.map((component) => ({
      tag: component.tag,
      kind: component.kind,
      styleType: component.styleType,
      family: component.family,
      displayName: overrideEntries[component.tag]?.displayName || rawByTag.get(component.tag)?.displayName || component.displayName || titleCaseFromTag(component.tag),
      group: component.group,
      className: component.className,
      previewDefId: component.previewDefId,
      fillable: component.fillable,
      aliases: component.aliases,
      anchorDefs: compactAnchorDefs(component, component.anchorDefs),
      geometry: component.geometry ? compactGeometry(component.geometry) : undefined,
      nodeOptions: component.nodeOptions,
      hidden: component.hidden,
      metadata: component.metadata,
      styleKind: component.styleKind,
      order: component.order,
      sourceFiles: component.sourceFiles,
      sourceKinds: component.sourceKinds,
      searchTerms: component.searchTerms,
      notes: component.notes,
    })),
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
