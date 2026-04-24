import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const OFFICIAL_FILES = [
  'circuitikz.sty',
  'pgfcirc.defines.tex',
  'pgfcircbipoles.tex',
  'pgfcircmonopoles.tex',
  'pgfcircmultipoles.tex',
  'pgfcircquadpoles.tex',
  'pgfcircshapes.tex',
  'pgfcirctripoles.tex',
];

const OUTPUT_PATH = 'src/data/component-catalog.raw.json';

function resolveOfficialPath(fileName) {
  const candidates = fileName === 'circuitikz.sty'
    ? [
        `/usr/share/texlive/texmf-dist/tex/latex/circuitikz/${fileName}`,
        `/usr/local/share/texmf/tex/latex/circuitikz/${fileName}`,
      ]
    : [
        `/usr/share/texlive/texmf-dist/tex/generic/circuitikz/${fileName}`,
        `/usr/local/share/texmf/tex/generic/circuitikz/${fileName}`,
      ];

  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`Unable to resolve official CircuitikZ file: ${fileName}`);
  }
  return resolved;
}

function stripComments(source) {
  return source
    .replace(/(^|[^\\])%.*$/gm, '$1')
    .replace(/\r/g, '');
}

function stripCommentsPreserveOffsets(source) {
  return source
    .replace(/(^|[^\\])%[^\n\r]*/gm, (match, prefix) => prefix + ' '.repeat(Math.max(0, match.length - prefix.length)))
    .replace(/\r/g, '');
}

function skipWhitespace(source, index) {
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

function readBalancedGroup(source, index) {
  if (source[index] !== '{') return null;
  let depth = 0;
  let i = index;
  let value = '';
  while (i < source.length) {
    const char = source[i];
    if (char === '{') {
      depth += 1;
      if (depth > 1) value += char;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { value, end: i + 1 };
      }
      value += char;
    } else {
      value += char;
    }
    i += 1;
  }
  return null;
}

function extractMacroCalls(source, macroName, argCount) {
  const calls = [];
  const needle = `\\${macroName}`;
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(needle, cursor);
    if (start === -1) break;
    let index = start + needle.length;
    const args = [];
    for (let i = 0; i < argCount; i += 1) {
      index = skipWhitespace(source, index);
      const group = readBalancedGroup(source, index);
      if (!group) {
        args.length = 0;
        break;
      }
      args.push(group.value);
      index = group.end;
    }
    if (args.length === argCount) {
      calls.push({ index: start, args });
      cursor = index;
    } else {
      cursor = start + needle.length;
    }
  }
  return calls;
}

function extractTopLevelTikzOptions(source) {
  const options = new Set();
  const patterns = [
    /\\pgfkeys\{\/tikz\/([^/}]+)\/\.(?:add code|code|is choice|style|default|initial)\b/g,
    /\\ctikzset\{([^/}]+)\/\.(?:add code|code|is choice|style|default|initial)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const option = match[1].trim();
      if (!option || option.includes('#') || option.includes('\\')) continue;
      options.add(option);
    }
  }
  return [...options].sort((a, b) => a.localeCompare(b));
}

function upsertComponent(components, tag) {
  if (!components.has(tag)) {
    components.set(tag, {
      tag,
      kind: '',
      styleType: '',
      family: '',
      group: '',
      displayName: '',
      className: '',
      previewDefId: '',
      fillable: undefined,
      anchors: [],
      anchorDefs: [],
      nodeOptions: [],
      packageOptions: [],
      sourceFiles: [],
      sourceKinds: [],
      aliases: [],
      metadata: {},
    });
  }
  return components.get(tag);
}

function normalizeAnchorBody(body) {
  return stripComments(body)
    .replace(/\s+/g, ' ')
    .replace(/\s*([={}(),+\-*/])\s*/g, '$1')
    .trim();
}

function extractAnchorDefinitions(source) {
  const defs = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('\\anchor', cursor);
    if (start === -1) break;
    let index = skipWhitespace(source, start + '\\anchor'.length);
    const nameGroup = readBalancedGroup(source, index);
    if (!nameGroup) {
      cursor = start + '\\anchor'.length;
      continue;
    }
    index = skipWhitespace(source, nameGroup.end);
    const bodyGroup = readBalancedGroup(source, index);
    if (!bodyGroup) {
      cursor = nameGroup.end;
      continue;
    }
    const name = nameGroup.value.trim();
    if (name) {
      defs.push({
        name,
        normalizedBody: normalizeAnchorBody(bodyGroup.value),
        order: defs.length,
      });
    }
    cursor = bodyGroup.end;
  }
  return defs;
}

function mergeAnchorDefinitions(entry, defs) {
  if (!Array.isArray(defs) || defs.length === 0) return;
  const existing = new Set(entry.anchorDefs.map((def) => `${def.name}|${def.normalizedBody}`));
  for (const def of defs) {
    const key = `${def.name}|${def.normalizedBody}`;
    if (existing.has(key)) continue;
    existing.add(key);
    entry.anchorDefs.push({
      name: def.name,
      normalizedBody: def.normalizedBody,
      order: entry.anchorDefs.length,
    });
    pushUnique(entry.anchors, def.name);
  }
}

function extractMacroDefinitionBody(source, macroName) {
  const prefixes = [`\\long\\def\\${macroName}`, `\\def\\${macroName}`];
  for (const prefix of prefixes) {
    const start = source.indexOf(prefix);
    if (start === -1) continue;
    let index = start + prefix.length;
    while (index < source.length && source[index] === '#') {
      index += 2;
    }
    index = skipWhitespace(source, index);
    const body = readBalancedGroup(source, index);
    if (body) return body.value;
  }
  return null;
}

function pushUnique(list, value) {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function splitTopLevelComma(source) {
  const parts = [];
  let current = '';
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);

    if (char === ',' && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
      continue;
    }
    current += char;
  }
  const trimmed = current.trim();
  if (trimmed) parts.push(trimmed);
  return parts;
}

function geometrySourceKinds(sourceKinds) {
  const filtered = unique(sourceKinds || [])
    .filter((kind) => kind !== 'symbols-metadata')
    .sort((a, b) => a.localeCompare(b));
  return filtered.length > 0 ? filtered : unique(sourceKinds || []).sort((a, b) => a.localeCompare(b));
}

const GEOMETRIC_ANCHORS = new Set([
  'base',
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

function classifyAnchorRole(name) {
  if (name === 'center') return 'reference';
  if (name === 'text') return 'text';
  if (GEOMETRIC_ANCHORS.has(name)) return 'geometry';
  return 'terminal';
}

function anchorSpec(name, sourceKinds) {
  const role = classifyAnchorRole(name);
  return {
    name,
    tikz: name,
    role,
    required: true,
    snap: role === 'terminal',
    ghost: role === 'terminal',
    sources: sourceKinds,
  };
}

function buildGeometrySpec(entry) {
  const sourceKinds = geometrySourceKinds(entry.sourceKinds || []);
  if (entry.kind === 'bipole') {
    const anchorNames = unique(entry.anchors || []).sort((a, b) => a.localeCompare(b));
    const anchorSpecs = anchorNames.map((name) => anchorSpec(name, sourceKinds));
    return {
      source: sourceKinds.includes('manual-override') ? 'manual-override' : 'official-tex',
      reference: anchorNames.includes('center') ? anchorSpec('center', sourceKinds) : null,
      pins: [
        { name: 'START', tikz: 'START', role: 'terminal', required: true, snap: true, ghost: true, sources: sourceKinds },
        { name: 'END', tikz: 'END', role: 'terminal', required: true, snap: true, ghost: true, sources: sourceKinds },
      ],
      anchors: anchorSpecs.filter((spec) => spec.role !== 'terminal'),
      rules: [],
    };
  }

  const anchorNames = unique(entry.anchors || []).sort((a, b) => a.localeCompare(b));
  const referenceName = anchorNames.includes('center') ? 'center' : null;
  const specs = anchorNames.map((name) => anchorSpec(name, sourceKinds));
  return {
    source: anchorNames.length > 0 ? 'official-tex' : 'unresolved',
    reference: referenceName ? anchorSpec(referenceName, sourceKinds) : null,
    pins: specs.filter((spec) => spec.role === 'terminal'),
    anchors: specs.filter((spec) => spec.role !== 'terminal'),
    rules: [],
  };
}

function titleCaseWord(word) {
  const upperWords = new Set(['vcc', 'vee', 'vdd', 'vss', 'gnd', 'adc', 'dac', 'njf', 'pjf', 'jfet', 'mos', 'nmos', 'pmos']);
  const replacementWords = new Map([
    ['circ', 'Circle'],
    ['ocirc', 'Open circle'],
  ]);
  const lower = word.toLowerCase();
  if (replacementWords.has(lower)) return replacementWords.get(lower);
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

function cleanCommentLabel(line) {
  const cleaned = line
    .replace(/^%+\s?/, '')
    .replace(/%+<?<?<?\d*$/g, '')
    .trim();
  if (!cleaned) return '';
  if (/^[-=<>#*]+$/.test(cleaned)) return '';
  if (/^(monopoles|grounds|power supplies|grounds and power supplies|node shapes.*|other shapes)$/i.test(cleaned)) return '';
  return cleaned
    .split(/\s+/)
    .map((part) => titleCaseWord(part))
    .join(' ');
}

function extractLeadingCommentLabel(rawSource, index) {
  let cursor = rawSource.lastIndexOf('\n', index);
  const labels = [];
  while (cursor > 0) {
    const prevLineEnd = cursor;
    const prevLineStart = rawSource.lastIndexOf('\n', prevLineEnd - 1) + 1;
    const rawLine = rawSource.slice(prevLineStart, prevLineEnd).trim();
    if (!rawLine) {
      if (labels.length === 0) {
        cursor = prevLineStart - 1;
        continue;
      }
      break;
    }
    if (!rawLine.startsWith('%')) break;
    const label = cleanCommentLabel(rawLine);
    if (label) labels.unshift(label);
    cursor = prevLineStart - 1;
  }
  return labels.at(-1) || '';
}

function isLiteralTag(tag) {
  return Boolean(tag) &&
    !tag.includes('#') &&
    !tag.includes('\\') &&
    !/[{}]/.test(tag);
}

function inferFillableFromBody(body) {
  return body.includes('\\pgf@circ@draworfill') || body.includes('\\pgf@circ@draworfillandclip');
}

const GROUND_ANCHORS = [
  'center',
  'east',
  'left',
  'north',
  'north east',
  'north west',
  'right',
  'south',
  'south east',
  'south west',
  'west',
];

const BJT_ANCHORS = [
  'B',
  'base',
  'center',
  'C',
  'collector',
  'E',
  'east',
  'emitter',
  'nobase',
  'north',
  'north east',
  'north west',
  'south',
  'south east',
  'south west',
  'text',
  'west',
];

const FET_ANCHORS = [
  'B',
  'base',
  'bulk',
  'center',
  'C',
  'collector',
  'D',
  'drain',
  'E',
  'east',
  'emitter',
  'G',
  'gate',
  'inner down',
  'inner up',
  'north',
  'north east',
  'north west',
  'nobase',
  'S',
  'source',
  'south',
  'south east',
  'south west',
  'text',
  'west',
];

const JFET_ANCHORS = [
  ...FET_ANCHORS,
  'inner down',
  'inner up',
  'kink',
];

const UJT_ANCHORS = [
  ...JFET_ANCHORS,
  'ujt baseright',
  'ujt emitter',
];

const TWOPORT_ANCHORS = [
  'center',
  'down',
  'left down',
  'left up',
  'north',
  'north east',
  'north west',
  'right down',
  'right up',
  'south',
  'south east',
  'south west',
  'text',
  'up',
  'west',
  'east',
];

const QUADPOLE_ANCHORS = [
  'A1',
  'A2',
  'B1',
  'B2',
  'base',
  'center',
  'east',
  'inner dot A1',
  'inner dot A2',
  'inner dot B1',
  'inner dot B2',
  'north',
  'north east',
  'north west',
  'outer dot A1',
  'outer dot A2',
  'outer dot B1',
  'outer dot B2',
  'south',
  'south east',
  'south west',
  'text',
  'west',
];

const LOGIC_PORT_ANCHORS = [
  'bout',
  'center',
  'east',
  'left',
  'north',
  'north east',
  'north west',
  'out',
  'right',
  'south',
  'south east',
  'south west',
  'text',
  'west',
  ...Array.from({ length: 16 }, (_, index) => `bin ${index + 1}`),
  ...Array.from({ length: 16 }, (_, index) => `in ${index + 1}`),
];

const FLIPFLOP_ANCHORS = [
  'bdown',
  'bpin 1',
  'bpin 2',
  'bpin 3',
  'bpin 4',
  'bpin 5',
  'bpin 6',
  'bup',
  'center',
  'dot',
  'down',
  'e',
  'east',
  'n',
  'ne',
  'north',
  'north east',
  'north west',
  'nw',
  'pin 1',
  'pin 2',
  'pin 3',
  'pin 4',
  'pin 5',
  'pin 6',
  's',
  'se',
  'south',
  'south east',
  'south west',
  'sw',
  'text',
  'up',
  'w',
  'west',
];

const FOURPORT_ANCHORS = [
  '1',
  '2',
  '3',
  '4',
  'center',
  'east',
  'left down',
  'left up',
  'north',
  'north east',
  'north west',
  'port1',
  'port2',
  'port3',
  'port4',
  'right down',
  'right up',
  'south',
  'south east',
  'south west',
  'text',
  'west',
];

const TGATE_ANCHORS = [
  'bgate',
  'bin',
  'bin 1',
  'body left',
  'body right',
  'bnotgate',
  'bout',
  'center',
  'down',
  'east',
  'gate',
  'in',
  'in 1',
  'left',
  'north',
  'north east',
  'north west',
  'notgate',
  'out',
  'right',
  'south',
  'south east',
  'south west',
  'text',
  'up',
  'west',
];

const NON_COMPONENT_STYLE_TAGS = new Set([
  'american',
  'american currents',
  'american ports',
  'american voltages',
  'cute',
  'european',
  'european currents',
  'european ports',
  'european voltages',
]);

function addAnchors(entry, anchors) {
  for (const anchor of anchors) pushUnique(entry.anchors, anchor);
}

function registerStyleAlias(components, styleAliases, fileName, aliasTag, sourceTag) {
  if (!isLiteralTag(sourceTag) || !isLiteralTag(aliasTag)) return;
  styleAliases.push({ aliasTag, fileName, sourceTag });
}

function addSyntheticAlias(components, fileName, aliasTag, targetTag) {
  const entry = upsertComponent(components, aliasTag);
  entry.metadata.aliasOf = entry.metadata.aliasOf || targetTag;
  pushUnique(entry.sourceFiles, fileName);
  pushUnique(entry.sourceKinds, 'official-style-alias');
}

function extractGeneratedDiodeStyles(components, fileName, declaredShapes) {
  const diodeFamilies = [
    { publicName: 'diode', aliasPrefix: 'D', baseName: 'diode' },
    { publicName: 'Zener diode', aliasPrefix: 'zD', baseName: 'zdiode' },
    { publicName: 'ZZener diode', aliasPrefix: 'zzD', baseName: 'zzdiode' },
    { publicName: 'Schottky diode', aliasPrefix: 'sD', baseName: 'sdiode' },
    { publicName: 'tunnel diode', aliasPrefix: 'tD', baseName: 'tdiode' },
    { publicName: 'led', aliasPrefix: 'leD', baseName: 'lediode' },
    { publicName: 'laser diode', aliasPrefix: 'lasD', baseName: 'laserdiode' },
    { publicName: 'photodiode', aliasPrefix: 'pD', baseName: 'pdiode' },
    { publicName: 'varcap', aliasPrefix: 'VC', baseName: 'varcap' },
    { publicName: 'TVS diode', aliasPrefix: 'tvsD', baseName: 'tvsdiode' },
    { publicName: 'Shockley diode', aliasPrefix: 'shD', baseName: 'shdiode' },
    { publicName: 'bidirectionaldiode', aliasPrefix: 'biD', baseName: 'bidirectionaldiode' },
    { publicName: 'thyristor', aliasPrefix: 'Ty', baseName: 'thyristor' },
    { publicName: 'put', aliasPrefix: 'PUT', baseName: 'put' },
    { publicName: 'gto', aliasPrefix: 'GTO', baseName: 'gto' },
    { publicName: 'gtobar', aliasPrefix: 'GTOb', baseName: 'gtobar' },
    { publicName: 'agtobar', aliasPrefix: 'aGTOb', baseName: 'agtobar' },
    { publicName: 'triac', aliasPrefix: 'Tr', baseName: 'triac' },
  ];

  const generatedSets = [
    { prefix: 'full', aliasSuffix: '*', backingType: 'path', stroked: false },
    { prefix: 'empty', aliasSuffix: 'o', backingType: 'path', stroked: false },
    { prefix: 'stroke', aliasSuffix: '-', backingType: 'node', stroked: true },
  ];

  for (const set of generatedSets) {
    for (const family of diodeFamilies) {
      const publicTag = `${set.prefix} ${family.publicName}`;
      const entry = upsertComponent(components, publicTag);
      entry.kind ||= 'bipole';
      entry.styleType ||= 'path-style';
      entry.family ||= 'diodes';
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, `official-generated-${set.backingType}-style`);
      entry.metadata.baseNodeName = entry.metadata.baseNodeName || `${set.prefix}${family.baseName}`;
      entry.metadata.backingStyleKind = entry.metadata.backingStyleKind || set.backingType;
      if (set.stroked) entry.metadata.isStrokedSymbol = true;
      entry.fillable = true;
      pushUnique(entry.aliases, `${family.aliasPrefix}${set.aliasSuffix}`);

      const aliasEntry = upsertComponent(components, `${family.aliasPrefix}${set.aliasSuffix}`);
      aliasEntry.kind ||= 'bipole';
      aliasEntry.styleType ||= 'path-style';
      aliasEntry.metadata.aliasOf = aliasEntry.metadata.aliasOf || publicTag;
      pushUnique(aliasEntry.sourceFiles, fileName);
      pushUnique(aliasEntry.sourceKinds, 'official-style-alias');
    }
  }
}

async function main() {
  const resolvedFiles = Object.fromEntries(
    OFFICIAL_FILES.map((fileName) => [fileName, resolveOfficialPath(fileName)]),
  );
  const rawOfficialSources = Object.fromEntries(
    await Promise.all(
      Object.entries(resolvedFiles).map(async ([fileName, filePath]) => [
        fileName,
        (await readFile(filePath, 'utf8')).replace(/\r/g, ''),
      ]),
    ),
  );
  const officialSources = Object.fromEntries(
    Object.entries(rawOfficialSources).map(([fileName, source]) => [fileName, stripCommentsPreserveOffsets(source)]),
  );

  const components = new Map();
  const declaredShapes = new Map();
  const macroAnchorTemplates = new Map();
  const styleAliases = [];
  const pathStyles = [];
  const nodeStyles = [];

  for (const [fileName, source] of Object.entries(officialSources)) {
    const rawSource = rawOfficialSources[fileName];
    for (const macroName of ['pgfcircdeclaretransistor', 'pgfcircdeclarejunctiontransistor', 'pgfdeclaretransistorwrapperaddbulk']) {
      const body = extractMacroDefinitionBody(source, macroName);
      if (!body) continue;
      macroAnchorTemplates.set(macroName, extractAnchorDefinitions(body));
    }

    for (const call of extractMacroCalls(source, 'pgfcircdeclarebipolescaled', 7)) {
      const family = call.args[0].trim();
      const tag = call.args[3].trim();
      if (!tag || tag.includes('#')) continue;
      declaredShapes.set(tag, {
        fillable: inferFillableFromBody(call.args[6]),
        family,
        kind: 'bipole',
      });
      const entry = upsertComponent(components, tag);
      entry.kind ||= 'bipole';
      entry.family ||= family;
      if (entry.fillable == null) entry.fillable = declaredShapes.get(tag)?.fillable;
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-bipole');
    }

    for (const call of extractMacroCalls(source, 'pgfcircdeclarebipole', 6)) {
      const tag = call.args[2].trim();
      if (!tag || tag.includes('#')) continue;
      declaredShapes.set(tag, {
        fillable: inferFillableFromBody(call.args[5]),
        family: 'default',
        kind: 'bipole',
      });
      const entry = upsertComponent(components, tag);
      entry.kind ||= 'bipole';
      entry.family ||= 'default';
      if (entry.fillable == null) entry.fillable = declaredShapes.get(tag)?.fillable;
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-bipole');
    }

    for (const call of extractMacroCalls(source, 'pgfcirc@style@to@style', 2)) {
      const sourceTag = call.args[0].trim();
      const aliasTag = call.args[1].trim();
      if (!isLiteralTag(sourceTag) || !isLiteralTag(aliasTag)) continue;
      styleAliases.push({ aliasTag, fileName, sourceTag });
    }

    for (const call of extractMacroCalls(source, 'pgfcirc@path@to@style', 4)) {
      const internalStyle = call.args[1].trim();
      const publicTag = call.args[2].trim();
      if (!isLiteralTag(internalStyle) || !isLiteralTag(publicTag)) continue;
      pathStyles.push({ fileName, internalStyle, publicTag });
    }

    for (const call of extractMacroCalls(source, 'pgfcirc@node@to@style', 4)) {
      const internalStyle = call.args[1].trim();
      const publicTag = call.args[2].trim();
      if (!isLiteralTag(internalStyle) || !isLiteralTag(publicTag)) continue;
      nodeStyles.push({ fileName, internalStyle, publicTag });
    }

    for (const call of extractMacroCalls(source, 'pgfdeclareshape', 2)) {
      const tag = call.args[0].trim();
      if (!tag || tag.includes('#')) continue;
      const body = call.args[1];
      declaredShapes.set(tag, {
        fillable: inferFillableFromBody(body),
        kind: fileName === 'pgfcircshapes.tex' ? 'shape' : 'node',
      });
      const entry = upsertComponent(components, tag);
      if (!entry.kind) {
        entry.kind = fileName === 'pgfcircshapes.tex' ? 'shape' : 'node';
      }
      const displayName = extractLeadingCommentLabel(rawSource, call.index);
      if (displayName && (!entry.displayName || entry.displayName === titleCaseFromTag(tag))) {
        entry.displayName = displayName;
      }
      if (entry.fillable == null) entry.fillable = declaredShapes.get(tag)?.fillable;
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
      mergeAnchorDefinitions(entry, extractAnchorDefinitions(body));
    }

    for (const call of extractMacroCalls(source, 'pgf@circ@declareground', 4)) {
      const tag = call.args[0].trim();
      if (!isLiteralTag(tag)) continue;
      declaredShapes.set(tag, {
        fillable: inferFillableFromBody(call.args[3]),
        kind: 'node',
      });
      const entry = upsertComponent(components, tag);
      entry.kind ||= 'node';
      entry.className ||= 'grounds';
      entry.group ||= 'Grounds and supply voltages';
      const displayName = extractLeadingCommentLabel(rawSource, call.index);
      if (displayName && (!entry.displayName || entry.displayName === titleCaseFromTag(tag))) {
        entry.displayName = displayName;
      }
      if (entry.fillable == null) entry.fillable = declaredShapes.get(tag)?.fillable;
      addAnchors(entry, GROUND_ANCHORS);
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
    }

    for (const call of extractMacroCalls(source, 'declarebjt', 1)) {
      const tag = call.args[0].trim();
      if (!isLiteralTag(tag)) continue;
      declaredShapes.set(tag, {
        fillable: false,
        kind: 'node',
      });
      const entry = upsertComponent(components, tag);
      entry.kind ||= 'node';
      entry.className ||= 'transistors';
      entry.group ||= 'Transistors';
      addAnchors(entry, BJT_ANCHORS);
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
    }

    for (const call of extractMacroCalls(source, 'pgfdeclaretransistorwrapperaddbulk', 3)) {
      const tag = call.args[0].trim();
      if (!isLiteralTag(tag)) continue;
      declaredShapes.set(tag, {
        fillable: inferFillableFromBody(call.args[2]),
        kind: 'node',
      });
      const entry = upsertComponent(components, tag);
      entry.kind ||= 'node';
      entry.className ||= 'transistors';
      entry.group ||= 'Transistors';
      if (entry.fillable == null) entry.fillable = declaredShapes.get(tag)?.fillable;
      addAnchors(entry, FET_ANCHORS);
      mergeAnchorDefinitions(entry, macroAnchorTemplates.get('pgfcircdeclaretransistor'));
      mergeAnchorDefinitions(entry, macroAnchorTemplates.get('pgfdeclaretransistorwrapperaddbulk'));
      mergeAnchorDefinitions(entry, extractAnchorDefinitions(call.args[1]));
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
    }

    for (const call of extractMacroCalls(source, 'pgfcircdeclarejunctiontransistor', 3)) {
      const tag = call.args[0].trim();
      if (!isLiteralTag(tag)) continue;
      declaredShapes.set(tag, {
        fillable: inferFillableFromBody(call.args[2]),
        kind: 'node',
      });
      const entry = upsertComponent(components, tag);
      entry.kind ||= 'node';
      entry.className ||= 'transistors';
      entry.group ||= 'Transistors';
      if (entry.fillable == null) entry.fillable = declaredShapes.get(tag)?.fillable;
      addAnchors(entry, /ujt/i.test(tag) ? UJT_ANCHORS : JFET_ANCHORS);
      mergeAnchorDefinitions(entry, macroAnchorTemplates.get('pgfcircdeclaretransistor'));
      mergeAnchorDefinitions(entry, macroAnchorTemplates.get('pgfcircdeclarejunctiontransistor'));
      mergeAnchorDefinitions(entry, extractAnchorDefinitions(call.args[1]));
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
    }

    for (const call of extractMacroCalls(source, 'pgfcircdeclaretransistor', 3)) {
      const tag = call.args[0].trim();
      if (!isLiteralTag(tag)) continue;
      declaredShapes.set(tag, {
        fillable: inferFillableFromBody(call.args[2]),
        kind: 'node',
      });
      const entry = upsertComponent(components, tag);
      entry.kind ||= 'node';
      entry.className ||= 'transistors';
      entry.group ||= 'Transistors';
      if (entry.fillable == null) entry.fillable = declaredShapes.get(tag)?.fillable;
      addAnchors(entry, BJT_ANCHORS);
      mergeAnchorDefinitions(entry, macroAnchorTemplates.get('pgfcircdeclaretransistor'));
      mergeAnchorDefinitions(entry, extractAnchorDefinitions(call.args[1]));
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
    }

    for (const call of extractMacroCalls(source, 'pgfcircdeclarelogicport', 3)) {
      const family = call.args[0].trim();
      if (!isLiteralTag(family)) continue;
      const tag = `american ${family} port`;
      const entry = upsertComponent(components, tag);
      entry.kind ||= 'node';
      entry.className ||= 'logic';
      entry.group ||= 'Logic gates';
      addAnchors(entry, LOGIC_PORT_ANCHORS);
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
    }

    for (const call of extractMacroCalls(source, 'pgfcircdeclareeurologicport', 4)) {
      const family = call.args[0].trim();
      if (!isLiteralTag(family)) continue;
      const tag = `european ${family} port`;
      const entry = upsertComponent(components, tag);
      entry.kind ||= 'node';
      entry.className ||= 'logic';
      entry.group ||= 'Logic gates';
      addAnchors(entry, LOGIC_PORT_ANCHORS);
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
    }

    for (const call of extractMacroCalls(source, 'pgfcircdeclareieeeportpair', 4)) {
      for (const family of [call.args[0].trim(), call.args[1].trim()]) {
        if (!isLiteralTag(family)) continue;
        const tag = `ieeestd ${family} port`;
        const entry = upsertComponent(components, tag);
        entry.kind ||= 'node';
        entry.className ||= 'logic';
        entry.group ||= 'Logic gates';
        addAnchors(entry, LOGIC_PORT_ANCHORS);
        pushUnique(entry.sourceFiles, fileName);
        pushUnique(entry.sourceKinds, 'official-shape');
      }
    }

    for (const call of extractMacroCalls(source, 'pgfcircdeclareieeebufferportpair', 3)) {
      for (const family of [call.args[0].trim(), call.args[1].trim()]) {
        if (!isLiteralTag(family)) continue;
        const tag = `ieeestd ${family} port`;
        const entry = upsertComponent(components, tag);
        entry.kind ||= 'node';
        entry.className ||= 'logic';
        entry.group ||= 'Logic gates';
        addAnchors(entry, LOGIC_PORT_ANCHORS);
        pushUnique(entry.sourceFiles, fileName);
        pushUnique(entry.sourceKinds, 'official-shape');
      }
    }

    for (const macroName of ['pgfcirc@define@twoports', 'pgfcirc@define@twoports@norotate', 'pgfcirc@define@twoports@boxed']) {
      for (const call of extractMacroCalls(source, macroName, 7)) {
        const tag = call.args[3].trim();
        if (!isLiteralTag(tag)) continue;
        const entry = upsertComponent(components, tag);
        entry.kind ||= 'bipole';
        entry.className ||= 'blocks';
        entry.group ||= 'Blocks and converters';
        addAnchors(entry, TWOPORT_ANCHORS);
        for (const anchorMatch of call.args[1].matchAll(/\\anchor\{([^}]+)\}/g)) {
          pushUnique(entry.anchors, anchorMatch[1].trim());
        }
        pushUnique(entry.sourceFiles, fileName);
        pushUnique(entry.sourceKinds, 'official-bipole');
      }
    }

    for (const call of extractMacroCalls(source, 'pgfcircdeclarefourport', 2)) {
      const tag = call.args[0].trim();
      if (!isLiteralTag(tag)) continue;
      const entry = upsertComponent(components, tag);
      entry.kind ||= 'node';
      entry.className ||= 'blocks';
      entry.group ||= 'Blocks and converters';
      addAnchors(entry, FOURPORT_ANCHORS);
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
    }

    for (const call of extractMacroCalls(source, 'pgfcircdeclarequadpole', 3)) {
      const tag = call.args[0].trim();
      if (!isLiteralTag(tag)) continue;
      const entry = upsertComponent(components, tag);
      entry.kind ||= 'node';
      entry.className ||= 'quadpoles';
      entry.group ||= 'Transformers and quadpoles';
      addAnchors(entry, QUADPOLE_ANCHORS);
      for (const anchorMatch of call.args[2].matchAll(/\\anchor\{([^}]+)\}/g)) {
        pushUnique(entry.anchors, anchorMatch[1].trim());
      }
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
    }

    for (const call of extractMacroCalls(source, 'pgfcircdeclareieeetgate', 3)) {
      const tag = `ieee ${call.args[0].trim()}`;
      if (!isLiteralTag(tag)) continue;
      const entry = upsertComponent(components, tag);
      entry.kind ||= 'node';
      entry.className ||= 'logic';
      entry.group ||= 'Logic gates';
      addAnchors(entry, TGATE_ANCHORS);
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
    }

    for (const call of extractMacroCalls(source, 'tikzset', 1)) {
      for (const item of splitTopLevelComma(call.args[0])) {
        const match = item.match(/^([^/{}]+)\/\.style\s*=\s*\{([\s\S]*)\}$/);
        if (!match) continue;
        const aliasTag = match[1].trim();
        const body = match[2].trim();
        if (!isLiteralTag(aliasTag) || NON_COMPONENT_STYLE_TAGS.has(aliasTag)) continue;
        const firstClause = splitTopLevelComma(body)[0]?.trim() || '';
        const shapeMatch = body.match(/^shape\s*=\s*([^,}]+)$/);
        if (shapeMatch && isLiteralTag(shapeMatch[1].trim())) {
          registerStyleAlias(components, styleAliases, fileName, aliasTag, shapeMatch[1].trim());
          continue;
        }
        if (isLiteralTag(firstClause) && firstClause !== aliasTag) {
          registerStyleAlias(components, styleAliases, fileName, aliasTag, firstClause);
        }
      }
    }

    for (const call of extractMacroCalls(source, 'pgfcirc@activate@bipole', 4)) {
      const pathName = call.args[1].trim();
      const baseNodeName = call.args[2].trim();
      const publicTag = call.args[3].trim();
      if (!isLiteralTag(pathName) || !isLiteralTag(baseNodeName) || !isLiteralTag(publicTag)) continue;
      const entry = upsertComponent(components, publicTag);
      entry.kind ||= 'bipole';
      entry.styleType ||= 'path-style';
      entry.metadata.basePathName = entry.metadata.basePathName || pathName;
      entry.metadata.baseNodeName = entry.metadata.baseNodeName || baseNodeName;
      entry.metadata.backingStyleKind = entry.metadata.backingStyleKind || 'path';
      if (entry.fillable == null) {
        entry.fillable = declaredShapes.get(baseNodeName)?.fillable ?? declaredShapes.get(pathName)?.fillable;
      }
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-activated-bipole');
    }

    for (const call of extractMacroCalls(source, 'pgfcirc@activate@bipole@opt', 5)) {
      const pathName = call.args[1].trim();
      const baseNodeName = call.args[2].trim();
      const publicTag = call.args[3].trim();
      if (!isLiteralTag(pathName) || !isLiteralTag(baseNodeName) || !isLiteralTag(publicTag)) continue;
      const entry = upsertComponent(components, publicTag);
      entry.kind ||= 'bipole';
      entry.styleType ||= 'path-style';
      entry.metadata.basePathName = entry.metadata.basePathName || pathName;
      entry.metadata.baseNodeName = entry.metadata.baseNodeName || baseNodeName;
      entry.metadata.backingStyleKind = entry.metadata.backingStyleKind || 'path';
      if (entry.fillable == null) {
        entry.fillable = declaredShapes.get(baseNodeName)?.fillable ?? declaredShapes.get(pathName)?.fillable;
      }
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-activated-bipole');
    }

    if (fileName === 'pgfcircbipoles.tex') {
      extractGeneratedDiodeStyles(components, fileName, declaredShapes);
    }
  }

  const stySource = officialSources['circuitikz.sty'];
  const packageOptions = [...stySource.matchAll(/\\DeclareOption\{([^}]+)\}/g)].map((match) => match[1].trim());
  const defaultOptionsMatch = stySource.match(/\\ExecuteOptions\{([^}]*)\}/);
  const defaultOptions = defaultOptionsMatch
    ? defaultOptionsMatch[1].split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  const nodeOptions = unique(Object.values(officialSources).flatMap((source) => extractTopLevelTikzOptions(source))).sort((a, b) => a.localeCompare(b));

  const optionGroups = {};
  for (const optionName of packageOptions) {
    let group = 'misc';
    if (optionName.includes('voltage')) group = 'voltages';
    else if (optionName.includes('current')) group = 'currents';
    else if (optionName.includes('resistor')) group = 'resistors';
    else if (optionName.includes('inductor')) group = 'inductors';
    else if (optionName.includes('port')) group = 'ports';
    else if (optionName.includes('surgearrester')) group = 'gas-filled-surge-arresters';
    else if (optionName.includes('diode')) group = 'diodes';
    else if (optionName.includes('mos') || optionName.includes('fet')) group = 'mosfet';
    else if (optionName.includes('transistor')) group = 'transistors';
    else if (optionName.includes('label')) group = 'labels';
    else if (optionName.includes('compat')) group = 'compatibility';
    pushUnique(optionGroups[group] ||= [], optionName);
  }

  const defaultVoltageTag = defaultOptions.includes('americanvoltages') ? 'american voltage source' : 'european voltage source';
  const defaultCurrentTag = defaultOptions.includes('americancurrents') ? 'american current source' : 'european current source';
  const defaultControlledVoltageTag = defaultOptions.includes('americanvoltages') ? 'american controlled voltage source' : 'european controlled voltage source';
  const defaultControlledCurrentTag = defaultOptions.includes('americancurrents') ? 'american controlled current source' : 'european controlled current source';
  const defaultAliases = [
    ['voltage source', defaultVoltageTag],
    ['current source', defaultCurrentTag],
    ['controlled voltage source', defaultControlledVoltageTag],
    ['controlled current source', defaultControlledCurrentTag],
    ['diode', 'stroke diode'],
    ['Zener diode', 'stroke Zener diode'],
    ['ZZener diode', 'stroke ZZener diode'],
    ['Schottky diode', 'stroke Schottky diode'],
    ['tunnel diode', 'stroke tunnel diode'],
    ['led', 'stroke led'],
    ['laser diode', 'stroke laser diode'],
    ['photodiode', 'stroke photodiode'],
    ['varcap', 'stroke varcap'],
    ['TVS diode', 'stroke TVS diode'],
    ['Shockley diode', 'stroke Shockley diode'],
    ['bidirectionaldiode', 'stroke bidirectionaldiode'],
    ['thyristor', 'stroke thyristor'],
    ['put', 'stroke put'],
    ['gto', 'stroke gto'],
    ['gtobar', 'stroke gtobar'],
    ['agtobar', 'stroke agtobar'],
    ['triac', 'stroke triac'],
  ];
  for (const [aliasTag, targetTag] of defaultAliases) {
    if (!components.has(targetTag)) continue;
    addSyntheticAlias(components, 'circuitikz.sty', aliasTag, targetTag);
  }

  const nodeStyleByInternal = new Map();
  for (const { fileName, internalStyle, publicTag } of nodeStyles) {
    const entry = upsertComponent(components, publicTag);
    entry.styleType ||= 'node-style';
    pushUnique(entry.sourceFiles, fileName);
    pushUnique(entry.sourceKinds, 'official-node-style');
    entry.metadata.internalStyle = entry.metadata.internalStyle || internalStyle;
    entry.metadata.baseNodeName = entry.metadata.baseNodeName || internalStyle;
    entry.metadata.backingStyleKind = entry.metadata.backingStyleKind || 'node';
    const shapeDef = declaredShapes.get(internalStyle);
    if (shapeDef) {
      for (const anchor of shapeDef.anchors ?? []) pushUnique(entry.anchors, anchor);
      if (entry.fillable == null) entry.fillable = shapeDef.fillable;
      entry.kind ||= shapeDef.kind;
    }
    if (!nodeStyleByInternal.has(internalStyle)) {
      nodeStyleByInternal.set(internalStyle, publicTag);
    }
  }

  for (const { fileName, internalStyle, publicTag } of pathStyles) {
    const entry = upsertComponent(components, publicTag);
    entry.kind ||= 'bipole';
    entry.styleType ||= 'path-style';
    entry.metadata.pathInternal = entry.metadata.pathInternal || internalStyle;
    entry.metadata.basePathName = entry.metadata.basePathName || internalStyle;
    entry.metadata.backingStyleKind = entry.metadata.backingStyleKind || 'path';
    if (entry.fillable == null) entry.fillable = declaredShapes.get(internalStyle)?.fillable;
    pushUnique(entry.sourceFiles, fileName);
    pushUnique(entry.sourceKinds, 'official-path-style');
    const concretePublicTag = nodeStyleByInternal.get(internalStyle);
    if (concretePublicTag) {
      const concrete = components.get(concretePublicTag);
      if (concrete) {
        entry.family ||= concrete.family;
        entry.group ||= concrete.group;
        entry.className ||= concrete.className;
        entry.previewDefId ||= concrete.previewDefId;
        if (!entry.displayName || entry.displayName === titleCaseFromTag(publicTag)) {
          entry.displayName = concrete.displayName || entry.displayName;
        }
        pushUnique(entry.aliases, concretePublicTag);
      }
    }
  }

  for (const { aliasTag, fileName, sourceTag } of styleAliases) {
    const source = components.get(sourceTag);
    const entry = upsertComponent(components, aliasTag);
    if (source) {
      entry.kind ||= source.kind;
      entry.styleType ||= source.styleType;
      entry.family ||= source.family;
      entry.group ||= source.group;
      entry.className ||= source.className;
      entry.previewDefId ||= source.previewDefId;
      if (entry.fillable == null) entry.fillable = source.fillable;
      if (!entry.displayName || entry.displayName === titleCaseFromTag(aliasTag)) {
        entry.displayName = source.displayName || titleCaseFromTag(aliasTag);
      }
      pushUnique(entry.aliases, sourceTag);
      pushUnique(source.aliases, aliasTag);
    }
    entry.metadata.aliasOf = entry.metadata.aliasOf || sourceTag;
    pushUnique(entry.sourceFiles, fileName);
    pushUnique(entry.sourceKinds, 'official-style-alias');
  }

  const componentList = [...components.values()]
    .map((entry) => ({
      ...entry,
      displayName: entry.displayName || titleCaseFromTag(entry.tag),
      anchors: [...entry.anchors].sort((a, b) => a.localeCompare(b)),
      anchorDefs: [...(entry.anchorDefs || [])]
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
      geometry: buildGeometrySpec(entry),
      styleType: entry.styleType || undefined,
      fillable: entry.fillable,
      sourceFiles: [...entry.sourceFiles].sort((a, b) => a.localeCompare(b)),
      sourceKinds: [...entry.sourceKinds].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

  const output = {
    generatedAt: new Date().toISOString(),
    officialSourcePaths: resolvedFiles,
    packageOptions: {
      all: [...new Set(packageOptions)].sort((a, b) => a.localeCompare(b)),
      defaults: [...new Set(defaultOptions)].sort((a, b) => a.localeCompare(b)),
      nodeOptions,
      groups: Object.fromEntries(
        Object.entries(optionGroups)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([group, values]) => [group, values.sort((a, b) => a.localeCompare(b))]),
      ),
    },
    components: componentList,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`wrote ${componentList.length} raw entries to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
