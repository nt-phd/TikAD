import { symbolsDB } from './data/symbolsDB';
import { populateRegistryFromSymbolsDB } from './definitions/fromSymbolsDB';

import { LatexDocument } from './model/LatexDocument';
import { CircuitDocument } from './model/CircuitDocument';
import { SelectionState } from './model/SelectionState';
import { EventBus } from './utils/events';
import { registry } from './definitions/ComponentRegistry';
import { LatexCanvas } from './canvas/LatexCanvas';
import { ToolManager } from './tools/ToolManager';
import { parseCircuiTikZ, lineIndexFromId } from './codegen/CircuiTikZParser';
import { extractCtikzScales, extractTikzScale, scaleState } from './canvas/ScaleState';
import { componentProbeService } from './canvas/ComponentProbeService';
import type { ComponentRenderProbe } from './canvas/ComponentProbeService';
import { formatCoord } from './codegen/CoordFormatter';
import { formatLabel } from './codegen/LabelFormatter';
import { emitWirePath } from './codegen/WirePathEmitter';
import { emitPlacedNodeLine } from './codegen/NodeEmitter';
import { DEFAULT_BODY } from './model/LatexDocument';
import type {
  ComponentInstance,
  DrawingInstance,
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
import type { EditableStatement } from './types';
import { emitStructuredNodeStatement, emitStructuredStatementBody, parseStructuredStatementBody } from './codegen/TikzStructuredStatement';
import { scanTikzPoint, scanTikzPointSequence, skipTikzWhitespace } from './codegen/TikzPointParser';
import { splitOptions } from './codegen/TikzStatementSyntax';

let initialized = false;
let initPromise: Promise<ImperativeAppHandle> | null = null;

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

function formatEndpoint(point: { x: number; y: number }, ref?: { nodeName: string; anchor: string }): string {
  if (!ref) return formatCoord(point);
  return ref.anchor === 'reference' ? `(${ref.nodeName})` : `(${ref.nodeName}.${ref.anchor})`;
}

function emitComponentLine(comp: ComponentInstance): string | null {
  const def = registry.get(comp.defId);
  const tikzName = def?.tikzName ?? comp.defId;
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
  const tikzName = def?.tikzName ?? comp.defId;
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
    const optionParts = [tikzName];
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

function idsAtLineIndex(doc: CircuitDocument, lineIndex: number): string[] {
  if (lineIndex < 0) return [];
  const matches = [
    ...doc.components.map((component) => component.id),
    ...doc.wires.map((wire) => wire.id),
    ...doc.drawPaths.map((dp) => dp.id),
    ...doc.drawings.map((drawing) => drawing.id),
  ].filter((id) => lineIdParts(id).lineIndex === lineIndex);
  return [...new Set(matches)];
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
      translated = match ? translateAbsoluteNumericPoint(point.point.raw, match.dx, match.dy) : null;
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
  getLibraryPreviewProbe: (defId: string, onResolved: () => void) => ComponentRenderProbe | null;
  warmLibraryPreviewProbes: (onResolved: () => void) => void;
  getInUseDefIds: () => string[];
  getSelectedComponent: () => ComponentInstance | undefined;
  getSelectedDrawing: () => DrawingInstance | undefined;
  getSelectedWire: () => WireInstance | undefined;
  getEditableStatementModel: (id: string) => EditableStatement | null;
  applyEditableStatement: (statement: EditableStatement) => void;
  getDef: (defId: string) => ReturnType<typeof registry.get>;
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
  selectSourceLine: (lineIndex: number) => void;
  setPreamble: (preamble: string) => void;
  setBody: (body: string) => void;
  updateDrawingProps: (id: string, props: Record<string, string | undefined>) => void;
  undo: () => void;
  commitLatexEdits: () => void;
  commitDocumentChange: () => void;
  onToolChange: (fn: (tool: ToolType, defId?: string) => void) => () => void;
  onSelectionChange: (fn: (selectedIds: string[], source?: 'canvas' | 'code' | 'programmatic') => void) => () => void;
  onBodyChange: (fn: () => void) => () => void;
  onDocumentChange: (fn: () => void) => () => void;
  onLatexEdited: (fn: () => void) => () => void;
  onCursorGridChange: (fn: (gridPt: { x: number; y: number }, zoomPercent: number) => void) => () => void;
  onCanvasClick: (fn: (gridPt: { x: number; y: number }) => void) => () => void;
  clearDocument: () => void;
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
  const undoStack: string[] = [];
  let gridVisible = true;
  let suppressCodeCaretSelection = false;

  const canvas = new LatexCanvas(canvasContainer, latexDoc, circuitDoc, registry, selection);
  componentProbeService.configure(() => ({ body: latexDoc.body, preamble: latexDoc.preamble }));

  const syncTikzScale = () => {
    scaleState.tikzScale = extractTikzScale(latexDoc.body);
    scaleState.componentScales = extractCtikzScales(`${latexDoc.preamble}\n${latexDoc.body}`);
    canvas.updateGridScale();
  };

  const existingSelectableIds = (): Set<string> => new Set([
    ...circuitDoc.components.map((comp) => comp.id),
    ...circuitDoc.wires.map((wire) => wire.id),
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

  let anchorProbeReparseScheduled = false;

  const scheduleAnchorProbeReparse = () => {
    if (anchorProbeReparseScheduled) return;
    anchorProbeReparseScheduled = true;
    queueMicrotask(() => {
      anchorProbeReparseScheduled = false;
      parseCircuiTikZ(latexDoc.body, circuitDoc, registry);
      primeNodeAnchorProbes();
      reconcileSelection('programmatic');
      canvas.refresh(); // overlay only — body has not changed, no re-render needed
    });
  };

  const primeNodeAnchorProbes = () => {
    const bodySnapshot = latexDoc.body;
    const preambleSnapshot = latexDoc.preamble;
    for (const comp of circuitDoc.components) {
      if ((comp.type !== 'node' && comp.type !== 'monopole') || !comp.nodeName) continue;
      const def = registry.get(comp.defId);
      if (!def) continue;
      componentProbeService.getSelectionProbe(comp.id, comp, def, () => {
        if (latexDoc.body !== bodySnapshot || latexDoc.preamble !== preambleSnapshot) return;
        scheduleAnchorProbeReparse();
      });
    }
  };

  const parseCurrentBody = () => {
    parseCircuiTikZ(latexDoc.body, circuitDoc, registry);
    primeNodeAnchorProbes();
  };

  const applyFullSource = (source: string) => {
    latexDoc.loadFromSource(source);
    latexDoc.body = normalizeMultilineNodeStatements(latexDoc.body);
    syncTikzScale();
    componentProbeService.invalidate();
    parseCurrentBody();
    reconcileSelection('programmatic');
    eventBus.emit({ type: 'body-changed' });
    canvas.refresh();
  };

  const MAX_UNDO_STACK = 100;
  const pushUndoSnapshot = () => {
    const current = latexDoc.toFullSource();
    if (undoStack[undoStack.length - 1] !== current) {
      undoStack.push(current);
      if (undoStack.length > MAX_UNDO_STACK) undoStack.shift();
    }
  };

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
      latexDoc.body = appendLineToBody(latexDoc.body, line);
      syncTikzScale();
      componentProbeService.invalidate();
      parseCurrentBody();
      eventBus.emit({ type: 'body-changed' });
      canvas.refresh();
    },
    deleteElements: (ids: string[]) => {
      if (ids.length === 0) return;
      pushUndoSnapshot();
      const lineIndices = ids.map(lineIndexFromId).filter((idx) => idx >= 0);
      for (const id of ids) {
        circuitDoc.removeComponent(id);
        circuitDoc.removeWire(id);
        circuitDoc.removeDrawPath(id);
        circuitDoc.removeDrawing(id);
      }
      latexDoc.body = removeBodyLines(latexDoc.body, lineIndices);
      syncTikzScale();
      componentProbeService.invalidate();
      parseCurrentBody();
      selection.clear();
      eventBus.emit({ type: 'selection-changed', selectedIds: [], source: 'canvas' });
      eventBus.emit({ type: 'body-changed' });
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
      componentProbeService.invalidate();
      parseCurrentBody();
      const selectedIds = lines.map((_, index) => `line:${appended.startLineIndex + index}`);
      selection.setSelectedIds(selectedIds);
      eventBus.emit({ type: 'selection-changed', selectedIds, source: 'canvas' });
      eventBus.emit({ type: 'body-changed' });
      canvas.refresh();
    },
    undo: () => {
      const previous = undoStack.pop();
      if (!previous) return;
      applyFullSource(previous);
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

  // Single place where a LaTeX render is triggered: whenever the body changes.
  eventBus.on('body-changed', () => {
    canvas.scheduleRender();
  });

  eventBus.on('selection-changed', (e) => {
    if (e.type !== 'selection-changed') return;
    // Always expand to the full row so that "active line = active canvas chain" holds
    // regardless of whether the selection came from a canvas click or the code editor.
    const representativeId = e.selectedIds[0];
    const lineIndex = representativeId ? lineIndexFromId(representativeId) : -1;
    const expandedIds = lineIndex >= 0 ? idsAtLineIndex(circuitDoc, lineIndex) : [];
    selection.setSelectedIds(expandedIds.length > 0 ? expandedIds : e.selectedIds);
    canvas.refresh();
  });

  eventBus.on('code-caret-changed', (e) => {
    if (e.type !== 'code-caret-changed') return;
    if (suppressCodeCaretSelection) return;
    const selectedIds = idsAtLineIndex(circuitDoc, e.lineIndex);
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
      componentProbeService.invalidate();
      eventBus.emit({ type: 'body-changed' });
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
      componentProbeService.invalidate();
      parseCurrentBody();
      const nextSelectedIds = selection.getSelectedIds().map((id) => replaced.idMap.get(id) ?? id);
      selection.setSelectedIds(nextSelectedIds);
      reconcileSelection('programmatic');
      eventBus.emit({ type: 'body-changed' });
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
    componentProbeService.invalidate();
    eventBus.emit({ type: 'body-changed' });
    canvas.refresh();
  });

  eventBus.on('user-edited-latex', () => {
    const previousSelection = selection.getSelectedIds();
    latexDoc.body = normalizeMultilineNodeStatements(latexDoc.body);
    syncTikzScale();
    componentProbeService.invalidate();
    parseCurrentBody();
    selection.setSelectedIds(previousSelection);
    reconcileSelection('programmatic');
    eventBus.emit({ type: 'body-changed' });
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
    getLibraryPreviewProbe: (defId, onResolved) => {
      const def = registry.get(defId);
      if (!def) return null;
      if (def.placementType === 'bipole') {
        return componentProbeService.getBipoleGhostProbe(def, {
          id: '__library_probe__',
          defId,
          type: 'bipole',
          start: { x: 0, y: 0 },
          end: { x: 2, y: 0 },
          props: {},
        }, onResolved, true);
      }
      return componentProbeService.getPlacedGhostProbe(def, 0, onResolved, true);
    },
    warmLibraryPreviewProbes: (onResolved) => {
      for (const def of registry.getAll()) {
        componentProbeService.primeLibraryProbe(def, onResolved);
      }
    },
    getInUseDefIds: () => [...new Set(circuitDoc.components.map((comp) => comp.defId))],
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
    applyEditableStatement: (statement) => {
      pushUndoSnapshot();
      latexDoc.body = applyEditableStatementToBody(latexDoc.body, statement);
      syncTikzScale();
      componentProbeService.invalidate();
      parseCurrentBody();
      const nextSelectedIds = statement.sourceSubIndex != null
        ? [`line:${statement.sourceLineIndex}:${statement.sourceSubIndex}`]
        : idsAtLineIndex(circuitDoc, statement.sourceLineIndex);
      selection.setSelectedIds(nextSelectedIds);
      reconcileSelection('programmatic');
      eventBus.emit({ type: 'body-changed' });
      canvas.refresh();
    },
    getDef: (defId) => registry.get(defId),
    getGridVisible: () => gridVisible,
    getGridPitch: () => circuitDoc.metadata.snapSize,
    getMajorGridEvery: () => scaleState.majorGridEvery,
    getPinSnapEnabled: () => canvas.hitTester.connectionSnapEnabled,
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
      canvas.hitTester.connectionSnapEnabled = enabled;
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
    selectSourceLine: (lineIndex) => {
      eventBus.emit({ type: 'code-caret-changed', lineIndex });
    },
    setPreamble: (preamble) => {
      latexDoc.preamble = preamble;
      componentProbeService.invalidate();
    },
    setBody: (body) => {
      latexDoc.body = body;
      componentProbeService.invalidate();
    },
    updateDrawingProps: (id, props) => {
      const drawing = circuitDoc.getDrawing(id);
      if (!drawing) return;
      drawing.props = { ...drawing.props, ...props };
    },
    undo: () => {
      toolCtx.undo();
    },
    commitLatexEdits: () => {
      pushUndoSnapshot();
      eventBus.emit({ type: 'user-edited-latex' });
    },
    commitDocumentChange: () => {
      pushUndoSnapshot();
      eventBus.emit({ type: 'document-changed' });
    },
    onToolChange: (fn) => eventBus.on('tool-changed', (event) => {
      if (event.type !== 'tool-changed') return;
      fn(event.tool, event.defId);
    }),
    onSelectionChange: (fn) => eventBus.on('selection-changed', (event) => {
      if (event.type !== 'selection-changed') return;
      fn(event.selectedIds, event.source);
    }),
    onBodyChange: (fn) => eventBus.on('body-changed', fn),
    onDocumentChange: (fn) => eventBus.on('document-changed', fn),
    onLatexEdited: (fn) => eventBus.on('user-edited-latex', fn),
    onCursorGridChange: (fn) => eventBus.on('cursor-grid-changed', (event) => {
      if (event.type !== 'cursor-grid-changed') return;
      fn(event.gridPt, event.zoomPercent);
    }),
    onCanvasClick: (fn) => eventBus.on('canvas-clicked', (event) => {
      if (event.type !== 'canvas-clicked') return;
      fn(event.gridPt);
    }),
    clearDocument: () => {
      pushUndoSnapshot();
      circuitDoc.clear();
      latexDoc.body = DEFAULT_BODY;
      eventBus.emit({ type: 'body-changed' });
      eventBus.emit({ type: 'user-edited-latex' });
    },
  };
}

export function initImperativeApp(canvasContainer: HTMLElement): Promise<ImperativeAppHandle> {
  if (!initPromise) {
    initPromise = createImperativeApp(canvasContainer);
  }
  return initPromise;
}
