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

const OUTPUT_PATH = 'src/data/circuitikz-option-db.raw.json';

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
    throw new Error(`Unable to resolve official CircuitiKZ file: ${fileName}`);
  }
  return resolved;
}

function stripComments(source) {
  return source
    .replace(/(^|[^\\])%.*$/gm, '$1')
    .replace(/\r/g, '');
}

function normalizeCommentText(text) {
  return text
    .replace(/^\s*%+\s*/, '')
    .replace(/%+<+.*$/, '')
    .replace(/%+>+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function skipWhitespace(source, index) {
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

function readBalancedGroup(source, index, open = '{', close = '}') {
  if (source[index] !== open) return null;
  let depth = 0;
  let i = index;
  let value = '';
  while (i < source.length) {
    const char = source[i];
    if (char === open) {
      depth += 1;
      if (depth > 1) value += char;
    } else if (char === close) {
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
      calls.push({ args, index: start });
      cursor = index;
    } else {
      cursor = start + needle.length;
    }
  }
  return calls;
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
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

function inferOptionScope(key) {
  if (key.startsWith('/tikz/')) return 'tikz';
  if (key.startsWith('bipole/')) return 'bipole-family';
  if (key.startsWith('bipoles/')) return 'component-family';
  if (key.startsWith('tripoles/')) return 'component-family';
  if (key.startsWith('quadpoles/')) return 'component-family';
  if (key.startsWith('transistors/')) return 'component-family';
  if (key.startsWith('logic ports/')) return 'component-family';
  if (key.startsWith('multipoles/')) return 'component-family';
  if (key.startsWith('nodes/')) return 'node-family';
  if (key.startsWith('label/')) return 'label';
  if (key.startsWith('flow/')) return 'flow';
  if (key.startsWith('voltage ')) return 'voltage';
  return 'global';
}

function inferValueKind(operator) {
  if (operator === '.is choice') return 'choice';
  if (operator === '.is if') return 'boolean';
  if (operator === '.initial') return 'scalar';
  if (operator === '.default') return 'scalar';
  if (operator === '.style') return 'style';
  if (operator === '.add code' || operator === '.code') return 'code';
  return 'unknown';
}

function parseKeyDefinition(entry) {
  const match = entry.match(/^(.+?)\/(\.(?:is choice|is if|add code|code|style|default|initial))(?:(?:\s*=\s*|\s*)([\s\S]*))?$/);
  if (!match) return null;
  return {
    key: match[1].trim(),
    operator: match[2].trim(),
    rawValue: (match[3] ?? '').trim(),
  };
}

function collectOptionMetadata(rawSources) {
  const metadata = new Map();

  const upsert = (key) => {
    if (!metadata.has(key)) {
      metadata.set(key, {
        descriptions: [],
        sections: [],
      });
    }
    return metadata.get(key);
  };

  for (const [fileName, source] of Object.entries(rawSources)) {
    let currentSection = '';
    const lines = source.replace(/\r/g, '').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (/^%+/.test(trimmed) && !trimmed.includes('\\')) {
        const comment = normalizeCommentText(trimmed);
        if (
          comment &&
          !/^<+$/.test(comment) &&
          !/^>+$/.test(comment) &&
          !/^[-=*#]+$/.test(comment)
        ) {
          currentSection = comment;
        }
        continue;
      }

      const declarationMatch = line.match(/\\(?:ctikzset|pgfkeys)\{([\s\S]*?)\}\s*(?:%+\s*(.*))?$/);
      if (!declarationMatch) continue;

      const body = declarationMatch[1].trim();
      const trailingComment = normalizeCommentText(declarationMatch[2] ?? '');
      for (const item of splitTopLevelComma(body)) {
        const parsed = parseKeyDefinition(item.trim());
        if (!parsed) continue;
        const entry = upsert(parsed.key);
        if (trailingComment) pushUnique(entry.descriptions, trailingComment);
        if (currentSection) pushUnique(entry.sections, currentSection);
      }
    }
  }

  return metadata;
}

function collectOptionDefinitions(sources, optionMetadata) {
  const definitions = new Map();

  const upsert = (key, fileName) => {
    if (!definitions.has(key)) {
      const metadata = optionMetadata.get(key);
      definitions.set(key, {
        choices: [],
        description: metadata?.descriptions[0] ?? null,
        descriptionSources: metadata?.descriptions ?? [],
        defaultValue: null,
        files: [],
        isBoolean: false,
        key,
        operators: [],
        rawEntries: [],
        sections: metadata?.sections ?? [],
        scope: inferOptionScope(key),
        valueKind: 'unknown',
      });
    }
    const entry = definitions.get(key);
    pushUnique(entry.files, fileName);
    return entry;
  };

  for (const [fileName, source] of Object.entries(sources)) {
    for (const macroName of ['ctikzset', 'pgfkeys']) {
      for (const call of extractMacroCalls(source, macroName, 1)) {
        for (const item of splitTopLevelComma(call.args[0])) {
          const parsed = parseKeyDefinition(item);
          if (!parsed) continue;
          const keyEntry = upsert(parsed.key, fileName);
          pushUnique(keyEntry.operators, parsed.operator);
          keyEntry.rawEntries.push(item);
          if (parsed.operator === '.initial' || parsed.operator === '.default') {
            keyEntry.defaultValue = parsed.rawValue || keyEntry.defaultValue;
          }
          if (parsed.operator === '.is if') {
            keyEntry.isBoolean = true;
          }
          const inferred = inferValueKind(parsed.operator);
          if (keyEntry.valueKind === 'unknown' || keyEntry.valueKind === 'code') {
            keyEntry.valueKind = inferred;
          }
          if (parsed.operator === '.code') {
            const choiceMatch = parsed.key.match(/^(.*)\/([^/]+)$/);
            if (choiceMatch) {
              const parentKey = choiceMatch[1];
              const choiceValue = choiceMatch[2];
              const parentEntry = upsert(parentKey, fileName);
              if (parentEntry.operators.includes('.is choice')) {
                pushUnique(parentEntry.choices, choiceValue);
                parentEntry.valueKind = 'choice';
              }
            }
          }
        }
      }
    }
  }

  return [...definitions.values()]
    .map((entry) => ({
      ...entry,
      choices: entry.choices.sort((a, b) => a.localeCompare(b)),
      descriptionSources: unique(entry.descriptionSources),
      files: entry.files.sort((a, b) => a.localeCompare(b)),
      operators: entry.operators.sort((a, b) => a.localeCompare(b)),
      rawEntries: entry.rawEntries,
      section: unique(entry.sections)[0] ?? null,
      sections: unique(entry.sections),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function collectComponents(sources) {
  const components = new Map();
  const declaredShapes = new Map();
  const styleAliases = [];
  const pathStyles = [];
  const nodeStyles = [];

  function upsertComponent(tag) {
    if (!components.has(tag)) {
      components.set(tag, {
        aliases: [],
        anchors: [],
        className: '',
        displayName: '',
        family: '',
        fillable: undefined,
        group: '',
        kind: '',
        metadata: {},
        sourceFiles: [],
        sourceKinds: [],
        styleType: '',
        tag,
      });
    }
    return components.get(tag);
  }

  for (const [fileName, source] of Object.entries(sources)) {
    for (const call of extractMacroCalls(source, 'pgfcircdeclarebipolescaled', 7)) {
      const family = call.args[0].trim();
      const tag = call.args[3].trim();
      if (!isLiteralTag(tag)) continue;
      const anchors = [...call.args[6].matchAll(/\\anchor\{([^}]+)\}/g)].map((match) => match[1].trim());
      declaredShapes.set(tag, {
        anchors,
        family,
        fillable: inferFillableFromBody(call.args[6]),
        kind: 'bipole',
      });
      const entry = upsertComponent(tag);
      entry.kind ||= 'bipole';
      entry.family ||= family;
      if (entry.fillable == null) entry.fillable = declaredShapes.get(tag)?.fillable;
      for (const anchor of anchors) pushUnique(entry.anchors, anchor);
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-bipole');
    }

    for (const call of extractMacroCalls(source, 'pgfcircdeclarebipole', 6)) {
      const tag = call.args[2].trim();
      if (!isLiteralTag(tag)) continue;
      declaredShapes.set(tag, {
        anchors: [],
        family: 'default',
        fillable: inferFillableFromBody(call.args[5]),
        kind: 'bipole',
      });
      const entry = upsertComponent(tag);
      entry.kind ||= 'bipole';
      entry.family ||= 'default';
      if (entry.fillable == null) entry.fillable = declaredShapes.get(tag)?.fillable;
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-bipole');
    }

    for (const call of extractMacroCalls(source, 'pgfdeclareshape', 2)) {
      const tag = call.args[0].trim();
      if (!isLiteralTag(tag)) continue;
      const anchors = [...call.args[1].matchAll(/\\anchor\{([^}]+)\}/g)].map((match) => match[1].trim());
      declaredShapes.set(tag, {
        anchors,
        fillable: inferFillableFromBody(call.args[1]),
        kind: fileName === 'pgfcircshapes.tex' ? 'shape' : 'node',
      });
      const entry = upsertComponent(tag);
      entry.kind ||= fileName === 'pgfcircshapes.tex' ? 'shape' : 'node';
      if (entry.fillable == null) entry.fillable = declaredShapes.get(tag)?.fillable;
      for (const anchor of anchors) pushUnique(entry.anchors, anchor);
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-shape');
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

    for (const call of extractMacroCalls(source, 'pgfcirc@activate@bipole', 4)) {
      const pathName = call.args[1].trim();
      const baseNodeName = call.args[2].trim();
      const publicTag = call.args[3].trim();
      if (!isLiteralTag(pathName) || !isLiteralTag(baseNodeName) || !isLiteralTag(publicTag)) continue;
      const entry = upsertComponent(publicTag);
      entry.kind ||= 'bipole';
      entry.styleType ||= 'path-style';
      entry.metadata.baseNodeName = entry.metadata.baseNodeName || baseNodeName;
      entry.metadata.basePathName = entry.metadata.basePathName || pathName;
      entry.metadata.backingStyleKind = entry.metadata.backingStyleKind || 'path';
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-activated-bipole');
    }

    for (const call of extractMacroCalls(source, 'pgfcirc@activate@bipole@opt', 5)) {
      const pathName = call.args[1].trim();
      const baseNodeName = call.args[2].trim();
      const publicTag = call.args[3].trim();
      if (!isLiteralTag(pathName) || !isLiteralTag(baseNodeName) || !isLiteralTag(publicTag)) continue;
      const entry = upsertComponent(publicTag);
      entry.kind ||= 'bipole';
      entry.styleType ||= 'path-style';
      entry.metadata.baseNodeName = entry.metadata.baseNodeName || baseNodeName;
      entry.metadata.basePathName = entry.metadata.basePathName || pathName;
      entry.metadata.backingStyleKind = entry.metadata.backingStyleKind || 'path';
      pushUnique(entry.sourceFiles, fileName);
      pushUnique(entry.sourceKinds, 'official-activated-bipole');
    }
  }

  const nodeStyleByInternal = new Map();
  for (const { fileName, internalStyle, publicTag } of nodeStyles) {
    const entry = upsertComponent(publicTag);
    entry.styleType ||= 'node-style';
    entry.metadata.internalStyle = entry.metadata.internalStyle || internalStyle;
    entry.metadata.baseNodeName = entry.metadata.baseNodeName || internalStyle;
    entry.metadata.backingStyleKind = entry.metadata.backingStyleKind || 'node';
    const shapeDef = declaredShapes.get(internalStyle);
    if (shapeDef) {
      for (const anchor of shapeDef.anchors ?? []) pushUnique(entry.anchors, anchor);
      if (entry.fillable == null) entry.fillable = shapeDef.fillable;
      entry.kind ||= shapeDef.kind;
    }
    pushUnique(entry.sourceFiles, fileName);
    pushUnique(entry.sourceKinds, 'official-node-style');
    if (!nodeStyleByInternal.has(internalStyle)) nodeStyleByInternal.set(internalStyle, publicTag);
  }

  for (const { fileName, internalStyle, publicTag } of pathStyles) {
    const entry = upsertComponent(publicTag);
    entry.kind ||= 'bipole';
    entry.styleType ||= 'path-style';
    entry.metadata.pathInternal = entry.metadata.pathInternal || internalStyle;
    entry.metadata.basePathName = entry.metadata.basePathName || internalStyle;
    entry.metadata.backingStyleKind = entry.metadata.backingStyleKind || 'path';
    const concretePublicTag = nodeStyleByInternal.get(internalStyle);
    if (concretePublicTag) {
      const concrete = components.get(concretePublicTag);
      if (concrete) {
        entry.family ||= concrete.family;
        entry.group ||= concrete.group;
        entry.className ||= concrete.className;
        if (!entry.displayName || entry.displayName === titleCaseFromTag(publicTag)) {
          entry.displayName = concrete.displayName || entry.displayName;
        }
        for (const anchor of concrete.anchors ?? []) pushUnique(entry.anchors, anchor);
        if (entry.fillable == null) entry.fillable = concrete.fillable;
        pushUnique(entry.aliases, concretePublicTag);
      }
    }
    pushUnique(entry.sourceFiles, fileName);
    pushUnique(entry.sourceKinds, 'official-path-style');
  }

  for (const { aliasTag, fileName, sourceTag } of styleAliases) {
    const source = components.get(sourceTag);
    const entry = upsertComponent(aliasTag);
    if (source) {
      entry.kind ||= source.kind;
      entry.styleType ||= source.styleType;
      entry.family ||= source.family;
      entry.group ||= source.group;
      entry.className ||= source.className;
      entry.fillable ??= source.fillable;
      if (!entry.displayName || entry.displayName === titleCaseFromTag(aliasTag)) {
        entry.displayName = source.displayName || titleCaseFromTag(aliasTag);
      }
      for (const anchor of source.anchors ?? []) pushUnique(entry.anchors, anchor);
      pushUnique(entry.aliases, sourceTag);
      pushUnique(source.aliases, aliasTag);
    }
    entry.metadata.aliasOf = entry.metadata.aliasOf || sourceTag;
    pushUnique(entry.sourceFiles, fileName);
    pushUnique(entry.sourceKinds, 'official-style-alias');
  }

  return [...components.values()]
    .map((entry) => ({
      ...entry,
      aliases: unique(entry.aliases).sort((a, b) => a.localeCompare(b)),
      anchors: unique(entry.anchors).sort((a, b) => a.localeCompare(b)),
      className: entry.className || '',
      displayName: entry.displayName || titleCaseFromTag(entry.tag),
      family: entry.family || '',
      group: entry.group || '',
      sourceFiles: unique(entry.sourceFiles).sort((a, b) => a.localeCompare(b)),
      sourceKinds: unique(entry.sourceKinds).sort((a, b) => a.localeCompare(b)),
      styleType: entry.styleType || undefined,
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
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
  const rawOfficialSources = Object.fromEntries(
    await Promise.all(
      Object.entries(resolvedFiles).map(async ([fileName, filePath]) => [
        fileName,
        await readFile(filePath, 'utf8'),
      ]),
    ),
  );

  const packageSource = officialSources['circuitikz.sty'];
  const packageOptions = [...packageSource.matchAll(/\\DeclareOption\{([^}]+)\}/g)].map((match) => match[1].trim());
  const defaultOptionsMatch = packageSource.match(/\\ExecuteOptions\{([^}]*)\}/);
  const defaultPackageOptions = defaultOptionsMatch
    ? defaultOptionsMatch[1].split(',').map((value) => value.trim()).filter(Boolean)
    : [];

  const optionMetadata = collectOptionMetadata(rawOfficialSources);
  const optionDefinitions = collectOptionDefinitions(officialSources, optionMetadata);
  const components = collectComponents(officialSources);

  const output = {
    components,
    editorSchema: {
      line: {
        fields: [
          {
            control: 'select',
            defaultValue: 'node',
            key: 'command',
            label: 'Line',
            options: [
              { label: '\\node', value: 'node' },
              { label: '\\draw', value: 'draw' },
              { label: '\\path', value: 'path' },
              { label: '\\ctikzset', value: 'ctikzset' },
            ],
          },
        ],
      },
    },
    generatedAt: new Date().toISOString(),
    lineKinds: [
      { kind: 'node', label: '\\node', value: 'node' },
      { kind: 'draw', label: '\\draw', value: 'draw' },
      { kind: 'path', label: '\\path', value: 'path' },
      { kind: 'ctikzset', label: '\\ctikzset', value: 'ctikzset' },
    ],
    officialSourcePaths: resolvedFiles,
    packageOptions: {
      all: unique(packageOptions).sort((a, b) => a.localeCompare(b)),
      defaults: unique(defaultPackageOptions).sort((a, b) => a.localeCompare(b)),
    },
    summary: {
      componentCount: components.length,
      optionDefinitionCount: optionDefinitions.length,
    },
    optionDefinitions,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`wrote ${optionDefinitions.length} option definitions and ${components.length} components to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
