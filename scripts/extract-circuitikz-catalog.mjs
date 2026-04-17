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

function parseAttributes(source) {
  const attrs = {};
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
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

function parseSymbolsMetadata(svgText) {
  const metadataMatch = svgText.match(/<metadata>([\s\S]*?)<\/metadata>/);
  if (!metadataMatch) {
    throw new Error('symbols.svg metadata not found');
  }
  const metadata = metadataMatch[1];
  const entries = [];
  for (const componentMatch of metadata.matchAll(/<component\b([^>]*)>([\s\S]*?)<\/component>/g)) {
    const componentAttrs = parseAttributes(componentMatch[1]);
    const componentBody = componentMatch[2];
    const variants = [...componentBody.matchAll(/<variant\b([^>]*)>([\s\S]*?)<\/variant>/g)];
    if (variants.length === 0) continue;
    const firstVariantAttrs = parseAttributes(variants[0][1]);
    entries.push({
      type: componentAttrs.type || 'node',
      displayName: componentAttrs.display || '',
      tikzName: componentAttrs.tikz || '',
      group: componentAttrs.group || '',
      className: componentAttrs.class || '',
      previewDefId: firstVariantAttrs.for || '',
      symbolId: firstVariantAttrs.for || '',
    });
  }
  return entries.filter((entry) => entry.tikzName);
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

function pushUnique(list, value) {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

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

function isLiteralTag(tag) {
  return Boolean(tag) &&
    !tag.includes('#') &&
    !tag.includes('\\') &&
    !/[{}]/.test(tag);
}

function inferFillableFromBody(body) {
  return body.includes('\\pgf@circ@draworfill') || body.includes('\\pgf@circ@draworfillandclip');
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
  const officialSources = Object.fromEntries(
    await Promise.all(
      Object.entries(resolvedFiles).map(async ([fileName, filePath]) => [
        fileName,
        stripComments(await readFile(filePath, 'utf8')),
      ]),
    ),
  );

  const components = new Map();
  const declaredShapes = new Map();
  const styleAliases = [];
  const pathStyles = [];
  const nodeStyles = [];

  for (const [fileName, source] of Object.entries(officialSources)) {
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
      if (entry.fillable == null) entry.fillable = declaredShapes.get(tag)?.fillable;
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
      for (const anchorMatch of body.matchAll(/\\anchor\{([^}]+)\}/g)) {
        pushUnique(entry.anchors, anchorMatch[1].trim());
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

  const symbolsEntries = parseSymbolsMetadata(await readFile('public/symbols.svg', 'utf8'));
  for (const symbol of symbolsEntries) {
    const entry = upsertComponent(components, symbol.tikzName);
    if (!entry.kind) {
      entry.kind = symbol.type === 'path' ? 'bipole' : 'node';
    }
    entry.displayName ||= symbol.displayName;
    entry.group ||= symbol.group;
    entry.className ||= symbol.className;
    entry.previewDefId ||= symbol.previewDefId;
    pushUnique(entry.sourceFiles, 'symbols.svg');
    pushUnique(entry.sourceKinds, 'symbols-metadata');
  }

  const nodeStyleByInternal = new Map();
  for (const { fileName, internalStyle, publicTag } of nodeStyles) {
    const entry = upsertComponent(components, publicTag);
    entry.styleType ||= 'path-style';
    pushUnique(entry.sourceFiles, fileName);
    pushUnique(entry.sourceKinds, 'official-node-style');
    entry.metadata.internalStyle = entry.metadata.internalStyle || internalStyle;
    entry.metadata.baseNodeName = entry.metadata.baseNodeName || internalStyle;
    entry.metadata.backingStyleKind = entry.metadata.backingStyleKind || 'node';
    if (entry.fillable == null) entry.fillable = declaredShapes.get(internalStyle)?.fillable;
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
