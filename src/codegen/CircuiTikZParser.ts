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
  ComponentProps,
  DrawingInstance,
  PositionSequencePreview,
  PathCornerPreview,
  EditableConnectionSegment,
} from '../types';
import type { CircuitDocument } from '../model/CircuitDocument';
import type { ComponentRegistry } from '../definitions/ComponentRegistry';
import { getComponentAnchorPoints } from '../canvas/ConnectionAnchors';
import {
  readTikzBalanced,
  scanTikzPointSequence,
  skipTikzWhitespace,
  type TikzPointSpec,
} from './TikzPointParser';
import { extractKV, splitOptions } from './TikzStatementSyntax';
import { parseStructuredStatementBody, splitNodePlacementText, splitStructuredStatementParts } from './TikzStructuredStatement';

// ─── helpers ───────────────────────────────────────────────────────────────

function parseCoord(s: string): GridPoint | null {
  const m = s.match(/\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (!m) return null;
  return { x: parseFloat(m[1]), y: -parseFloat(m[2]) };
}

function parseRelativeCoordInner(s: string): GridPoint | null {
  const m = s.trim().match(/^([-\d.]+)\s*,\s*([-\d.]+)$/);
  if (!m) return null;
  return { x: parseFloat(m[1]), y: -parseFloat(m[2]) };
}

function parseReferenceInner(s: string): { nodeName: string; anchor?: string } | null {
  const explicit = s.trim().match(/^([A-Za-z][\w]*)\.([^)]+)$/);
  if (explicit) return { nodeName: explicit[1], anchor: explicit[2].trim() };
  const bare = s.trim().match(/^([A-Za-z][\w]*)$/);
  if (bare) return { nodeName: bare[1] };
  return null;
}

function resolveReference(
  ref: { nodeName: string; anchor?: string },
  doc: CircuitDocument,
  registry: ComponentRegistry,
): { point: GridPoint; ref?: ConnectionRef } | null {
  const comp = doc.getComponentByNodeName(ref.nodeName);
  if (!comp) return null;
  const def = registry.get(comp.defId);
  if (!def) return null;
  if (!ref.anchor) {
    return {
      point: comp.type === 'bipole' ? comp.start : comp.position,
      ref: {
        componentId: comp.id,
        nodeName: ref.nodeName,
        anchor: 'reference',
      },
    };
  }
  const match = getComponentAnchorPoints(comp, def).find((anchor) => anchor.ref?.anchor === ref.anchor);
  if (!match) return null;
  return {
    point: match.point,
    ref: {
      componentId: comp.id,
      nodeName: ref.nodeName,
      anchor: ref.anchor,
    },
  };
}

function resolveEndpoint(
  token: string,
  doc: CircuitDocument,
  registry: ComponentRegistry,
): { point: GridPoint; ref?: ConnectionRef } | null {
  const coord = parseCoord(token);
  if (coord) return { point: coord };
  const ref = parseReferenceInner(token.replace(/^\(\s*|\s*\)$/g, ''));
  if (!ref) return null;
  return resolveReference(ref, doc, registry);
}

function resolveTikzPointSpec(
  point: TikzPointSpec,
  currentPoint: GridPoint | null,
  doc: CircuitDocument,
  registry: ComponentRegistry,
): { point: GridPoint; ref?: ConnectionRef } | null {
  if (point.relativeMode !== 'none') {
    const relative = parseRelativeCoordInner(point.innerRaw);
    if (!relative || !currentPoint) return null;
    return {
      point: {
        x: currentPoint.x + relative.x,
        y: currentPoint.y + relative.y,
      },
    };
  }

  switch (point.kind) {
    case 'regular': {
      const coord = parseCoord(`(${point.innerRaw})`);
      return coord ? { point: coord } : null;
    }
    case 'node-ref': {
      const ref = parseReferenceInner(point.innerRaw);
      return ref ? resolveReference(ref, doc, registry) : null;
    }
    case 'options': {
      const options = readTikzBalanced(point.innerRaw, skipTikzWhitespace(point.innerRaw, 0), '[', ']');
      if (!options) return null;
      const nested = scanTikzPointSequence(point.innerRaw.slice(options.end), 0);
      if (!nested || nested.points.length !== 1) return null;
      return resolveTikzPointSpec(nested.points[0], currentPoint, doc, registry);
    }
    case 'hv':
    case 'vh': {
      const separator = point.kind === 'hv' ? '-|' : '|-';
      const splitIndex = point.innerRaw.indexOf(separator);
      if (splitIndex < 0) return null;
      const firstRaw = point.innerRaw.slice(0, splitIndex).trim();
      const secondRaw = point.innerRaw.slice(splitIndex + separator.length).trim();
      const first = scanTikzPointSequence(firstRaw, 0);
      const second = scanTikzPointSequence(secondRaw, 0);
      if (!first || !second || first.points.length !== 1 || second.points.length !== 1) return null;
      const firstResolved = resolveTikzPointSpec(first.points[0], currentPoint, doc, registry);
      const secondResolved = resolveTikzPointSpec(second.points[0], currentPoint, doc, registry);
      if (!firstResolved || !secondResolved) return null;
      return {
        point: point.kind === 'hv'
          ? { x: secondResolved.point.x, y: firstResolved.point.y }
          : { x: firstResolved.point.x, y: secondResolved.point.y },
      };
    }
    default:
      return null;
  }
}

function resolvePositionSequencePreview(
  prefix: string,
  doc: CircuitDocument,
  registry: ComponentRegistry,
  basePoint: GridPoint | null = null,
  baseRef?: ConnectionRef,
): PositionSequencePreview | null {
  const tokens = scanTikzPointSequence(prefix, 0)?.points ?? [];
  if (tokens.length === 0) return null;
  let current: GridPoint | null = basePoint ? { ...basePoint } : null;
  const corners: PathCornerPreview[] = [];

  for (const token of tokens) {
    const resolved = resolveTikzPointSpec(token, current, doc, registry);
    if (!resolved) return null;
    if (token.relativeMode !== 'none' && corners.length === 0 && current) {
      corners.push({
        kind: baseRef ? 'reference' : 'absolute',
        point: { ...current },
        ref: baseRef,
      });
    }
    current = resolved.point;
    if (token.relativeMode !== 'none') {
      corners.push({
        kind: 'relative',
        point: resolved.point,
        relativeFromIndex: corners.length - 1,
      });
      continue;
    }
    corners.push({
      kind: resolved.ref ? 'reference' : 'absolute',
      point: resolved.point,
      ref: resolved.ref,
    });
  }

  const lastCorner = corners[corners.length - 1];
  return current && lastCorner
    ? { corners, point: current, ref: lastCorner.ref }
    : null;
}

function buildSinglePointPreview(point: GridPoint, ref?: ConnectionRef): PositionSequencePreview {
  return {
    corners: [{
      kind: ref ? 'reference' : 'absolute',
      point,
      ref,
    }],
    point,
    ref,
  };
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

function resolveStructuredPositionTexts(
  positionTexts: string[],
  doc: CircuitDocument,
  registry: ComponentRegistry,
): PositionSequencePreview[] | null {
  if (positionTexts.length === 0) return null;
  const sequences: PositionSequencePreview[] = [];
  let currentPoint: GridPoint | null = null;
  let currentRef: ConnectionRef | undefined;
  for (const positionText of positionTexts) {
    const resolved = resolvePositionSequencePreview(positionText, doc, registry, currentPoint, currentRef);
    if (!resolved) return null;
    sequences.push(resolved);
    currentPoint = resolved.point;
    currentRef = resolved.ref;
  }
  return sequences;
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
  const trimmed = name.trim();
  if (trimmed === 'R' || trimmed === 'resistor') return 'R';
  if (trimmed === 'C' || trimmed === 'capacitor') return 'C';
  return trimmed;
}

function parseNodePlacementFragments(
  body: string,
  baseId: string,
  doc: CircuitDocument,
  registry: ComponentRegistry,
  tikzToDefId: Map<string, string>,
): boolean {
  const placementRe = /((?:(?:\+\+?)?\(\s*[^()]+\s*\)\s*)+)node(?:\[([^\]]*)\])?\s*(?:\(([^)]+)\))?\s*\{([\s\S]*?)\}/g;
  const matches = [...body.matchAll(placementRe)];
  if (matches.length === 0) return false;
  if (matches.map((match) => match[0]).join(' ').replace(/\s+/g, ' ').trim() !== body.replace(/\s+/g, ' ').trim()) {
    return false;
  }

  matches.forEach((match, index) => {
    const id = matches.length === 1 ? baseId : `${baseId}:${index}`;
      const resolved = resolvePositionSequencePreview(match[1], doc, registry);
      if (!resolved) return;
    const optionParts = match[2] ? splitOptions(match[2]) : [];
    const firstOption = optionParts[0]?.trim();
    const normalizedTikzName = firstOption && !firstOption.includes('=')
      ? normalizeTikzComponentName(firstOption)
      : undefined;
    const defId = normalizedTikzName ? (tikzToDefId.get(normalizedTikzName) ?? normalizedTikzName) : undefined;
    const def = defId ? registry.get(defId) : undefined;
    const text = match[4]?.trim() ?? '';

    if (def && normalizedTikzName) {
      const { filtered, rotation } = extractRotationOption(optionParts.slice(1));
      const props: ComponentProps = {
        options: filtered.join(', ').trim() || undefined,
        text: text || undefined,
        textAnchor: undefined,
      };
      addPlacedComponent(doc, registry, tikzToDefId, id, normalizedTikzName, resolved.point, match[3]?.trim(), props, resolved);
      const comp = doc.getComponent(id);
      if (comp && comp.type !== 'bipole') comp.rotation = rotation;
      return;
    }

    const kv = extractKV(optionParts);
    const filteredOptions = optionParts
      .filter((part) => !/^(anchor|rotate|scale)\s*=/.test(part.trim()))
      .join(', ')
      .trim() || undefined;
    doc.addDrawing({
      id,
      kind: 'text',
      position: resolved.point,
      props: {
        anchor: kv.anchor,
        options: filteredOptions,
        rotation: kv.rotate,
        scale: kv.scale,
        text,
      },
    });
  });

  return true;
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
    return;
  }
  const comp: MonopoleInstance = { id, defId, type: 'monopole', nodeName, position, positionSequence, rotation: 0, props };
  doc.addComponent(comp);
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
): void {
  const tikzToDefId = new Map<string, string>();
  for (const def of registry.getAll()) {
    if (!tikzToDefId.has(def.tikzName)) tikzToDefId.set(def.tikzName, def.id);
  }

  doc.clear();

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
      const nodeStmtMatch = stmtText.match(/^\\node\s*\[([^\]]+)\]\s*(?:\(([^)]+)\))?\s+at\s+(\([^)]+\))\s*\{([\s\S]*?)\}(?:\s+node\[(.*?)\]\s+at\s+\(([^)]+)\)\s*\{([\s\S]*?)\})?$/);
      if (nodeStmtMatch) {
        const resolvedPosition = resolveEndpoint(nodeStmtMatch[3], doc, registry);
        const resolvedSequence = resolvePositionSequencePreview(nodeStmtMatch[3], doc, registry);
        const opts = splitOptions(nodeStmtMatch[1]);
        const tikzName = opts[0]?.trim();
        const normalizedTikzName = tikzName && !tikzName.includes('=') ? normalizeTikzComponentName(tikzName) : undefined;
        const defId = normalizedTikzName ? (tikzToDefId.get(normalizedTikzName) ?? normalizedTikzName) : undefined;
        const def = defId ? registry.get(defId) : undefined;
        const textAnchorOpts = nodeStmtMatch[5] ? extractKV(splitOptions(nodeStmtMatch[5])) : {};
        const textTarget = nodeStmtMatch[6]?.trim();
        const inlineText = nodeStmtMatch[4]?.trim();
        const trailingText = nodeStmtMatch[7];
        if (resolvedPosition && normalizedTikzName && def) {
          const { filtered, rotation } = extractRotationOption(opts.slice(1));
          const extraOptions = filtered.join(', ').trim() || undefined;
          const props: ComponentProps = {
            options: extraOptions,
            text: textTarget?.endsWith('.text') ? trailingText : (inlineText || undefined),
            textAnchor: textTarget?.endsWith('.text') ? (textAnchorOpts.anchor ?? undefined) : undefined,
          };
          addPlacedComponent(
            doc,
            registry,
            tikzToDefId,
            id,
            normalizedTikzName,
            resolvedPosition.point,
            nodeStmtMatch[2]?.trim(),
            props,
            resolvedSequence ?? buildSinglePointPreview(resolvedPosition.point, resolvedPosition.ref),
          );
          const comp = doc.getComponent(id);
          if (comp && comp.type !== 'bipole') comp.rotation = rotation;
        } else if (resolvedPosition) {
          const kv = extractKV(opts);
          const filtered = opts.filter((part) => !/^(anchor|rotate|scale)\s*=/.test(part.trim()));
          doc.addDrawing({
            id,
            kind: 'text',
            position: resolvedPosition.point,
            props: {
              anchor: kv.anchor,
              options: filtered.join(', ').trim() || undefined,
              rotation: kv.rotate,
              scale: kv.scale,
              text: inlineText,
            },
          });
        }
        return true;
      }

      const textNodeStmtMatch = stmtText.match(/^\\node(?:\[(.*?)\])?\s+at\s+(\([^)]+\))\s*\{([\s\S]*?)\}$/);
      if (textNodeStmtMatch) {
        const resolvedPosition = resolveEndpoint(textNodeStmtMatch[2], doc, registry);
        const opts = textNodeStmtMatch[1] ? splitOptions(textNodeStmtMatch[1]) : [];
        const kv = extractKV(opts);
        const filtered = opts.filter((part) => !/^(anchor|rotate|scale)\s*=/.test(part.trim()));
        if (resolvedPosition) {
          doc.addDrawing({
            id,
            kind: 'text',
            position: resolvedPosition.point,
            props: {
              anchor: kv.anchor,
              options: filtered.join(', ').trim() || undefined,
              rotation: kv.rotate,
              scale: kv.scale,
              text: textNodeStmtMatch[3],
            },
          });
        }
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

      if (parseNodePlacementFragments(body, id, doc, registry, tikzToDefId)) {
        return true;
      }

      const drawing = parseDrawingStatement(body, drawOptions);
      if (drawing) {
        drawing.id = id;
        doc.addDrawing(drawing);
        return true;
      }

      const structured = parseStructuredStatementBody(body);
      const split = structured ? splitStructuredStatementParts(structured) : null;
      if (split) {
        split.forEach((part, index) => {
          parseSingleStatement(`\\${command} ${part}`, `${id}:${index}`);
        });
        return true;
      }
 
      if (structured) {
        const connectionSegments = structured.segments.filter(
          (segment): segment is EditableConnectionSegment => segment.kind === 'connection',
        );
        const allConnections = connectionSegments.length === structured.segments.length;
        if (allConnections) {
          const positionSequences = resolveStructuredPositionTexts(structured.positionTexts, doc, registry);
          if (!positionSequences) return true;
          const operators = connectionSegments.map((segment) => segment.operator);
          const expanded = expandWirePath(positionSequences, operators);
          const wire: WireInstance = {
            id,
            points: operators.length > 0
              ? expanded.points
              : positionSequences.map((sequence) => ({ ...sequence.point })),
            pathPoints: positionSequences.map((sequence) => sequence.point),
            pathSequences: positionSequences,
            startRef: expanded.startRef,
            endRef: expanded.endRef,
            operators,
            junctions: new Map(),
          };
          doc.addWire(wire);
          return true;
        }
      }

      if (structured && structured.segments.length === 1) {
        const [segment] = structured.segments;
        if (segment.kind === 'node') {
          const resolvedPosition = structured.positionTexts[0]
            ? resolvePositionSequencePreview(splitNodePlacementText(structured.positionTexts[0]).positionText, doc, registry)
            : null;
          const tikzName = segment.tikzName ? normalizeTikzComponentName(segment.tikzName) : undefined;
          if (!tikzName || !resolvedPosition) return true;
          const props: ComponentProps = {
            options: segment.optionsText?.trim() || undefined,
            text: segment.text?.trim() || undefined,
            textAnchor: undefined,
          };
          addPlacedComponent(doc, registry, tikzToDefId, id, tikzName, resolvedPosition.point, segment.nodeName, props, resolvedPosition);
          return true;
        }
        if (segment.kind === 'bipole') {
          const positionSequences = resolveStructuredPositionTexts(structured.positionTexts, doc, registry);
          const startEndpoint = positionSequences?.[0] ?? null;
          const endEndpoint = positionSequences?.[1] ?? null;
          if (!startEndpoint || !endEndpoint) return true;
          const tikzName = segment.tikzName ? normalizeTikzComponentName(segment.tikzName) : undefined;
          if (!tikzName) return true;
          const defId = tikzToDefId.get(tikzName) ?? tikzName;
          const comp: BipoleInstance = {
            id,
            defId,
            type: 'bipole',
            start: startEndpoint.point,
            end: endEndpoint.point,
            startRef: startEndpoint.ref,
            endRef: endEndpoint.ref,
            startSequence: startEndpoint,
            endSequence: endEndpoint,
            props: { ...segment.props },
          };
          doc.addComponent(comp);
          return true;
        }
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
