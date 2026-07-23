import { symbolsDB } from './data/symbolsDB';
import { populateRegistryFromSymbolsDB } from './definitions/fromSymbolsDB';

import { LatexDocument } from './model/LatexDocument';
import { CircuitDocument } from './model/CircuitDocument';
import { SelectionState } from './model/SelectionState';
import { EventBus } from './utils/events';
import { registry } from './definitions/ComponentRegistry';
import { LatexCanvas, type RenderPurpose } from './canvas/LatexCanvas';
import { ToolManager } from './tools/ToolManager';
import { GENERIC_NODE_DEF_ID, parseCircuiTikZ, lineIndexFromId } from './codegen/CircuiTikZParser';
import { extractCtikzScales, extractTikzScale, scaleState } from './canvas/ScaleState';
import { formatCoord } from './codegen/CoordFormatter';
import { formatEndpoint } from './codegen/TikzEndpointFormatter';
import { formatLabel } from './codegen/LabelFormatter';
import { emitWirePath } from './codegen/WirePathEmitter';
import { emitPlacedNodeLine } from './codegen/NodeEmitter';
import { DEFAULT_BODY } from './model/LatexDocument';
import type {
  ComponentInstance,
  DrawingInstance,
  EditableConnectionOperator,
  EditableStatement,
  GridPoint,
  PositionSequencePreview,
  SourceCoordinateTranslation,
  TerminalMark,
  ToolType,
  WireInstance,
  WireRoutingMode,
} from './types';
import type { ToolContext } from './tools/BaseTool';
import type { ClipboardEntry } from './tools/SelectionClipboard';
import { materializeClipboardAt } from './tools/SelectionClipboard';
import { getEditableStatementModel } from './codegen/StatementEditorModel';
import {
  emitStructuredNodeStatement,
  emitStructuredStatementBody,
  parseStructuredNodeStatement,
  parseStructuredStatementBody,
} from './codegen/TikzStructuredStatement';
import { readTikzBalanced, scanTikzPoint, scanTikzPointSequence, skipTikzWhitespace } from './codegen/TikzPointParser';
import { resolvePositionSequencePreview, resolveStructuredPositionTexts } from './codegen/TikzPositionResolver';
import { splitOptions } from './codegen/TikzStatementSyntax';

let initialized = false;
let initPromise: Promise<ImperativeAppHandle> | null = null;

function collectSourceStatements(body: string): Array<{ lineIndex: number; text: string }> {
  const rawLines = body.split('\n');
  const statements: Array<{ lineIndex: number; text: string }> = [];
  let buf = '';
  let stmtLine = 0;

  for (let i = 0; i < rawLines.length; i += 1) {
    const stripped = rawLines[i].replace(/%.*$/, '').trim();
    if (!stripped || /^\\(begin|end)\b/.test(stripped)) continue;

    if (stripped.startsWith('\\ctikzset')) {
      if (buf.trim()) {
        statements.push({ text: buf.trim(), lineIndex: stmtLine });
        buf = '';
      }
      statements.push({ text: stripped, lineIndex: i });
      continue;
    }

    if (!buf) stmtLine = i;
    buf += (buf ? '\n' : '') + stripped;

    if (!buf.includes(';')) continue;
    const parts = buf.split(';');
    for (let p = 0; p < parts.length - 1; p += 1) {
      const text = parts[p].trim();
      if (text) statements.push({ text, lineIndex: stmtLine });
    }
    buf = parts[parts.length - 1].trim();
    if (buf) stmtLine = i;
  }

  if (buf.trim()) statements.push({ text: buf.trim(), lineIndex: stmtLine });
  return statements;
}

function collectInUseDefIdsFromBody(body: string): string[] {
  const defsByTikzName = new Map<string, string>();
  for (const def of registry.getAll()) {
    if (!defsByTikzName.has(def.tikzName)) defsByTikzName.set(def.tikzName, def.id);
  }

  const resolved = new Set<string>();
  const rememberOptionToken = (token: string) => {
    const trimmed = token.trim();
    if (!trimmed) return;
    const candidate = trimmed.includes('=') ? trimmed.slice(0, trimmed.indexOf('=')).trim() : trimmed;
    const defId = defsByTikzName.get(candidate);
    if (defId) resolved.add(defId);
  };

  for (const { text } of collectSourceStatements(body)) {
    if (text.startsWith('\\ctikzset')) continue;
    let cursor = 0;
    while (cursor < text.length) {
      if (text[cursor] !== '[') {
        cursor += 1;
        continue;
      }
      const balanced = readTikzBalanced(text, cursor, '[', ']');
      if (!balanced) {
        cursor += 1;
        continue;
      }
      const options = splitOptions(balanced.text.slice(1, -1).trim());
      for (const option of options) rememberOptionToken(option);
      cursor = balanced.end;
    }
  }

  return [...resolved];
}

function findPictureEndMarker(body: string): string | null {
  if (body.includes('\\end{circuitikz}')) return '\\end{circuitikz}';
  if (body.includes('\\end{tikzpicture}')) return '\\end{tikzpicture}';
  return null;
}

function appendLineToBody(body: string, line: string): string {
  const marker = findPictureEndMarker(body);
  if (!marker) return body + '\n' + line;
  const idx = body.lastIndexOf(marker);
  return body.slice(0, idx) + '  ' + line + '\n' + body.slice(idx);
}

function appendLinesToBody(body: string, linesToAppend: string[]): { body: string; startLineIndex: number } {
  const marker = findPictureEndMarker(body);
  const lines = body.split('\n');
  const markerIndex = marker ? lines.findIndex((line) => line.includes(marker)) : -1;
  const insertIndex = markerIndex >= 0 ? markerIndex : lines.length;
  const indented = linesToAppend.map((line) => `  ${line}`);
  lines.splice(insertIndex, 0, ...indented);
  return { body: lines.join('\n'), startLineIndex: insertIndex };
}

function terminalString(start?: TerminalMark, end?: TerminalMark): string {
  const s =
    start === 'circ' ? '*' :
      start === 'ocirc' ? 'o' :
      start === 'diamondpole' ? 'd' :
      start === 'rectjoinfill' ? '.' :
      '';
  const e =
    end === 'circ' ? '*' :
      end === 'ocirc' ? 'o' :
      end === 'diamondpole' ? 'd' :
      end === 'rectjoinfill' ? '.' :
      '';
  return `${s}-${e}`;
}

function emitComponentLine(comp: ComponentInstance): string | null {
  const def = registry.get(comp.defId);
  // A generic (uncatalogued) node has no real tikzName — its plain TikZ style
  // keyword (e.g. `draw`) already lives at the front of `props.options`.
  const tikzName = comp.defId === GENERIC_NODE_DEF_ID ? '' : def?.tikzName ?? comp.defId;
  if (comp.type === 'bipole') {
    const opts: string[] = [tikzName];
    const term = terminalString(comp.props.startTerminal, comp.props.endTerminal);
    if (term !== '-') opts.push(term);
    if (comp.props.annotation) opts.push(`a=${formatLabel(comp.props.annotation)}`);
    if (comp.props.label) opts.push(`l=${formatLabel(comp.props.label)}`);
    if (comp.props.voltage) opts.push(`v=${formatLabel(comp.props.voltage)}`);
    if (comp.props.current) opts.push(`i=${formatLabel(comp.props.current)}`);
    if (comp.props.flow) opts.push(`f=${formatLabel(comp.props.flow)}`);
    return `\\draw ${formatEndpoint(comp.start, comp.startRef)} to[${opts.join(', ')}] ${formatEndpoint(comp.end, comp.endRef)};`;
  }
  if (comp.type === 'monopole') {
    return emitPlacedNodeLine(comp, tikzName);
  }
  if (comp.type === 'node') {
    return emitPlacedNodeLine(comp, tikzName);
  }
  return null;
}

function emitComponentSegment(comp: ComponentInstance): string | null {
  const def = registry.get(comp.defId);
  const tikzName = comp.defId === GENERIC_NODE_DEF_ID ? '' : def?.tikzName ?? comp.defId;
  if (comp.type === 'bipole') {
    const opts: string[] = [tikzName];
    const term = terminalString(comp.props.startTerminal, comp.props.endTerminal);
    if (term !== '-') opts.push(term);
    if (comp.props.annotation) opts.push(`a=${formatLabel(comp.props.annotation)}`);
    if (comp.props.label) opts.push(`l=${formatLabel(comp.props.label)}`);
    if (comp.props.voltage) opts.push(`v=${formatLabel(comp.props.voltage)}`);
    if (comp.props.current) opts.push(`i=${formatLabel(comp.props.current)}`);
    if (comp.props.flow) opts.push(`f=${formatLabel(comp.props.flow)}`);
    return `${formatEndpoint(comp.start, comp.startRef)} to[${opts.join(', ')}] ${formatEndpoint(comp.end, comp.endRef)}`;
  }
  if (comp.type === 'monopole' || comp.type === 'node') {
    const optionParts = tikzName ? [tikzName] : [];
    const extraOptions = (comp.props.options ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !part.startsWith('rotate='));
    if (comp.rotation) extraOptions.push(`rotate=${comp.rotation}`);
    if (extraOptions.length > 0) optionParts.push(extraOptions.join(', '));
    return `${formatCoord(comp.position)} node[${optionParts.join(', ')}] {}`;
  }
  return null;
}

function emitWireLine(wire: WireInstance, asSegment = false): string {
  if (wire.points.length < 2) return asSegment ? '' : '\\draw ;';
  const path = emitWirePath(wire);
  return asSegment ? path : `\\draw ${path};`;
}

function emitDrawingLine(drawing: DrawingInstance): string {
  switch (drawing.kind) {
    case 'line':
      return `\\draw[${drawing.props.options || 'thin'}] ${formatCoord(drawing.start)} -- ${formatCoord(drawing.end)};`;
    case 'arrow':
      return `\\draw[${drawing.props.options || '->'}] ${formatCoord(drawing.start)} -- ${formatCoord(drawing.end)};`;
    case 'text':
      {
        const optionParts: string[] = [];
        if (drawing.props.anchor) optionParts.push(`anchor=${drawing.props.anchor}`);
        if (drawing.props.rotation) optionParts.push(`rotate=${drawing.props.rotation}`);
        if (drawing.props.scale) optionParts.push(`scale=${drawing.props.scale}`);
        if (drawing.props.options) optionParts.push(drawing.props.options);
        const options = optionParts.length > 0 ? `[${optionParts.join(', ')}]` : '';
        return `\\node${options} at ${formatCoord(drawing.position)} {${drawing.props.text ?? 'Text'}};`;
      }
    case 'rectangle':
      return `\\draw[${drawing.props.options || 'thin'}] ${formatCoord(drawing.start)} rectangle ${formatCoord(drawing.end)};`;
    case 'circle':
      return `\\draw[${drawing.props.options || 'thin'}] ${formatCoord(drawing.center)} circle (${drawing.radius});`;
    case 'bezier':
      return `\\draw[${drawing.props.options || 'thin'}] ${formatCoord(drawing.start)} .. controls ${formatCoord(drawing.control1)} and ${formatCoord(drawing.control2)} .. ${formatCoord(drawing.end)};`;
  }
}

function emitClipboardEntry(entry: ClipboardEntry): string | null {
  if (entry.kind === 'component') return emitComponentLine(entry.item);
  if (entry.kind === 'wire') return emitWireLine(entry.item);
  return emitDrawingLine(entry.item);
}

function updateBodyLinePreservingStructure(body: string, lineIndex: number, replacement: string): string {
  const lines = body.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return body;
  const original = lines[lineIndex];
  const indent = original.match(/^\s*/)?.[0] ?? '';
  const trimmed = original.trim();
  const compactSegment = trimmed.startsWith('(');
  const normalized = compactSegment
    ? replacement.replace(/^\\(?:draw|path)\s+/, '').replace(/;$/, '')
    : replacement;
  lines[lineIndex] = `${indent}${normalized}`;

  return lines.join('\n');
}

function removeBodyLines(body: string, lineIndices: number[]): string {
  const lines = body.split('\n');
  const sorted = [...new Set(lineIndices)].sort((a, b) => b - a);
  for (const lineIndex of sorted) {
    if (lineIndex >= 0 && lineIndex < lines.length) lines.splice(lineIndex, 1);
  }
  const cleaned: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^\\(?:draw|path)(?:\[[^\]]*\])?\s*$/.test(trimmed)) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      const nextTrimmed = lines[j]?.trim() ?? '';
      if (!nextTrimmed.startsWith('(') && !nextTrimmed.startsWith('node')) {
        continue;
      }
    }
    cleaned.push(lines[i]);
  }
  return cleaned.join('\n');
}

function lineIdParts(id: string): { lineIndex: number; subIndex: number | null } {
  const m = id.match(/^line:(\d+)(?::(\d+))?$/);
  return {
    lineIndex: m ? Number.parseInt(m[1], 10) : -1,
    subIndex: m?.[2] ? Number.parseInt(m[2], 10) : null,
  };
}

function idsAtLineIndex(doc: CircuitDocument, body: string, lineIndex: number): string[] {
  if (lineIndex < 0) return [];
  const matches = [
    ...doc.components.map((component) => component.id),
    ...doc.wires.map((wire) => wire.id),
    ...doc.drawPaths.map((dp) => dp.id),
    ...doc.drawings.map((drawing) => drawing.id),
  ].filter((id) => lineIdParts(id).lineIndex === lineIndex);
  if (matches.length > 0) return [...new Set(matches)];
  return getEditableStatementModel(body, `line:${lineIndex}`) ? [`line:${lineIndex}`] : [];
}

function normalizeMultilineNodeStatements(body: string): string {
  const lines = body.split('\n');
  const normalized: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed.startsWith('\\node') || trimmed.endsWith(';')) {
      normalized.push(line);
      continue;
    }

    const statementLines = [trimmed];
    let j = i + 1;
    while (j < lines.length) {
      const nextTrimmed = lines[j].trim();
      if (!nextTrimmed) {
        j += 1;
        continue;
      }
      statementLines.push(nextTrimmed);
      if (nextTrimmed.endsWith(';')) break;
      j += 1;
    }

    if (statementLines.length > 1 && statementLines[statementLines.length - 1].endsWith(';')) {
      const indent = line.match(/^\s*/)?.[0] ?? '';
      normalized.push(`${indent}${statementLines.join(' ')}`);
      i = j;
      continue;
    }

    normalized.push(line);
  }

  return normalized.join('\n');
}

function replaceBodyLinesWithGroups(
  body: string,
  replacements: Map<number, Array<{ id: string; line: string }>>,
): { body: string; idMap: Map<string, string> } {
  const lines = body.split('\n');
  const nextLines: string[] = [];
  const idMap = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const group = replacements.get(i);
    if (!group) {
      nextLines.push(lines[i]);
      continue;
    }
    const indent = lines[i].match(/^\s*/)?.[0] ?? '';
    for (const entry of group) {
      const nextLineIndex = nextLines.length;
      nextLines.push(`${indent}${entry.line}`);
      idMap.set(entry.id, `line:${nextLineIndex}`);
    }
  }

  return { body: nextLines.join('\n'), idMap };
}

function collectGroupedLineReplacements(doc: CircuitDocument): Map<number, Array<{ id: string; line: string }>> {
  const allEntries = [
    ...doc.components.map((comp) => ({ id: comp.id, line: emitComponentLine(comp) })),
    ...doc.wires.map((wire) => ({ id: wire.id, line: emitWireLine(wire) })),
    ...doc.drawings.map((drawing) => ({ id: drawing.id, line: emitDrawingLine(drawing) })),
  ].filter((entry): entry is { id: string; line: string } => Boolean(entry.line));

  const replacements = new Map<number, Array<{ id: string; line: string }>>();
  for (const entry of allEntries) {
    const parts = lineIdParts(entry.id);
    if (parts.subIndex === null || parts.lineIndex < 0) continue;
    const bucket = replacements.get(parts.lineIndex) ?? [];
    bucket.push(entry);
    replacements.set(parts.lineIndex, bucket);
  }
  for (const [lineIndex, bucket] of replacements) {
    bucket.sort((a, b) => (lineIdParts(a.id).subIndex ?? 0) - (lineIdParts(b.id).subIndex ?? 0));
    replacements.set(lineIndex, bucket);
  }
  return replacements;
}

function emitEditableStatement(statement: EditableStatement): string | null {
  const structured = {
    positionTexts: statement.positionTexts,
    segments: statement.segments,
  };
  if (statement.command === 'node') {
    const body = emitStructuredNodeStatement(structured);
    return body ? `\\${body};` : null;
  }
  const body = emitStructuredStatementBody(structured);
  const commandOptions = statement.commandOptionsText?.trim();
  return body ? `\\${statement.command}${commandOptions ? `[${commandOptions}]` : ''} ${body};` : null;
}

function reverseConnectionOperator(operator: EditableConnectionOperator): EditableConnectionOperator {
  if (operator === '|-') return '-|';
  if (operator === '-|') return '|-';
  return operator;
}

function isConnectionOnlyStatement(statement: EditableStatement): boolean {
  return statement.segments.length > 0 && statement.segments.every((segment) => segment.kind === 'connection');
}

function isDrawPathStatement(statement: EditableStatement): boolean {
  return statement.segments.length > 0 && statement.segments.every((segment) => (
    segment.kind === 'connection' || segment.kind === 'bipole'
  ));
}

function reverseDrawPathStatement(statement: EditableStatement): EditableStatement {
  return {
    ...statement,
    positionTexts: [...statement.positionTexts].reverse(),
    segments: [...statement.segments]
      .reverse()
      .map((segment) => {
        if (segment.kind === 'connection') {
          return { ...segment, operator: reverseConnectionOperator(segment.operator) };
        }
        if (segment.kind === 'bipole') {
          return {
            ...segment,
            props: {
              ...segment.props,
              startTerminal: segment.props.endTerminal,
              endTerminal: segment.props.startTerminal,
            },
          };
        }
        return segment;
      }),
  };
}

function parseDrawStatement(line: string): EditableStatement | null {
  const match = line.trim().replace(/;$/, '').match(/^\\(draw|path)(?:\[([\s\S]*?)\])?\s+([\s\S]+)$/);
  if (!match) return null;
  const structured = parseStructuredStatementBody(match[3].trim());
  if (!structured) return null;
  return {
    command: match[1] as EditableStatement['command'],
    commandOptionsText: match[2]?.trim() || undefined,
    positionTexts: structured.positionTexts,
    rawStatementText: line.trim(),
    segments: structured.segments,
    sourceLineIndex: -1,
  };
}

function parseNodeStatement(line: string): EditableStatement | null {
  const trimmed = line.trim().replace(/;$/, '');
  if (!trimmed.startsWith('\\node')) return null;
  const structured = parseStructuredNodeStatement(trimmed.slice('\\'.length));
  if (!structured) return null;
  return {
    command: 'node',
    commandOptionsText: undefined,
    positionTexts: structured.positionTexts,
    rawStatementText: line.trim(),
    segments: structured.segments,
    sourceLineIndex: -1,
  };
}

function replaceAbsolutePointReferencesInLine(line: string, targetPoint: GridPoint, nodeName: string): string {
  const { code, comment } = splitLineComment(line);
  let cursor = 0;
  let result = '';
  while (cursor < code.length) {
    const pointStart = skipTikzWhitespace(code, cursor);
    const point = scanTikzPoint(code, cursor);
    if (!point) {
      result += code[cursor];
      cursor += 1;
      continue;
    }
    result += code.slice(cursor, pointStart);
    let replacement: string | null = null;
    if (point.point.relativeMode === 'none' && point.point.kind === 'regular') {
      const parsedPoint = parseAbsoluteNumericPoint(point.point.raw);
      if (parsedPoint && pointsEqual(parsedPoint, targetPoint)) {
        replacement = `(${nodeName})`;
      }
    }
    result += replacement ?? point.point.raw;
    cursor = point.end;
  }
  return result + comment;
}

function rewriteMatchingCoordinatesWithNodeName(
  body: string,
  targetPoint: GridPoint,
  nodeName: string,
  excludedLineIndex: number,
): string {
  const lines = body.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (index === excludedLineIndex) continue;
    lines[index] = replaceAbsolutePointReferencesInLine(lines[index], targetPoint, nodeName);
  }
  return lines.join('\n');
}

function parseSimpleNodeReference(innerRaw: string): { anchor?: string; nodeName: string } | null {
  const trimmed = innerRaw.trim();
  const match = trimmed.match(/^([A-Za-z][\w-]*)(?:\s*\.\s*([^\s()]+))?$/);
  if (!match) return null;
  return {
    nodeName: match[1],
    anchor: match[2]?.trim() || undefined,
  };
}

function replaceDeletedNodeReferencesInLine(
  line: string,
  nodeNames: Set<string>,
  doc: CircuitDocument,
): string {
  const { code, comment } = splitLineComment(line);
  let cursor = 0;
  let result = '';
  while (cursor < code.length) {
    const pointStart = skipTikzWhitespace(code, cursor);
    const point = scanTikzPoint(code, cursor);
    if (!point) {
      result += code[cursor];
      cursor += 1;
      continue;
    }
    result += code.slice(cursor, pointStart);
    let replacement: string | null = null;
    if (point.point.relativeMode === 'none' && point.point.kind === 'node-ref') {
      const parsedRef = parseSimpleNodeReference(point.point.innerRaw);
      if (parsedRef && nodeNames.has(parsedRef.nodeName)) {
        const resolvedPoint = doc.getSymbolPoint(parsedRef.nodeName, parsedRef.anchor);
        if (resolvedPoint) replacement = formatCoord(resolvedPoint);
      }
    }
    result += replacement ?? point.point.raw;
    cursor = point.end;
  }
  return result + comment;
}

function replaceDeletedNodeReferencesInBody(
  body: string,
  nodeNames: Set<string>,
  doc: CircuitDocument,
): string {
  if (nodeNames.size === 0) return body;
  const lines = body.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    lines[index] = replaceDeletedNodeReferencesInLine(lines[index], nodeNames, doc);
  }
  return lines.join('\n');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function moveNodeDefinitionBeforeFirstReference(
  body: string,
  nodeName: string,
  nodeLineIndex: number,
): string {
  const lines = body.split('\n');
  if (nodeLineIndex < 0 || nodeLineIndex >= lines.length) return body;
  const nodeLine = lines[nodeLineIndex];
  const escapedNodeName = escapeRegex(nodeName);
  const referencePattern = new RegExp(`\\(${escapedNodeName}(?:\\s*\\)|\\.)`);
  let firstReferenceIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (index === nodeLineIndex) continue;
    const code = splitLineComment(lines[index]).code;
    if (!referencePattern.test(code)) continue;
    firstReferenceIndex = index;
    break;
  }
  if (firstReferenceIndex < 0 || firstReferenceIndex >= nodeLineIndex) return body;
  lines.splice(nodeLineIndex, 1);
  lines.splice(firstReferenceIndex, 0, nodeLine);
  return lines.join('\n');
}

function findNodeDefinitionLineIndex(body: string, nodeName: string): number {
  const escapedNodeName = escapeRegex(nodeName);
  const definitionPattern = new RegExp(`^\\\\node(?:\\[[\\s\\S]*?\\])?\\s*\\(${escapedNodeName}\\)`);
  const lines = body.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (definitionPattern.test(lines[index].trim())) return index;
  }
  return -1;
}

function referencedNodeNamesInLine(line: string): Set<string> {
  const { code } = splitLineComment(line);
  const nodeNames = new Set<string>();
  let cursor = 0;
  while (cursor < code.length) {
    const point = scanTikzPoint(code, cursor);
    if (!point) {
      cursor += 1;
      continue;
    }
    if (point.point.relativeMode === 'none' && point.point.kind === 'node-ref') {
      const parsedRef = parseSimpleNodeReference(point.point.innerRaw);
      if (parsedRef) nodeNames.add(parsedRef.nodeName);
    }
    cursor = point.end;
  }
  return nodeNames;
}

// Whatever just changed in the body, any node now referenced by name must be defined
// earlier than its first reference — otherwise `moveNodeDefinitionBeforeFirstReference`
// reorders it. Run over the whole body (not just the edited line) since a single change
// (paste, multi-selection drag, grouped statement rewrite, ...) can touch several lines
// at once, and is a no-op for lines that are already in order.
function moveAllReferencedNodeDefinitionsForward(body: string): string {
  let nextBody = body;
  const seenNodeNames = new Set<string>();
  for (const line of nextBody.split('\n')) {
    for (const nodeName of referencedNodeNamesInLine(line)) seenNodeNames.add(nodeName);
  }
  for (const nodeName of seenNodeNames) {
    const nodeLineIndex = findNodeDefinitionLineIndex(nextBody, nodeName);
    if (nodeLineIndex < 0) continue;
    nextBody = moveNodeDefinitionBeforeFirstReference(nextBody, nodeName, nodeLineIndex);
  }
  return nextBody;
}

function mergeSnappedDrawStatement(
  body: string,
  appendedLine: string,
  doc: CircuitDocument,
): string | null {
  const appended = parseDrawStatement(appendedLine);
  if (!appended || !isDrawPathStatement(appended)) return null;
  const resolved = resolveStructuredPositionTexts(appended.positionTexts, doc, registry);
  if (!resolved || resolved.length < 2) return null;
  const firstPoint = resolved[0].point;
  const lastPoint = resolved[resolved.length - 1].point;

  let matchCount = 0;
  let merged: EditableStatement | null = null;

  for (const drawPath of doc.drawPaths) {
    if (drawPath.positionSequences.length < 2) continue;
    const existing = getEditableStatementModel(body, drawPath.id);
    if (!existing || !isDrawPathStatement(existing)) continue;

    const startPoint = drawPath.positionSequences[0].point;
    const endPoint = drawPath.positionSequences[drawPath.positionSequences.length - 1].point;

    let incoming = appended;
    let nextPositionTexts: string[] | null = null;
    let nextSegments = null as EditableStatement['segments'] | null;

    if (pointsEqual(lastPoint, startPoint)) {
      nextPositionTexts = [...incoming.positionTexts, ...existing.positionTexts.slice(1)];
      nextSegments = [...incoming.segments, ...existing.segments];
    } else if (pointsEqual(firstPoint, endPoint)) {
      nextPositionTexts = [...existing.positionTexts, ...incoming.positionTexts.slice(1)];
      nextSegments = [...existing.segments, ...incoming.segments];
    } else if (pointsEqual(firstPoint, startPoint)) {
      incoming = reverseDrawPathStatement(appended);
      nextPositionTexts = [...incoming.positionTexts, ...existing.positionTexts.slice(1)];
      nextSegments = [...incoming.segments, ...existing.segments];
    } else if (pointsEqual(lastPoint, endPoint)) {
      incoming = reverseDrawPathStatement(appended);
      nextPositionTexts = [...existing.positionTexts, ...incoming.positionTexts.slice(1)];
      nextSegments = [...existing.segments, ...incoming.segments];
    }

    if (!nextPositionTexts || !nextSegments) continue;
    matchCount += 1;
    if (matchCount > 1) return null;
    merged = {
      ...existing,
      positionTexts: nextPositionTexts,
      segments: nextSegments,
    };
  }

  return merged ? applyEditableStatementToBody(body, merged) : null;
}

// Splits a `\draw (a) -- (b) -- (c) ...;` at an intermediate vertex into two
// statements: `\draw (a) -- (b);` (replacing the original line) and
// `\draw (b) -- (c) ...;` (appended as a new line). The dual of
// `mergeSnappedDrawStatement` above.
function splitDrawPathAtIndex(
  body: string,
  statement: EditableStatement,
  positionIndex: number,
): { body: string; secondLineIndex: number } | null {
  if (!isDrawPathStatement(statement)) return null;
  if (positionIndex <= 0 || positionIndex >= statement.positionTexts.length - 1) return null;

  const firstStatement: EditableStatement = {
    ...statement,
    positionTexts: statement.positionTexts.slice(0, positionIndex + 1),
    segments: statement.segments.slice(0, positionIndex),
  };
  const secondStatement: EditableStatement = {
    ...statement,
    positionTexts: statement.positionTexts.slice(positionIndex),
    segments: statement.segments.slice(positionIndex),
  };
  const secondLine = emitEditableStatement(secondStatement);
  if (!secondLine) return null;

  const firstBody = applyEditableStatementToBody(body, firstStatement);
  const appended = appendLinesToBody(firstBody, [secondLine]);
  return { body: appended.body, secondLineIndex: appended.startLineIndex };
}

// Merges two `\draw` statements that share an endpoint into a single statement,
// reversing whichever side is needed (via reverseDrawPathStatement) so the shared
// vertex sits at the join. The dual of splitDrawPathAtIndex above. Returns null if
// the two statements don't share exactly one terminal vertex.
function mergeDrawPathStatements(
  first: EditableStatement,
  second: EditableStatement,
  firstEndPoint: GridPoint,
  firstStartPoint: GridPoint,
  secondStartPoint: GridPoint,
  secondEndPoint: GridPoint,
): EditableStatement | null {
  if (!isDrawPathStatement(first) || !isDrawPathStatement(second)) return null;

  if (pointsEqual(firstEndPoint, secondStartPoint)) {
    return {
      ...first,
      positionTexts: [...first.positionTexts, ...second.positionTexts.slice(1)],
      segments: [...first.segments, ...second.segments],
    };
  }
  if (pointsEqual(firstStartPoint, secondEndPoint)) {
    return {
      ...second,
      positionTexts: [...second.positionTexts, ...first.positionTexts.slice(1)],
      segments: [...second.segments, ...first.segments],
    };
  }
  if (pointsEqual(firstStartPoint, secondStartPoint)) {
    const reversedFirst = reverseDrawPathStatement(first);
    return {
      ...reversedFirst,
      positionTexts: [...reversedFirst.positionTexts, ...second.positionTexts.slice(1)],
      segments: [...reversedFirst.segments, ...second.segments],
    };
  }
  if (pointsEqual(firstEndPoint, secondEndPoint)) {
    const reversedSecond = reverseDrawPathStatement(second);
    return {
      ...first,
      positionTexts: [...first.positionTexts, ...reversedSecond.positionTexts.slice(1)],
      segments: [...first.segments, ...reversedSecond.segments],
    };
  }
  return null;
}

function appendSnapAwareLine(
  body: string,
  line: string,
  doc: CircuitDocument,
  snapEnabled: boolean,
): string {
  if (!snapEnabled) return appendLineToBody(body, line);

  const mergedBody = mergeSnappedDrawStatement(body, line, doc);
  if (mergedBody) return mergedBody;

  const appended = appendLinesToBody(body, [line]);
  const nodeStatement = parseNodeStatement(line);
  const nodeSegment = nodeStatement?.segments[0];
  if (
    !nodeStatement
    || nodeStatement.positionTexts.length !== 1
    || nodeSegment?.kind !== 'node'
    || !nodeSegment.nodeName
  ) {
    return appended.body;
  }

  const resolved = resolvePositionSequencePreview(nodeStatement.positionTexts[0], doc, registry);
  if (!resolved) return appended.body;
  const rewrittenBody = rewriteMatchingCoordinatesWithNodeName(
    appended.body,
    resolved.point,
    nodeSegment.nodeName,
    appended.startLineIndex,
  );
  return moveNodeDefinitionBeforeFirstReference(
    rewrittenBody,
    nodeSegment.nodeName,
    appended.startLineIndex,
  );
}

function findGroupedEntityLineIndex(body: string, commandLineIndex: number, subIndex: number): number {
  const lines = body.split('\n');
  let seen = -1;
  for (let i = commandLineIndex + 1; i < lines.length; i++) {
    const stripped = lines[i].replace(/%.*$/, '').trim();
    if (!stripped) continue;
    if (stripped === ';') break;
    if (stripped.startsWith('\\')) break;
    seen += 1;
    if (seen === subIndex) return i;
  }
  return -1;
}

function splitLineComment(line: string): { code: string; comment: string } {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '%' && line[i - 1] !== '\\') {
      return { code: line.slice(0, i), comment: line.slice(i) };
    }
  }
  return { code: line, comment: '' };
}

function formatTranslatedNumber(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  const rounded = Math.abs(value) < 1e-9 ? 0 : value;
  return rounded.toFixed(4).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function parseAbsoluteNumericPoint(rawPoint: string): GridPoint | null {
  const match = rawPoint.match(/^\(\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\)$/);
  if (!match) return null;
  return { x: Number.parseFloat(match[1]), y: -Number.parseFloat(match[2]) };
}

function translateAbsoluteNumericPoint(rawPoint: string, dx: number, dy: number): string | null {
  const match = rawPoint.match(/^(\()(\s*)([+-]?(?:\d+(?:\.\d+)?|\.\d+))(\s*),(\s*)([+-]?(?:\d+(?:\.\d+)?|\.\d+))(\s*)(\))$/);
  if (!match) return null;
  const translatedX = Number.parseFloat(match[3]) + dx;
  const translatedY = Number.parseFloat(match[6]) - dy;
  return `${match[1]}${match[2]}${formatTranslatedNumber(translatedX)}${match[4]},${match[5]}${formatTranslatedNumber(translatedY)}${match[7]}${match[8]}`;
}

function replaceAbsoluteNumericPoint(rawPoint: string, targetPoint: GridPoint): string | null {
  const match = rawPoint.match(/^(\()(\s*)([+-]?(?:\d+(?:\.\d+)?|\.\d+))(\s*),(\s*)([+-]?(?:\d+(?:\.\d+)?|\.\d+))(\s*)(\))$/);
  if (!match) return null;
  return `${match[1]}${match[2]}${formatTranslatedNumber(targetPoint.x)}${match[4]},${match[5]}${formatTranslatedNumber(-targetPoint.y)}${match[7]}${match[8]}`;
}

function pointsEqual(a: GridPoint, b: GridPoint): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

function collectAbsoluteNumericPointsFromPositionText(positionText: string): GridPoint[] {
  const sequence = scanTikzPointSequence(positionText, 0);
  if (!sequence) return [];
  return sequence.points
    .filter((point) => point.relativeMode === 'none' && point.kind === 'regular')
    .map((point) => parseAbsoluteNumericPoint(point.raw))
    .filter((point): point is GridPoint => Boolean(point));
}

function expandSourceTranslationTargets(body: string, translation: SourceCoordinateTranslation): SourceCoordinateTranslation[] {
  if (translation.matchPoint) return [translation];
  const statement = getEditableStatementModel(body, translation.id);
  if (!statement || statement.sourceSubIndex == null) return [translation];
  const matchPoints = statement.positionTexts.flatMap((positionText) => collectAbsoluteNumericPointsFromPositionText(positionText));
  if (matchPoints.length === 0) return [translation];
  return matchPoints.map((matchPoint) => ({
    ...translation,
    matchPoint,
  }));
}

function translateAbsoluteNumericCoordinatesInLine(line: string, translations: SourceCoordinateTranslation[]): string {
  if (translations.length === 0) return line;
  const { code, comment } = splitLineComment(line);
  let cursor = 0;
  let result = '';
  while (cursor < code.length) {
    const pointStart = skipTikzWhitespace(code, cursor);
    const point = scanTikzPoint(code, cursor);
    if (!point || pointStart >= point.end) {
      result += code[cursor];
      cursor += 1;
      continue;
    }
    result += code.slice(cursor, pointStart);
    let translated: string | null = null;
    if (point.point.relativeMode === 'none' && point.point.kind === 'regular') {
      const parsedPoint = parseAbsoluteNumericPoint(point.point.raw);
      const match = parsedPoint
        ? translations.find((translation) => !translation.matchPoint || pointsEqual(parsedPoint, translation.matchPoint))
        : undefined;
      translated = match
        ? (match.targetPoint
            ? replaceAbsoluteNumericPoint(point.point.raw, match.targetPoint)
            : translateAbsoluteNumericPoint(point.point.raw, match.dx, match.dy))
        : null;
    }
    result += translated ?? point.point.raw;
    cursor = point.end;
  }
  return result + comment;
}

function resolveSourceLineIndex(body: string, id: string): number {
  const lines = body.split('\n');
  const parts = lineIdParts(id);
  if (parts.subIndex != null && parts.lineIndex >= 0) {
    const sourceLine = lines[parts.lineIndex]?.trim() ?? '';
    if (/^\\(draw|path)(?:\[([\s\S]*?)\])?\s*$/.test(sourceLine)) {
      const groupedLineIndex = findGroupedEntityLineIndex(body, parts.lineIndex, parts.subIndex);
      if (groupedLineIndex >= 0) return groupedLineIndex;
    }
  }
  return lineIndexFromId(id);
}

function dedupeSourceTranslations(translations: SourceCoordinateTranslation[]): SourceCoordinateTranslation[] {
  const seen = new Set<string>();
  const deduped: SourceCoordinateTranslation[] = [];
  for (const translation of translations) {
    const key = translation.matchPoint
      ? `${translation.id}|${translation.matchPoint.x}|${translation.matchPoint.y}|${translation.dx}|${translation.dy}`
      : `${translation.id}|all|${translation.dx}|${translation.dy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(translation);
  }
  return deduped;
}

function translateSourceCoordinates(body: string, sourceTranslations: SourceCoordinateTranslation[]): string {
  const lines = body.split('\n');
  const translationsByLine = new Map<number, SourceCoordinateTranslation[]>();
  const expandedTranslations = dedupeSourceTranslations(sourceTranslations)
    .flatMap((translation) => expandSourceTranslationTargets(body, translation));
  for (const translation of dedupeSourceTranslations(expandedTranslations)) {
    const lineIndex = resolveSourceLineIndex(body, translation.id);
    if (lineIndex < 0 || lineIndex >= lines.length) continue;
    const bucket = translationsByLine.get(lineIndex);
    if (bucket) {
      bucket.push(translation);
    } else {
      translationsByLine.set(lineIndex, [translation]);
    }
  }
  for (const [lineIndex, translations] of translationsByLine) {
    lines[lineIndex] = translateAbsoluteNumericCoordinatesInLine(lines[lineIndex], translations);
  }
  return lines.join('\n');
}


function applyEditableStatementToBody(body: string, statement: EditableStatement): string {
  const lines = body.split('\n');
  const sourceLine = lines[statement.sourceLineIndex];
  if (!sourceLine) return body;
  const indent = sourceLine.match(/^\s*/)?.[0] ?? '';

  // Case C: grouped statement — `\draw` alone on one line, segments on following lines.
  // Only modify the specific target line, leave all other lines untouched.
  if (statement.sourceSubIndex != null) {
    const sourceLineTrimmed = sourceLine.trim();
    if (/^\\(draw|path)(?:\[([\s\S]*?)\])?\s*$/.test(sourceLineTrimmed)) {
      const targetLineIndex = findGroupedEntityLineIndex(body, statement.sourceLineIndex, statement.sourceSubIndex);
      if (targetLineIndex >= 0) {
        const targetLine = lines[targetLineIndex];
        if (!targetLine) return body;
        const targetIndent = targetLine.match(/^\s*/)?.[0] ?? '';
        const nextSegmentText = emitEditableStatement({
          ...statement,
          command: 'draw',
          commandOptionsText: undefined,
        })?.replace(/^\\(?:draw|path)(?:\[[^\]]*\])?\s+/, '').replace(/;$/, '');
        if (!nextSegmentText) return body;
        lines[targetLineIndex] = `${targetIndent}${nextSegmentText}`;
        return lines.join('\n');
      }
    }
  }

  // Case B: multi-segment inline — `\draw (A) to[R] (B) to[C] (D);` on one line,
  // parsed into multiple sub-statements with IDs like `line:N:0`, `line:N:1`.
  // Modify only the target segment inside the structured body, re-emit the whole line.
  const segmentIndex = statement.sourceSubIndex ?? statement.editIntent?.segmentIndex;
  if (segmentIndex != null) {
    const commandMatch = sourceLine.trim().replace(/;$/, '').match(/^\\(draw|path)(?:\[([\s\S]*?)\])?\s+([\s\S]+)$/);
    if (commandMatch) {
      const currentStructured = parseStructuredStatementBody(commandMatch[3].trim());
      if (currentStructured && segmentIndex < currentStructured.segments.length) {
        const targetSegment = statement.segments[segmentIndex] ?? statement.segments[0];
        const nextStructured = {
          positionTexts: statement.positionTexts.length > 0
            ? statement.positionTexts
            : currentStructured.positionTexts,
          segments: currentStructured.segments.map((seg, i) =>
            i === segmentIndex ? (targetSegment ?? seg) : seg,
          ),
        };
        const nextBody = emitStructuredStatementBody(nextStructured);
        if (!nextBody) return body;
        const commandOptions = commandMatch[2]?.trim();
        lines[statement.sourceLineIndex] = `${indent}\\${commandMatch[1]}${commandOptions ? `[${commandOptions}]` : ''} ${nextBody};`;
        return lines.join('\n');
      }
    }
  }

  // Case A: single statement on one line — replace the whole line.
  const replacement = emitEditableStatement(statement);
  if (!replacement) return body;
  return updateBodyLinePreservingStructure(body, statement.sourceLineIndex, replacement);
}

export interface ImperativeAppHandle {
  circuitDoc: CircuitDocument;
  eventBus: EventBus;
  latexDoc: LatexDocument;
  registry: typeof registry;
  selection: SelectionState;
  toolManager: ToolManager;
  getCurrentTool: () => { tool: ToolType; defId?: string };
  getSelectedIds: () => string[];
  getPreamble: () => string;
  getBody: () => string;
  getFullLatexSource: () => string;
  loadFullLatexSource: (source: string) => void;
  getRenderedSvg: () => string | null;
  renderSvgForExport: (purpose: Extract<RenderPurpose, 'download-svg' | 'download-svg-plus'>) => Promise<string | null>;
  getInUseDefIds: () => string[];
  getSelectedComponent: () => ComponentInstance | undefined;
  getSelectedDrawing: () => DrawingInstance | undefined;
  getSelectedWire: () => WireInstance | undefined;
  getEditableStatementModel: (id: string) => EditableStatement | null;
  getResolvedStatementPositions: (id: string) => Array<string | null>;
  applyEditableStatement: (statement: EditableStatement) => void;
  splitDrawPathAt: (statement: EditableStatement, positionIndex: number) => void;
  reverseDrawPath: (id: string) => void;
  canMergeDrawPaths: (firstId: string, secondId: string) => boolean;
  mergeDrawPaths: (firstId: string, secondId: string) => void;
  getDef: (defId: string) => ReturnType<typeof registry.get>;
  canPasteSelection: () => boolean;
  copySelection: () => void;
  cutSelection: () => void;
  deleteSelection: () => void;
  getGridVisible: () => boolean;
  getGridPitch: () => number;
  getMajorGridEvery: () => number;
  getPinSnapEnabled: () => boolean;
  getWireRoutingMode: () => WireRoutingMode;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToScreen: () => void;
  resetInitialFit: () => void;
  setTool: (tool: ToolType, defId?: string) => void;
  setGridVisible: (visible: boolean) => void;
  setGridPitch: (pitch: number) => void;
  setMajorGridEvery: (every: number) => void;
  setPinSnapEnabled: (enabled: boolean) => void;
  setWireRoutingMode: (mode: WireRoutingMode) => void;
  setPositionPickMode: (enabled: boolean) => void;
  setSelectedIds: (selectedIds: string[], source?: 'canvas' | 'code' | 'programmatic') => void;
  selectSourceLine: (lineIndices: number[]) => void;
  setPreamble: (preamble: string) => void;
  setBody: (body: string) => void;
  updateDrawingProps: (id: string, props: Record<string, string | undefined>) => void;
  undo: () => void;
  redo: () => void;
  pasteSelection: () => void;
  commitLatexEdits: () => void;
  commitDocumentChange: () => void;
  onHistoryUndoRequest: (fn: () => void) => () => void;
  onHistoryRedoRequest: (fn: () => void) => () => void;
  onToolChange: (fn: (tool: ToolType, defId?: string) => void) => () => void;
  onSelectionChange: (fn: (selectedIds: string[], source?: 'canvas' | 'code' | 'programmatic') => void) => () => void;
  onBodyChange: (fn: () => void) => () => void;
  onSourceChange: (fn: () => void) => () => void;
  onGeometryChange: (fn: () => void) => () => void;
  onDocumentChange: (fn: () => void) => () => void;
  onLatexEdited: (fn: () => void) => () => void;
  onCursorGridChange: (fn: (gridPt: { x: number; y: number }, zoomPercent: number) => void) => () => void;
  onCanvasMouseLeave: (fn: () => void) => () => void;
  onCanvasClick: (fn: (gridPt: { x: number; y: number }) => void) => () => void;
  clearDocument: () => void;
  showInfoBanner: (message: string | null) => void;
}

async function createImperativeApp(canvasContainer: HTMLElement): Promise<ImperativeAppHandle> {
  if (initialized) throw new Error('Imperative app already initialized');
  initialized = true;
  canvasContainer.replaceChildren();

  await symbolsDB.load('/symbols.svg');
  populateRegistryFromSymbolsDB(registry, symbolsDB);

  const latexDoc = new LatexDocument();
  const circuitDoc = new CircuitDocument('european');
  const selection = new SelectionState();
  const eventBus = new EventBus();
  let gridVisible = true;
  let suppressCodeCaretSelection = false;

  const canvas = new LatexCanvas(canvasContainer, latexDoc, circuitDoc, registry, selection);

  const syncTikzScale = () => {
    scaleState.tikzScale = extractTikzScale(latexDoc.body);
    scaleState.componentScales = extractCtikzScales(`${latexDoc.preamble}\n${latexDoc.body}`);
    canvas.updateGridScale();
  };

  const existingSelectableIds = (): Set<string> => new Set([
    ...circuitDoc.components.map((comp) => comp.id),
    ...circuitDoc.wires.map((wire) => wire.id),
    ...circuitDoc.drawPaths.map((dp) => dp.id),
    ...circuitDoc.drawings.map((drawing) => drawing.id),
  ]);

  const reconcileSelection = (source: 'programmatic' | 'canvas' | 'code') => {
    const previous = selection.getSelectedIds();
    const existing = existingSelectableIds();
    const next = previous.filter((id) => {
      if (existing.has(id)) return true;
      if (id.startsWith('line:')) return getEditableStatementModel(latexDoc.body, id) != null;
      return false;
    });
    selection.setSelectedIds(next);
    eventBus.emit({ type: 'selection-changed', selectedIds: next, source });
  };

  const parseCurrentBody = (options: { preserveMeasuredComponentBounds?: boolean; preserveMeasuredSymbolPoints?: boolean } = {}) => {
    latexDoc.body = moveAllReferencedNodeDefinitionsForward(latexDoc.body);
    parseCircuiTikZ(latexDoc.body, circuitDoc, registry, options);
  };

  const invalidateRenderDerivedGeometry = () => {
    // Keep last measured geometry until the next successful probe response.
    // This avoids pin-marker disappearance during transient render/probe failures.
  };

  const emitSourceChanged = (reason: string) => {
    eventBus.emit({ type: 'source-changed', reason });
  };

  const emitBodyChanged = (reason: string) => {
    // Safety net for the few callers that mutate latexDoc.body without a
    // parseCurrentBody() re-parse in between (e.g. live drag of a wire/drawing
    // endpoint onto an existing node emits a node-name reference directly).
    // A no-op when parseCurrentBody() already reordered the body; when it does
    // reorder here, re-parse and reconcile selection so line-index-based ids
    // (and the model they describe) stay in sync with the reordered text.
    const beforeReorder = latexDoc.body;
    latexDoc.body = moveAllReferencedNodeDefinitionsForward(latexDoc.body);
    if (latexDoc.body !== beforeReorder) {
      parseCurrentBody();
      reconcileSelection('programmatic');
    }
    eventBus.emit({ type: 'body-changed' });
    emitSourceChanged(reason);
  };

  const namedNodeGeometrySignature = (): string => {
    return circuitDoc.components
      .filter((comp): comp is Exclude<(typeof circuitDoc.components)[number], { type: 'bipole' }> => {
        return comp.type !== 'bipole' && Boolean(comp.nodeName);
      })
      .map((comp) => `${comp.id}:${comp.defId}:${comp.nodeName}`)
      .sort()
      .join('|');
  };

  canvas.onAnchorGeometryMeasured = (points, bounds) => {
    const beforeSignature = namedNodeGeometrySignature();
    circuitDoc.setMeasuredSymbolPoints(points);
    for (const comp of circuitDoc.components) {
      if (comp.type === 'bipole' || !comp.nodeName) continue;
      const def = registry.get(comp.defId);
      const reference = def?.geometry?.reference;
      if (!reference?.snap) continue;
      if (circuitDoc.getMeasuredSymbolPoint(comp.nodeName, 'reference')) continue;
      circuitDoc.upsertMeasuredSymbolPoint({
        key: comp.nodeName,
        nodeName: comp.nodeName,
        anchor: 'reference',
        names: ['reference'],
        point: { ...comp.position },
        kind: 'reference',
        role: 'reference',
        snap: true,
        ghost: true,
        componentId: comp.id,
        defId: comp.defId,
      });
    }
    circuitDoc.setMeasuredComponentBounds(bounds);
    parseCurrentBody({ preserveMeasuredSymbolPoints: true, preserveMeasuredComponentBounds: true });
    const afterSignature = namedNodeGeometrySignature();
    reconcileSelection('programmatic');
    canvas.refresh();
    eventBus.emit({ type: 'geometry-changed' });
    if (afterSignature !== beforeSignature) canvas.scheduleRender();
  };

  const getResolvedStatementPositions = (id: string): Array<string | null> => {
    const resolved = circuitDoc.getResolvedStatementPositions(id) ?? [];
    return resolved.map((sequence) => sequence ? `(${sequence.point.x.toFixed(3)}, ${sequence.point.y.toFixed(3)})` : null);
  };

  const applyFullSource = (source: string) => {
    latexDoc.loadFromSource(source);
    latexDoc.body = normalizeMultilineNodeStatements(latexDoc.body);
    syncTikzScale();
    invalidateRenderDerivedGeometry();
    parseCurrentBody();
    reconcileSelection('programmatic');
    emitBodyChanged('full-source-loaded');
    canvas.refresh();
  };

  // Undo/redo history is owned by React state/localStorage. The imperative layer
  // keeps these call sites as mutation markers, but does not maintain a second stack.
  const pushUndoSnapshot = () => {};

  syncTikzScale();
  scaleState.gridPitch = circuitDoc.metadata.snapSize;

  const toolCtx: ToolContext = {
    ghost: canvas.ghost,
    hitTester: canvas.hitTester,
    emit: (e) => eventBus.emit(e),
    getDocument: () => circuitDoc,
    getDef: (defId: string) => registry.get(defId),
    appendLine: (line: string) => {
      pushUndoSnapshot();
      latexDoc.body = appendSnapAwareLine(
        latexDoc.body,
        line,
        circuitDoc,
        canvas.snap.connectionSnapEnabled,
      );
      syncTikzScale();
      invalidateRenderDerivedGeometry();
      parseCurrentBody();
      emitBodyChanged('append-line');
      canvas.refresh();
    },
    deleteElements: (ids: string[]) => {
      if (ids.length === 0) return;
      pushUndoSnapshot();
      const lineIndices = ids.map(lineIndexFromId).filter((idx) => idx >= 0);
      const deletedNodeNames = new Set(
        ids
          .map((id) => circuitDoc.getComponent(id))
          .filter((comp): comp is Exclude<(typeof circuitDoc.components)[number], { type: 'bipole' }> => {
            return Boolean(comp && comp.type !== 'bipole' && comp.nodeName);
          })
          .map((comp) => comp.nodeName as string),
      );
      latexDoc.body = replaceDeletedNodeReferencesInBody(latexDoc.body, deletedNodeNames, circuitDoc);
      for (const id of ids) {
        circuitDoc.removeComponent(id);
        circuitDoc.removeWire(id);
        circuitDoc.removeDrawPath(id);
        circuitDoc.removeDrawing(id);
      }
      latexDoc.body = removeBodyLines(latexDoc.body, lineIndices);
      syncTikzScale();
      invalidateRenderDerivedGeometry();
      parseCurrentBody();
      selection.clear();
      eventBus.emit({ type: 'selection-changed', selectedIds: [], source: 'canvas' });
      emitBodyChanged('delete-elements');
      canvas.refresh();
    },
    placeClipboard: (payload, target) => {
      pushUndoSnapshot();
      const entries = materializeClipboardAt(payload, target, () => circuitDoc.nextNodeName());
      const lines = entries
        .map((entry) => emitClipboardEntry(entry))
        .filter((line): line is string => Boolean(line));
      if (lines.length === 0) return;
      const appended = appendLinesToBody(latexDoc.body, lines);
      latexDoc.body = appended.body;
      syncTikzScale();
      invalidateRenderDerivedGeometry();
      parseCurrentBody();
      const selectedIds = lines.map((_, index) => `line:${appended.startLineIndex + index}`);
      selection.setSelectedIds(selectedIds);
      eventBus.emit({ type: 'selection-changed', selectedIds, source: 'canvas' });
      emitBodyChanged('place-clipboard');
      canvas.refresh();
    },
    getEditableStatementModel: (id) => getEditableStatementModel(latexDoc.body, id),
    applyEditableStatement: (statement) => {
      pushUndoSnapshot();
      latexDoc.body = applyEditableStatementToBody(latexDoc.body, statement);
      syncTikzScale();
      invalidateRenderDerivedGeometry();
      parseCurrentBody();
      reconcileSelection('programmatic');
      emitBodyChanged('apply-editable-statement');
      canvas.refresh();
    },
    splitDrawPathAt: (statement, positionIndex) => {
      const result = splitDrawPathAtIndex(latexDoc.body, statement, positionIndex);
      if (!result) return;
      pushUndoSnapshot();
      latexDoc.body = result.body;
      syncTikzScale();
      invalidateRenderDerivedGeometry();
      parseCurrentBody();
      selection.setSelectedIds(idsAtLineIndex(circuitDoc, latexDoc.body, statement.sourceLineIndex));
      reconcileSelection('programmatic');
      emitBodyChanged('split-draw-path');
      canvas.refresh();
    },
    undo: () => {
      eventBus.emit({ type: 'history-undo-requested' });
    },
    redo: () => {
      eventBus.emit({ type: 'history-redo-requested' });
    },
  };

  const toolManager = new ToolManager(toolCtx, canvas, selection, (e) => eventBus.emit(e));
  let positionPickActive = false;

  const collectHoverSequences = (): PositionSequencePreview[] => {
    const sequences: PositionSequencePreview[] = [];
    for (const comp of circuitDoc.components) {
      if (comp.type === 'bipole') {
        if (comp.startSequence) sequences.push(comp.startSequence);
        if (comp.endSequence) sequences.push(comp.endSequence);
        continue;
      }
      if (comp.positionSequence) sequences.push(comp.positionSequence);
    }
    // Group wires by logical line index so shared endpoints between
    // consecutive sub-wires of the same draw statement are deduplicated.
    const wiresByLine = new Map<number, typeof circuitDoc.wires>();
    const ungroupedWires: typeof circuitDoc.wires = [];
    for (const wire of circuitDoc.wires) {
      const { lineIndex, subIndex } = lineIdParts(wire.id);
      if (lineIndex >= 0 && subIndex !== null) {
        const bucket = wiresByLine.get(lineIndex) ?? [];
        bucket.push(wire);
        wiresByLine.set(lineIndex, bucket);
      } else {
        ungroupedWires.push(wire);
      }
    }

    for (const bucket of wiresByLine.values()) {
      const sorted = [...bucket].sort((a, b) => {
        const { subIndex: ai } = lineIdParts(a.id);
        const { subIndex: bi } = lineIdParts(b.id);
        return (ai ?? 0) - (bi ?? 0);
      });
      let lastPoint: { x: number; y: number } | null = null;
      for (const wire of sorted) {
        if (!wire.pathSequences || wire.pathSequences.length === 0) continue;
        for (let i = 0; i < wire.pathSequences.length; i++) {
          const seq = wire.pathSequences[i];
          // Skip the first sequence of a subsequent sub-wire if it duplicates
          // the last sequence already added (shared endpoint between sub-wires).
          if (i === 0 && lastPoint !== null &&
              seq.point.x === lastPoint.x && seq.point.y === lastPoint.y) {
            continue;
          }
          sequences.push(seq);
          lastPoint = seq.point;
        }
      }
    }

    for (const wire of ungroupedWires) {
      if (wire.pathSequences && wire.pathSequences.length > 0) {
        sequences.push(...wire.pathSequences);
      }
    }

    for (const dp of circuitDoc.drawPaths) {
      sequences.push(...dp.positionSequences);
    }

    return sequences;
  };

  // Single place where render-dependent state reacts to committed source changes.
  eventBus.on('source-changed', () => {
    canvas.scheduleRender();
    toolManager.activeTool.onBodyChanged();
    canvas.refresh();
  });

  eventBus.on('geometry-changed', () => {
    toolManager.activeTool.onBodyChanged();
    canvas.refresh();
  });

  eventBus.on('selection-changed', (e) => {
    if (e.type !== 'selection-changed') return;
    // Expand each selected id to its full source row, preserving multi-row selection.
    const nextIds: string[] = [];
    const seen = new Set<string>();
    for (const id of e.selectedIds) {
      const lineIndex = lineIndexFromId(id);
      const expandedIds = lineIndex >= 0 ? idsAtLineIndex(circuitDoc, latexDoc.body, lineIndex) : [];
      const idsForSelection = expandedIds.length > 0 ? expandedIds : [id];
      for (const expandedId of idsForSelection) {
        if (seen.has(expandedId)) continue;
        seen.add(expandedId);
        nextIds.push(expandedId);
      }
    }
    selection.setSelectedIds(nextIds);
    canvas.refresh();
    // If expansion changed the list, re-emit so React observers see the complete set.
    if (nextIds.length !== e.selectedIds.length || nextIds.some((id, i) => id !== e.selectedIds[i])) {
      eventBus.emit({ type: 'selection-changed', selectedIds: nextIds, source: e.source });
    }
  });

  eventBus.on('code-caret-changed', (e) => {
    if (e.type !== 'code-caret-changed') return;
    if (suppressCodeCaretSelection) return;
    const seen = new Set<string>();
    const selectedIds: string[] = [];
    for (const lineIndex of e.lineIndices) {
      for (const id of idsAtLineIndex(circuitDoc, latexDoc.body, lineIndex)) {
        if (seen.has(id)) continue;
        seen.add(id);
        selectedIds.push(id);
      }
    }
    eventBus.emit({ type: 'selection-changed', selectedIds, source: 'code' });
  });

  eventBus.on('cursor-grid-changed', (e) => {
    if (e.type !== 'cursor-grid-changed') return;
    const tolerance = scaleState.gridPitch / 2;
    if (!positionPickActive) {
      canvas.ghost.setHoverSequences([], e.gridPt, tolerance);
      return;
    }
    canvas.ghost.setHoverSequences(collectHoverSequences(), e.gridPt, tolerance);
  });

  eventBus.on('document-changed', (e) => {
    if (e.type !== 'document-changed') return;
    pushUndoSnapshot();
    if (e.sourceTranslations && e.sourceTranslations.length > 0) {
      latexDoc.body = translateSourceCoordinates(latexDoc.body, e.sourceTranslations);
      syncTikzScale();
      invalidateRenderDerivedGeometry();
      parseCurrentBody();
      reconcileSelection('programmatic');
      emitBodyChanged('source-translation');
      canvas.refresh();
      return;
    }
    let nextBody = latexDoc.body;
    const sourceLines = nextBody.split('\n');
    const groupedLineIndices = new Set(
      selection.getSelectedIds()
        .map((id) => lineIdParts(id))
        .filter((parts) => parts.subIndex !== null)
        .map((parts) => parts.lineIndex),
    );

    if (groupedLineIndices.size > 0) {
      const replacements = collectGroupedLineReplacements(circuitDoc);
      for (const lineIndex of [...replacements.keys()]) {
        if (!groupedLineIndices.has(lineIndex)) replacements.delete(lineIndex);
      }

      const replaced = replaceBodyLinesWithGroups(nextBody, replacements);
      latexDoc.body = replaced.body;
      syncTikzScale();
      invalidateRenderDerivedGeometry();
      parseCurrentBody();
      const nextSelectedIds = selection.getSelectedIds().map((id) => replaced.idMap.get(id) ?? id);
      selection.setSelectedIds(nextSelectedIds);  // remap IDs before reconcile reads them
      reconcileSelection('programmatic');
      emitBodyChanged('document-model');
      canvas.refresh();
      return;
    }

    for (const id of selection.getSelectedIds()) {
      const lineIdx = lineIndexFromId(id);
      if (lineIdx < 0) continue;
      const originalLine = sourceLines[lineIdx]?.trim() ?? '';
      const compactSegment = originalLine.startsWith('(');
      const comp = circuitDoc.getComponent(id);
      if (comp) {
        const replacement = compactSegment ? emitComponentSegment(comp) : emitComponentLine(comp);
        if (replacement) nextBody = updateBodyLinePreservingStructure(nextBody, lineIdx, replacement);
        continue;
      }
      const wire = circuitDoc.getWire(id);
      if (wire) {
        nextBody = updateBodyLinePreservingStructure(nextBody, lineIdx, emitWireLine(wire, compactSegment));
        continue;
      }
      const drawing = circuitDoc.getDrawing(id);
      if (drawing) nextBody = updateBodyLinePreservingStructure(nextBody, lineIdx, emitDrawingLine(drawing));
    }
    latexDoc.body = nextBody;
    syncTikzScale();
    invalidateRenderDerivedGeometry();
    emitBodyChanged('document-model');
    canvas.refresh();
  });

  eventBus.on('user-edited-latex', () => {
    const previousSelection = selection.getSelectedIds();
    latexDoc.body = normalizeMultilineNodeStatements(latexDoc.body);
    syncTikzScale();
    invalidateRenderDerivedGeometry();
    parseCurrentBody();
    selection.setSelectedIds(previousSelection);
    reconcileSelection('programmatic');
    emitBodyChanged('code-editor');
    canvas.refresh();
  });

  syncTikzScale();
  parseCurrentBody();

  canvas.overlaySvg.addEventListener('mousemove', (e) => {
    eventBus.emit({
      type: 'cursor-grid-changed',
      gridPt: canvas.eventToGridRaw(e),
      zoomPercent: canvas.view.zoomPercent,
    });
  });

  const canvasMouseLeaveListeners: Array<() => void> = [];
  canvas.overlaySvg.addEventListener('mouseleave', () => {
    for (const fn of canvasMouseLeaveListeners) fn();
  });

  window.addEventListener('resize', () => canvas.refresh());
  canvas.scheduleRender();

  return {
    circuitDoc,
    eventBus,
    latexDoc,
    registry,
    selection,
    toolManager,
    getCurrentTool: () => ({ tool: toolManager.currentType, defId: toolManager.currentDefId }),
    getSelectedIds: () => selection.getSelectedIds(),
    getPreamble: () => latexDoc.preamble,
    getBody: () => latexDoc.body,
    getFullLatexSource: () => latexDoc.toFullSource(),
    loadFullLatexSource: (source) => {
      pushUndoSnapshot();
      applyFullSource(source);
      eventBus.emit({ type: 'user-edited-latex' });
    },
    getRenderedSvg: () => canvas.getRenderedSvg(),
    renderSvgForExport: (purpose) => canvas.renderSvgForExport(purpose),
    getInUseDefIds: () => collectInUseDefIdsFromBody(latexDoc.body),
    getSelectedComponent: () => {
      const [id] = selection.getSelectedIds();
      return id ? circuitDoc.getComponent(id) : undefined;
    },
    getSelectedDrawing: () => {
      const [id] = selection.getSelectedIds();
      return id ? circuitDoc.getDrawing(id) : undefined;
    },
    getSelectedWire: () => {
      const [id] = selection.getSelectedIds();
      return id ? circuitDoc.getWire(id) : undefined;
    },
    getEditableStatementModel: (id) => getEditableStatementModel(latexDoc.body, id),
    getResolvedStatementPositions,
    applyEditableStatement: (statement) => {
      pushUndoSnapshot();
      latexDoc.body = applyEditableStatementToBody(latexDoc.body, statement);
      syncTikzScale();
      invalidateRenderDerivedGeometry();
      parseCurrentBody();
      const nextSelectedIds = statement.selectedId != null
        ? [statement.selectedId]
        : statement.sourceSubIndex != null
        ? [`line:${statement.sourceLineIndex}:${statement.sourceSubIndex}`]
        : idsAtLineIndex(circuitDoc, latexDoc.body, statement.sourceLineIndex);
      selection.setSelectedIds(nextSelectedIds);
      reconcileSelection('programmatic');
      emitBodyChanged('editable-statement');
      canvas.refresh();
    },
    splitDrawPathAt: (statement, positionIndex) => {
      const result = splitDrawPathAtIndex(latexDoc.body, statement, positionIndex);
      if (!result) return;
      pushUndoSnapshot();
      latexDoc.body = result.body;
      syncTikzScale();
      invalidateRenderDerivedGeometry();
      parseCurrentBody();
      selection.setSelectedIds(idsAtLineIndex(circuitDoc, latexDoc.body, statement.sourceLineIndex));
      reconcileSelection('programmatic');
      emitBodyChanged('split-draw-path');
      canvas.refresh();
    },
    reverseDrawPath: (id) => {
      const statement = getEditableStatementModel(latexDoc.body, id);
      if (!statement || !isDrawPathStatement(statement)) return;
      pushUndoSnapshot();
      latexDoc.body = applyEditableStatementToBody(latexDoc.body, reverseDrawPathStatement(statement));
      syncTikzScale();
      invalidateRenderDerivedGeometry();
      parseCurrentBody();
      selection.setSelectedIds(idsAtLineIndex(circuitDoc, latexDoc.body, statement.sourceLineIndex));
      reconcileSelection('programmatic');
      emitBodyChanged('reverse-draw-path');
      canvas.refresh();
    },
    canMergeDrawPaths: (firstId, secondId) => {
      const firstDrawPath = circuitDoc.getDrawPath(firstId);
      const secondDrawPath = circuitDoc.getDrawPath(secondId);
      if (!firstDrawPath || !secondDrawPath) return false;
      if (firstDrawPath.positionSequences.length < 2 || secondDrawPath.positionSequences.length < 2) return false;
      const first = getEditableStatementModel(latexDoc.body, firstId);
      const second = getEditableStatementModel(latexDoc.body, secondId);
      if (!first || !second) return false;
      const firstStartPoint = firstDrawPath.positionSequences[0].point;
      const firstEndPoint = firstDrawPath.positionSequences[firstDrawPath.positionSequences.length - 1].point;
      const secondStartPoint = secondDrawPath.positionSequences[0].point;
      const secondEndPoint = secondDrawPath.positionSequences[secondDrawPath.positionSequences.length - 1].point;
      return mergeDrawPathStatements(first, second, firstEndPoint, firstStartPoint, secondStartPoint, secondEndPoint) != null;
    },
    mergeDrawPaths: (firstId, secondId) => {
      const firstDrawPath = circuitDoc.getDrawPath(firstId);
      const secondDrawPath = circuitDoc.getDrawPath(secondId);
      if (!firstDrawPath || !secondDrawPath) return;
      const first = getEditableStatementModel(latexDoc.body, firstId);
      const second = getEditableStatementModel(latexDoc.body, secondId);
      if (!first || !second) return;
      const firstStartPoint = firstDrawPath.positionSequences[0].point;
      const firstEndPoint = firstDrawPath.positionSequences[firstDrawPath.positionSequences.length - 1].point;
      const secondStartPoint = secondDrawPath.positionSequences[0].point;
      const secondEndPoint = secondDrawPath.positionSequences[secondDrawPath.positionSequences.length - 1].point;
      const merged = mergeDrawPathStatements(first, second, firstEndPoint, firstStartPoint, secondStartPoint, secondEndPoint);
      if (!merged) return;
      pushUndoSnapshot();
      const mergedLineIndex = merged.sourceLineIndex;
      const otherLineIndex = mergedLineIndex === first.sourceLineIndex
        ? second.sourceLineIndex
        : first.sourceLineIndex;
      latexDoc.body = applyEditableStatementToBody(latexDoc.body, merged);
      latexDoc.body = removeBodyLines(latexDoc.body, [otherLineIndex]);
      syncTikzScale();
      invalidateRenderDerivedGeometry();
      parseCurrentBody();
      const adjustedLineIndex = mergedLineIndex > otherLineIndex ? mergedLineIndex - 1 : mergedLineIndex;
      selection.setSelectedIds(idsAtLineIndex(circuitDoc, latexDoc.body, adjustedLineIndex));
      reconcileSelection('programmatic');
      emitBodyChanged('merge-draw-paths');
      canvas.refresh();
    },
    getDef: (defId) => registry.get(defId),
    canPasteSelection: () => toolManager.hasClipboard,
    copySelection: () => toolManager.copySelection(),
    cutSelection: () => toolManager.cutSelection(),
    deleteSelection: () => toolManager.deleteSelection(),
    getGridVisible: () => gridVisible,
    getGridPitch: () => circuitDoc.metadata.snapSize,
    getMajorGridEvery: () => scaleState.majorGridEvery,
    getPinSnapEnabled: () => canvas.snap.connectionSnapEnabled,
    getWireRoutingMode: () => toolManager.wireRoutingMode,
    zoomIn: () => canvas.zoomIn(),
    zoomOut: () => canvas.zoomOut(),
    fitToScreen: () => canvas.fitToScreen(),
    resetInitialFit: () => { canvas.hasPerformedInitialFit = false; },
    setTool: (tool, defId) => toolManager.setTool(tool, defId),
    setGridVisible: (visible) => {
      gridVisible = visible;
      canvas.setGridVisible(visible);
    },
    setGridPitch: (pitch) => {
      circuitDoc.metadata.snapSize = pitch;
      scaleState.gridPitch = pitch;
      canvas.updateGridScale();
      canvas.refresh();
    },
    setMajorGridEvery: (every) => {
      scaleState.majorGridEvery = every;
      canvas.updateGridScale();
      canvas.refresh();
    },
    setPinSnapEnabled: (enabled) => {
      canvas.snap.connectionSnapEnabled = enabled;
    },
    setWireRoutingMode: (mode) => {
      toolManager.setWireRoutingMode(mode);
    },
    setPositionPickMode: (enabled) => {
      positionPickActive = enabled;
      toolManager.setPositionPickMode(enabled);
      if (!enabled) {
        canvas.ghost.setHoverSequences([], { x: 0, y: 0 }, scaleState.gridPitch / 2);
      }
    },
    setSelectedIds: (selectedIds, source = 'programmatic') => {
      eventBus.emit({ type: 'selection-changed', selectedIds, source });
    },
    selectSourceLine: (lineIndices) => {
      eventBus.emit({ type: 'code-caret-changed', lineIndices });
    },
    setPreamble: (preamble) => {
      latexDoc.preamble = preamble;
      syncTikzScale();
      invalidateRenderDerivedGeometry();
      emitSourceChanged('preamble');
    },
    setBody: (body) => {
      latexDoc.body = body;
      invalidateRenderDerivedGeometry();
    },
    updateDrawingProps: (id, props) => {
      const drawing = circuitDoc.getDrawing(id);
      if (!drawing) return;
      drawing.props = { ...drawing.props, ...props };
    },
    undo: () => {
      toolCtx.undo();
    },
    redo: () => {
      toolCtx.redo();
    },
    pasteSelection: () => {
      toolManager.pasteSelection();
    },
    commitLatexEdits: () => {
      pushUndoSnapshot();
      eventBus.emit({ type: 'user-edited-latex' });
    },
    commitDocumentChange: () => {
      pushUndoSnapshot();
      eventBus.emit({ type: 'document-changed' });
    },
    onHistoryUndoRequest: (fn) => eventBus.on('history-undo-requested', (event) => {
      if (event.type !== 'history-undo-requested') return;
      fn();
    }),
    onHistoryRedoRequest: (fn) => eventBus.on('history-redo-requested', (event) => {
      if (event.type !== 'history-redo-requested') return;
      fn();
    }),
    onToolChange: (fn) => eventBus.on('tool-changed', (event) => {
      if (event.type !== 'tool-changed') return;
      fn(event.tool, event.defId);
    }),
    onSelectionChange: (fn) => eventBus.on('selection-changed', (event) => {
      if (event.type !== 'selection-changed') return;
      fn(event.selectedIds, event.source);
    }),
    onBodyChange: (fn) => eventBus.on('body-changed', fn),
    onSourceChange: (fn) => eventBus.on('source-changed', fn),
    onGeometryChange: (fn) => eventBus.on('geometry-changed', fn),
    onDocumentChange: (fn) => eventBus.on('document-changed', fn),
    onLatexEdited: (fn) => eventBus.on('user-edited-latex', fn),
    onCursorGridChange: (fn) => eventBus.on('cursor-grid-changed', (event) => {
      if (event.type !== 'cursor-grid-changed') return;
      fn(event.gridPt, event.zoomPercent);
    }),
    onCanvasMouseLeave: (fn) => {
      canvasMouseLeaveListeners.push(fn);
      return () => {
        const idx = canvasMouseLeaveListeners.indexOf(fn);
        if (idx >= 0) canvasMouseLeaveListeners.splice(idx, 1);
      };
    },
    onCanvasClick: (fn) => eventBus.on('canvas-clicked', (event) => {
      if (event.type !== 'canvas-clicked') return;
      fn(event.gridPt);
    }),
    clearDocument: () => {
      pushUndoSnapshot();
      circuitDoc.clear();
      latexDoc.body = DEFAULT_BODY;
      emitBodyChanged('clear-document');
      eventBus.emit({ type: 'user-edited-latex' });
    },
    showInfoBanner: (message) => canvas.showInfoBanner(message),
  };
}

export function initImperativeApp(canvasContainer: HTMLElement): Promise<ImperativeAppHandle> {
  if (!initPromise) {
    initPromise = createImperativeApp(canvasContainer);
  }
  return initPromise;
}
