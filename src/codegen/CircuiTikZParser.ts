/**
 * CircuiTikZParser — parses a tikzpicture body into CircuitDocument.
 *
 * Each parsed element stores the line number in the source body so that:
 *  - IDs are stable across re-parses (based on line index, not random)
 *  - The CodePanel can highlight the corresponding source line on selection
 *
 * Supported syntax:
 *   \draw (x,y) to[tikzName, opts...] (x2,y2);   → BipoleInstance
 *   \draw (x,y) node[tikzName] {};                → Monopole/Node instance
 *   \node[tikzName,...] at (x,y) {};              → Monopole/Node instance
 *   \node[...] at (N.ref) {...};                  → node/text on symbolic refs
 *   \path ... node[tikzName] ...;                 → Monopole/Node instance
 *   \path ... node[anchor=...] {...};             → TextDrawingInstance
 *   \path (A) ++(dx,dy) node[...] {};             → relative placement in read mode
 *   \draw (x,y) -- (x2,y2) -- ...;               → WireInstance
 */

import type {
  ConnectionRef,
  GridPoint,
  BipoleInstance,
  MonopoleInstance,
  NodeInstance,
  WireInstance,
  DrawPathInstance,
  DrawPathSegment,
  ComponentProps,
  DrawingInstance,
  PositionSequencePreview,
  PathCornerPreview,
} from '../types';
import type { CircuitDocument } from '../model/CircuitDocument';
import type { ComponentRegistry } from '../definitions/ComponentRegistry';
import {
  scanTikzPointSequence,
} from './TikzPointParser';
import { extractKV, splitOptions } from './TikzStatementSyntax';
import { parseStructuredCoordinateStatement, parseStructuredNodeStatement, parseStructuredStatementBody } from './TikzStructuredStatement';
import { TikzGeometryEngine } from './TikzGeometryEngine';
import type { StructuredStatementBody } from './TikzStructuredStatement';

// ─── helpers ───────────────────────────────────────────────────────────────

function parseCoord(s: string): GridPoint | null {
  const m = s.match(/\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (!m) return null;
  return { x: parseFloat(m[1]), y: -parseFloat(m[2]) };
}

function expandWirePath(points: Array<{ point: GridPoint; ref?: ConnectionRef }>, operators: Array<'--' | '|-' | '-|'>): {
  endRef?: ConnectionRef;
  points: GridPoint[];
  startRef?: ConnectionRef;
} {
  const expanded: GridPoint[] = [points[0].point];
  for (let i = 0; i < operators.length; i++) {
    const a = points[i].point;
    const b = points[i + 1].point;
    const op = operators[i];
    if (op === '--') {
      expanded.push(b);
      continue;
    }
    if (op === '|-') {
      expanded.push({ x: a.x, y: b.y });
      expanded.push(b);
      continue;
    }
    expanded.push({ x: b.x, y: a.y });
    expanded.push(b);
  }
  return {
    points: expanded,
    startRef: points[0].ref,
    endRef: points[points.length - 1].ref,
  };
}

function expandDrawPath(
  positionSequences: PositionSequencePreview[],
  segments: DrawPathSegment[],
): GridPoint[] {
  if (positionSequences.length === 0) return [];
  const expanded: GridPoint[] = [positionSequences[0].point];
  for (let i = 0; i < segments.length; i++) {
    const a = positionSequences[i].point;
    const b = positionSequences[i + 1].point;
    const op = segments[i].kind === 'connection' ? (segments[i].operator ?? '--') : '--';
    if (op === '|-') {
      expanded.push({ x: a.x, y: b.y });
    } else if (op === '-|') {
      expanded.push({ x: b.x, y: a.y });
    }
    expanded.push(b);
  }
  return expanded;
}

function parseDrawingStatement(body: string, drawOptions: string | undefined): DrawingInstance | null {
  const normalizedOpts = (drawOptions ?? '').trim();
  const options = normalizedOpts || undefined;

  const bezierMatch = body.match(/^(\([^)]+\))\s*\.\.\s*controls\s*(\([^)]+\))\s*and\s*(\([^)]+\))\s*\.\.\s*(\([^)]+\))$/);
  if (bezierMatch) {
    const start = parseCoord(bezierMatch[1]);
    const control1 = parseCoord(bezierMatch[2]);
    const control2 = parseCoord(bezierMatch[3]);
    const end = parseCoord(bezierMatch[4]);
    if (start && control1 && control2 && end) {
      return { id: '', kind: 'bezier', start, control1, control2, end, props: { options } };
    }
  }

  const rectMatch = body.match(/^(\([^)]+\))\s+rectangle\s+(\([^)]+\))$/);
  if (rectMatch) {
    const start = parseCoord(rectMatch[1]);
    const end = parseCoord(rectMatch[2]);
    if (start && end) return { id: '', kind: 'rectangle', start, end, props: { options } };
  }

  const circleMatch = body.match(/^(\([^)]+\))\s+circle\s*\(\s*([-\d.]+)\s*\)$/);
  if (circleMatch) {
    const center = parseCoord(circleMatch[1]);
    const radius = Number.parseFloat(circleMatch[2]);
    if (center && Number.isFinite(radius)) return { id: '', kind: 'circle', center, radius, props: { options } };
  }

  const simplePathMatch = body.match(/^(\([^)]+\))\s*(--)\s*(\([^)]+\))$/);
  if (simplePathMatch && normalizedOpts) {
    const start = parseCoord(simplePathMatch[1]);
    const end = parseCoord(simplePathMatch[3]);
    if (start && end) {
      const kind = normalizedOpts.includes('->') ? 'arrow' : 'line';
      return { id: '', kind, start, end, props: { options } };
    }
  }

  const textNodeMatch = body.match(/^node(?:\[[^\]]*\])?\s+at\s+(\([^)]+\))\s*\{([\s\S]*)\}$/);
  if (textNodeMatch) {
    const position = parseCoord(textNodeMatch[1]);
    const optionMatch = body.match(/^node(?:\[([^\]]*)\])?\s+at\s+\([^)]+\)\s*\{[\s\S]*\}$/);
    const optionParts = optionMatch?.[1] ? splitOptions(optionMatch[1]) : [];
    const kv = extractKV(optionParts);
    const filtered = optionParts.filter((part) => !/^(anchor|rotate|scale)\s*=/.test(part.trim()));
    if (position) {
      return {
        id: '',
        kind: 'text',
        position,
        props: {
          anchor: kv.anchor,
          options: filtered.join(', ').trim() || undefined,
          rotation: kv.rotate,
          scale: kv.scale,
          text: textNodeMatch[2],
        },
      };
    }
  }

  return null;
}

function normalizeTikzComponentName(name: string): string {
  const base = name.split('=')[0]?.trim() ?? '';
  if (base === 'R' || base === 'resistor') return 'R';
  if (base === 'C' || base === 'capacitor') return 'C';
  return base;
}

function extractRotationOption(opts: string[]): { filtered: string[]; rotation: 0 | 90 | 180 | 270 } {
  let rotation: 0 | 90 | 180 | 270 = 0;
  const filtered = opts.filter((opt) => {
    const match = opt.trim().match(/^rotate\s*=\s*(-?\d+)$/);
    if (!match) return true;
    const parsed = Number.parseInt(match[1], 10);
    const normalized = ((parsed % 360) + 360) % 360;
    if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
      rotation = normalized as 0 | 90 | 180 | 270;
      return false;
    }
    return true;
  });
  return { filtered, rotation };
}

function addPlacedComponent(
  doc: CircuitDocument,
  geometry: TikzGeometryEngine,
  registry: ComponentRegistry,
  tikzToDefId: Map<string, string>,
  id: string,
  tikzName: string,
  position: GridPoint,
  nodeName?: string,
  props: ComponentProps = {},
  positionSequence?: PositionSequencePreview,
): void {
  const defId = tikzToDefId.get(tikzName) ?? tikzName;
  const def = registry.get(defId);
  if (def?.placementType === 'node') {
    const comp: NodeInstance = {
      id, defId, type: 'node', nodeName, position, positionSequence, rotation: 0, mirror: 'none', props,
    };
    doc.addComponent(comp);
    geometry.registerComponentGeometry(comp, def);
    return;
  }
  const comp: MonopoleInstance = { id, defId, type: 'monopole', nodeName, position, positionSequence, rotation: 0, props };
  doc.addComponent(comp);
  geometry.registerComponentGeometry(comp, def);
}

function addTextDrawing(
  doc: CircuitDocument,
  id: string,
  point: GridPoint,
  optionsText: string | undefined,
  text: string | undefined,
): void {
  const optionParts = optionsText ? splitOptions(optionsText) : [];
  const kv = extractKV(optionParts);
  const filtered = optionParts.filter((part) => !/^(anchor|rotate|scale)\s*=/.test(part.trim()));
  doc.addDrawing({
    id,
    kind: 'text',
    position: point,
    props: {
      anchor: kv.anchor,
      options: filtered.join(', ').trim() || undefined,
      rotation: kv.rotate,
      scale: kv.scale,
      text,
    },
  });
}

function materializeStructuredNodeSegments(
  structured: StructuredStatementBody,
  baseId: string,
  doc: CircuitDocument,
  geometry: TikzGeometryEngine,
  registry: ComponentRegistry,
  tikzToDefId: Map<string, string>,
  nodeSequences: Array<PositionSequencePreview | null>,
): boolean {
  if (!structured.segments.some((segment) => segment.kind === 'node')) return false;
  let currentResolved = nodeSequences.length > 0 ? (nodeSequences[0] ?? null) : null;
  let lastResolvedPositionIndex = 0;
  if (structured.positionTexts[0]) {
    currentResolved = doc.getResolvedStatementPositions(baseId)?.[0] ?? currentResolved;
  }

  for (let index = 0; index < structured.segments.length; index += 1) {
    const segment = structured.segments[index];
    if (segment.kind !== 'node') {
      if (segment.kind === 'connection' || segment.kind === 'bipole') {
        lastResolvedPositionIndex += 1;
        currentResolved = doc.getResolvedStatementPositions(baseId)?.[lastResolvedPositionIndex] ?? currentResolved;
      }
      continue;
    }

    const nodeId = `${baseId}:${index}`;
    const nodeResolved = nodeSequences[index] ?? currentResolved;
    doc.setResolvedStatementPositions(nodeId, [nodeResolved]);
    if (!nodeResolved) {
      if (segment.positionText) currentResolved = null;
      continue;
    }

    const tikzName = segment.tikzName ? normalizeTikzComponentName(segment.tikzName) : undefined;
    if (!tikzName) {
      geometry.registerNamedReference(segment.nodeName, nodeResolved);
      // `\coordinate` is a pure named reference point — it never draws anything.
      if (!segment.isCoordinate) addTextDrawing(doc, nodeId, nodeResolved.point, segment.optionsText, segment.text);
      currentResolved = segment.positionText ? nodeResolved : currentResolved;
      continue;
    }

    const optionParts = segment.optionsText ? splitOptions(segment.optionsText) : [];
    const { filtered, rotation } = extractRotationOption(optionParts);
    const props: ComponentProps = {
      options: filtered.join(', ').trim() || undefined,
      text: segment.text?.trim() || undefined,
      textAnchor: undefined,
    };
    addPlacedComponent(doc, geometry, registry, tikzToDefId, nodeId, tikzName, nodeResolved.point, segment.nodeName, props, nodeResolved);
    const comp = doc.getComponent(nodeId);
    const defId = tikzToDefId.get(tikzName) ?? tikzName;
    const def = registry.get(defId);
    if (comp && comp.type !== 'bipole' && def) {
      comp.rotation = rotation;
      geometry.registerComponentGeometry(comp, def);
    }
    currentResolved = segment.positionText ? nodeResolved : currentResolved;
  }

  return true;
}

function buildStructuredDrawPath(
  id: string,
  structured: StructuredStatementBody,
  positionSequences: Array<PositionSequencePreview | null>,
  tikzToDefId: Map<string, string>,
): DrawPathInstance | null {
  const nonNodeSegments = structured.segments.filter((segment) => segment.kind !== 'node');
  if (nonNodeSegments.length === 0) return null;
  const onlyConnectionsAndBipoles = nonNodeSegments.every(
    (segment) => segment.kind === 'connection' || segment.kind === 'bipole',
  );
  if (!onlyConnectionsAndBipoles) return null;
  if (positionSequences.length !== nonNodeSegments.length + 1) return null;
  if (positionSequences.some((sequence) => !sequence)) return null;

  const segments: DrawPathSegment[] = nonNodeSegments.map((segment) => {
    if (segment.kind === 'connection') {
      return { kind: 'connection', operator: segment.operator };
    }
    const tikzName = segment.tikzName ? normalizeTikzComponentName(segment.tikzName) : undefined;
    const defId = tikzName ? (tikzToDefId.get(tikzName) ?? tikzName) : undefined;
    return { kind: 'bipole', defId, props: { ...segment.props } };
  });
  const resolvedSequences = positionSequences as PositionSequencePreview[];
  const points = expandDrawPath(resolvedSequences, segments);
  return {
    id,
    positionSequences: resolvedSequences,
    segments,
    points,
    startRef: resolvedSequences[0]?.ref,
    endRef: resolvedSequences[resolvedSequences.length - 1]?.ref,
    junctions: new Map(),
  };
}

// ─── main parser ────────────────────────────────────────────────────────────

/**
 * Parse the tikzpicture body (or full source) into doc.
 * Each element's id encodes its source line index so it is stable
 * across re-parses as long as the source line doesn't change.
 */
export function parseCircuiTikZ(
  source: string,
  doc: CircuitDocument,
  registry: ComponentRegistry,
  options: { preserveMeasuredComponentBounds?: boolean; preserveMeasuredSymbolPoints?: boolean } = {},
): void {
  const geometry = new TikzGeometryEngine(doc, registry);
  const tikzToDefId = new Map<string, string>();
  for (const def of registry.getAll()) {
    if (!tikzToDefId.has(def.tikzName)) tikzToDefId.set(def.tikzName, def.id);
  }

  doc.clear({
    preserveMeasuredSymbolPoints: options.preserveMeasuredSymbolPoints,
    preserveMeasuredComponentBounds: options.preserveMeasuredComponentBounds,
  });

  const rawLines = source.split('\n');

  // Collect multi-line statements: join continuation until ';'
  // Track which source line each statement starts on.
  type Stmt = { text: string; lineIndex: number };
  const statements: Stmt[] = [];
  let buf = '';
  let stmtLine = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const stripped = rawLines[i].replace(/%.*$/, '').trim();
    if (!stripped || /^\\(begin|end)\b/.test(stripped)) continue;

    if (stripped.startsWith('\\ctikzset')) {
      if (buf.trim()) {
        const pending = buf.trim();
        if (pending) statements.push({ text: pending, lineIndex: stmtLine });
        buf = '';
      }
      statements.push({ text: stripped, lineIndex: i });
      continue;
    }

    if (buf === '') stmtLine = i;
    buf += (buf ? '\n' : '') + stripped;

    if (buf.includes(';')) {
      // May have multiple statements on one logical line
      const parts = buf.split(';');
      for (let p = 0; p < parts.length - 1; p++) {
        const t = parts[p].trim();
        if (t) statements.push({ text: t, lineIndex: stmtLine });
      }
      buf = parts[parts.length - 1].trim();
      if (buf) stmtLine = i;
    }
  }

  for (const { text: stmt, lineIndex } of statements) {
    const parseSingleStatement = (stmtText: string, id: string) => {
      if (stmtText.startsWith('\\ctikzset')) return true;

      const rememberResolvedPositions = (positions: Array<PositionSequencePreview | null>) => {
        doc.setResolvedStatementPositions(id, positions);
      };
      const structuredNode = stmtText.startsWith('\\node')
        ? parseStructuredNodeStatement(stmtText.slice('\\'.length))
        : stmtText.startsWith('\\coordinate')
        ? parseStructuredCoordinateStatement(stmtText.slice('\\'.length))
        : null;
      if (structuredNode) {
        const structuredResolution = geometry.resolveStructuredStatement(id, structuredNode);
        rememberResolvedPositions(structuredResolution.positionSequences);
        materializeStructuredNodeSegments(
          structuredNode,
          id,
          doc,
          geometry,
          registry,
          tikzToDefId,
          structuredResolution.nodeSequences,
        );
        return true;
      }

      const commandMatch = stmtText.match(/^\\(draw|path)(?:\[([^\]]*)\])?\s+(.+)$/s);
      if (!commandMatch) return false;
      const command = commandMatch[1];
      const drawOptions = commandMatch[2];
      const body = commandMatch[3].trim();

      if (body.includes('\n')) {
        const stmtLines = stmtText.split('\n');
        const firstLineHasBody = new RegExp(`^\\\\${command}(?:\\[[^\\]]*\\])?\\s+\\S`).test(stmtLines[0].trim());
        const rawSegments = commandMatch[3]
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        const segments = rawSegments.map((line, index) => ({
          line,
          lineNumber: firstLineHasBody ? lineIndex + index : lineIndex + 1 + index,
        }));

        for (const segment of segments) {
          const cleaned = segment.line.replace(/;\s*$/, '').trim();
          if (!cleaned) continue;
          parseSingleStatement(`\\${command} ${cleaned}`, `line:${segment.lineNumber}`);
        }
        return true;
      }

      const structured = parseStructuredStatementBody(body);
      if (structured) {
        const structuredResolution = geometry.resolveStructuredStatement(id, structured);
        rememberResolvedPositions(structuredResolution.positionSequences);
        const allNodes = structured.segments.length > 0 && structured.segments.every((segment) => segment.kind === 'node');
        const hasNodes = materializeStructuredNodeSegments(
          structured,
          id,
          doc,
          geometry,
          registry,
          tikzToDefId,
          structuredResolution.nodeSequences,
        );
        if (allNodes) return true;

        const drawPath = buildStructuredDrawPath(
          id,
          structured,
          structuredResolution.positionSequences,
          tikzToDefId,
        );
        if (drawPath) {
          doc.addDrawPath(drawPath);
          return true;
        }
        if (hasNodes) return true;
      }

      const drawing = parseDrawingStatement(body, drawOptions);
      if (drawing) {
        drawing.id = id;
        doc.addDrawing(drawing);
        return true;
      }

      return false;
    };

    parseSingleStatement(stmt, `line:${lineIndex}`);
  }
}

/**
 * Return the 0-based line index encoded in an element id like 'line:42'.
 * Returns -1 if the id is not in that format.
 */
export function lineIndexFromId(id: string): number {
  const m = id.match(/^line:(\d+)(?::\d+)?$/);
  return m ? parseInt(m[1], 10) : -1;
}
