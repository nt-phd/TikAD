import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const FILES = [
  'pgfcirclabel.tex',
  'pgfcirccurrent.tex',
  'pgfcircvoltage.tex',
  'pgfcircflow.tex',
  'pgfcircpath.tex',
];

const OUTPUT_PATH = 'src/data/circuitikz-bipole-token-db.json';

const TOKEN_DEFINITIONS = [
  { match: /^(?:label|label above|label below|l|l\^|l_)$/, propertyId: 'label', label: 'Label', baseToken: 'l' },
  { match: /^(?:annotation|annotation above|annotation below|a|a\^|a_)$/, propertyId: 'annotation', label: 'Annotation', baseToken: 'a' },
  { match: /^(?:l2|l2 above|l2 below|l2\^|l2_)$/, propertyId: 'label2', label: 'Label (two-line)', baseToken: 'l2' },
  { match: /^(?:a2|a2 above|a2 below|a2\^|a2_)$/, propertyId: 'annotation2', label: 'Annotation (two-line)', baseToken: 'a2' },
  { match: /^v(?:[\^_<>]{0,2})$/, propertyId: 'voltage', label: 'Voltage', baseToken: 'v' },
  { match: /^i(?:[\^_<>]{0,2})$/, propertyId: 'current', label: 'Current', baseToken: 'i' },
  { match: /^f(?:[\^_<>]{0,2})$/, propertyId: 'flow', label: 'Flow', baseToken: 'f' },
];

function resolveTokenDefinition(token) {
  return TOKEN_DEFINITIONS.find((definition) => definition.match.test(token)) ?? null;
}

function resolveOfficialPath(fileName) {
  const candidate = `/usr/share/texlive/texmf-dist/tex/generic/circuitikz/${fileName}`;
  if (!existsSync(candidate)) {
    throw new Error(`Unable to resolve official CircuitiKZ file: ${fileName}`);
  }
  return candidate;
}

function splitTopLevelComma(source) {
  const parts = [];
  let current = '';
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);

      if (char === ',' && braceDepth === 0 && bracketDepth === 0) {
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

function parseModifierSemantics(token) {
  const definition = resolveTokenDefinition(token);
  if (!definition) return null;
  const suffix = token.slice(definition.baseToken.length);
  const semantics = {
    direction: null,
    horizontalPosition: null,
    rawSuffix: suffix,
    verticalPosition: null,
  };

  if (suffix.includes('>')) semantics.direction = 'forward';
  if (suffix.includes('<')) semantics.direction = 'backward';
  if (suffix.includes('^')) semantics.verticalPosition = 'above';
  if (suffix.includes('_')) semantics.verticalPosition = 'below';

  if (definition.baseToken === 'i' || definition.baseToken === 'f') {
    const directionIndex = suffix.search(/[<>]/);
    const verticalIndex = suffix.search(/[\^_]/);
    if (directionIndex >= 0 && verticalIndex >= 0) {
      semantics.horizontalPosition = directionIndex < verticalIndex ? 'before' : 'after';
    } else if (directionIndex >= 0) {
      semantics.horizontalPosition = suffix[directionIndex] === '<' ? 'before' : 'after';
    }
  }

  return semantics;
}

function parseAssignments(body) {
  const assignments = [];
  for (const match of body.matchAll(/\\circuitikzbasekey\/bipole\/([^=\s]+(?:\/[^=\s]+)*)\s*=\s*([^,\n}]+)/g)) {
    assignments.push({
      key: match[1].trim(),
      value: match[2].trim(),
    });
  }
  return assignments;
}

function parseTokenEntry(entry, fileName, section, comment) {
  const styleMatch = entry.match(/^([^/]+)\/\.(code|style|style args)(?:\s*=\s*|\s*)([\s\S]*)$/);
  if (!styleMatch) return null;
  const token = styleMatch[1].trim();
  const operator = styleMatch[2].trim();
  const body = styleMatch[3].trim();
  const definition = resolveTokenDefinition(token);
  if (!definition) return null;
  return {
    assignments: parseAssignments(body),
    comment: comment || null,
    file: fileName,
    operator,
    propertyId: definition.propertyId,
    propertyLabel: definition.label,
    section: section || null,
    semantics: parseModifierSemantics(token),
    token,
  };
}

function normalizeTerminalStyleToken(token) {
  return token.trim().replace(/\/$/, '');
}

function parseTerminalStyleEntry(entry, fileName) {
  const styleMatch = entry.match(/^([^/]+\/?)\/\.style\s*=\s*\{([\s\S]*)\}$/);
  if (!styleMatch) return null;
  const token = normalizeTerminalStyleToken(styleMatch[1]);
  if (!/^[*od.]?-[*od.]?$/.test(token)) return null;
  const body = styleMatch[2].trim();
  const leftMatch = body.match(/\\circuitikzbasekey\/bipole\/nodes\/left\s*=\s*([^,\n}]+)/);
  const rightMatch = body.match(/\\circuitikzbasekey\/bipole\/nodes\/right\s*=\s*([^,\n}]+)/);
  if (!leftMatch || !rightMatch) return null;
  return {
    file: fileName,
    left: leftMatch[1].trim(),
    right: rightMatch[1].trim(),
    token,
  };
}

async function main() {
  const resolvedFiles = Object.fromEntries(FILES.map((fileName) => [fileName, resolveOfficialPath(fileName)]));
  const properties = new Map();
  const terminalStyles = [];

  for (const [fileName, filePath] of Object.entries(resolvedFiles)) {
    const source = (await readFile(filePath, 'utf8')).replace(/\r/g, '');
    for (const call of extractMacroCalls(source, 'ctikzset', 1)) {
      const body = call.args[0].trim();
      for (const entry of splitTopLevelComma(body)) {
        const terminalStyle = parseTerminalStyleEntry(entry, fileName);
        if (terminalStyle) terminalStyles.push(terminalStyle);
        const parsed = parseTokenEntry(entry, fileName, null, null);
        if (!parsed) continue;
        if (!properties.has(parsed.propertyId)) {
          properties.set(parsed.propertyId, {
            id: parsed.propertyId,
            label: parsed.propertyLabel,
            tokens: [],
          });
        }
        properties.get(parsed.propertyId).tokens.push({
          assignments: parsed.assignments,
          description: parsed.comment,
          file: parsed.file,
          operator: parsed.operator,
          section: parsed.section,
          semantics: parsed.semantics,
          token: parsed.token,
        });
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    officialSourcePaths: resolvedFiles,
    terminalStyles: [...new Map(terminalStyles.map((style) => [style.token, style])).values()]
      .sort((a, b) => a.token.localeCompare(b.token)),
    properties: [...properties.values()]
      .map((property) => ({
        ...property,
        tokens: [...new Map(property.tokens.map((token) => [token.token, token])).values()]
          .sort((a, b) => a.token.localeCompare(b.token)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`wrote ${output.properties.length} bipole token properties to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
