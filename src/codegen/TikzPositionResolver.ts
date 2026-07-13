import type {
  ConnectionRef,
  GridPoint,
  PathCornerPreview,
  PositionSequencePreview,
} from '../types';
import type { CircuitDocument } from '../model/CircuitDocument';
import type { ComponentRegistry } from '../definitions/ComponentRegistry';
import { TIKZ_PT_PER_UNIT } from '../constants';
import {
  readTikzBalanced,
  scanTikzPointSequence,
  skipTikzWhitespace,
  type TikzPointSpec,
} from './TikzPointParser';

export interface ResolvedTikzPoint {
  point: GridPoint;
  ref?: ConnectionRef;
}

function findTopLevelToken(source: string, token: string): number {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let inMath = false;
  for (let index = 0; index <= source.length - token.length; index += 1) {
    const ch = source[index];
    const prev = index > 0 ? source[index - 1] : '';
    if (ch === '$' && prev !== '\\') {
      inMath = !inMath;
      continue;
    }
    if (inMath) continue;
    if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    if (paren === 0 && bracket === 0 && brace === 0 && source.startsWith(token, index)) return index;
  }
  return -1;
}

function unwrapOuterBraces(source: string): string {
  const trimmed = source.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return trimmed;
  const balanced = readTikzBalanced(trimmed, 0, '{', '}');
  if (!balanced || balanced.end !== trimmed.length) return trimmed;
  return balanced.text.slice(1, -1).trim();
}

type ScalarValue =
  | { kind: 'scalar'; value: number }
  | { kind: 'dimension'; value: number };

function parseNumberToken(source: string, index: number): { end: number; token: ScalarValue } | null {
  const match = source.slice(index).match(/^((?:\d+(?:\.\d+)?|\.\d+))([A-Za-z]+)?/);
  if (!match) return null;
  const token = match[0];
  const numeric = Number.parseFloat(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  const dimensionUnits: Record<string, number> = {
    pt: 1 / TIKZ_PT_PER_UNIT,
    mm: 0.1,
    cm: 1,
    in: 2.54,
    bp: 2.54 / 72,
    pc: 12 / TIKZ_PT_PER_UNIT,
  };
  if (!unit) {
    return { end: index + token.length, token: { kind: 'scalar', value: numeric } };
  }
  const factor = dimensionUnits[unit];
  if (factor == null) return null;
  return { end: index + token.length, token: { kind: 'dimension', value: numeric * factor } };
}

function upgradeMixedAdditiveKinds(a: ScalarValue, b: ScalarValue): [ScalarValue, ScalarValue] {
  if (a.kind === b.kind) return [a, b];
  if (a.kind === 'scalar' && b.kind === 'dimension') {
    return [{ kind: 'dimension', value: a.value / TIKZ_PT_PER_UNIT }, b];
  }
  if (a.kind === 'dimension' && b.kind === 'scalar') {
    return [a, { kind: 'dimension', value: b.value / TIKZ_PT_PER_UNIT }];
  }
  return [a, b];
}

function parseScalarExpressionInternal(source: string): ScalarValue | null {
  const trimmed = unwrapOuterBraces(source).replace(/\s+/g, '');
  if (!trimmed) return null;
  let index = 0;

  const parsePrimary = (): ScalarValue | null => {
    if (trimmed[index] === '(') {
      index += 1;
      const value = parseExpression();
      if (value == null || trimmed[index] !== ')') return null;
      index += 1;
      return value;
    }
    const token = parseNumberToken(trimmed, index);
    if (!token) return null;
    index = token.end;
    return token.token;
  };

  const parseUnary = (): ScalarValue | null => {
    if (trimmed[index] === '+') {
      index += 1;
      return parseUnary();
    }
    if (trimmed[index] === '-') {
      index += 1;
      const value = parseUnary();
      return value == null ? null : { kind: value.kind, value: -value.value };
    }
    return parsePrimary();
  };

  const parseTerm = (): ScalarValue | null => {
    let value = parseUnary();
    if (value == null) return null;
    while (trimmed[index] === '*' || trimmed[index] === '/') {
      const op = trimmed[index];
      index += 1;
      const rhs = parseUnary();
      if (rhs == null) return null;
      if (op === '*') {
        if (value.kind === 'scalar' && rhs.kind === 'scalar') value = { kind: 'scalar', value: value.value * rhs.value };
        else if (value.kind === 'scalar' && rhs.kind === 'dimension') value = { kind: 'dimension', value: value.value * rhs.value };
        else if (value.kind === 'dimension' && rhs.kind === 'scalar') value = { kind: 'dimension', value: value.value * rhs.value };
        else return null;
      } else {
        if (rhs.value === 0) return null;
        if (value.kind === 'scalar' && rhs.kind === 'scalar') value = { kind: 'scalar', value: value.value / rhs.value };
        else if (value.kind === 'dimension' && rhs.kind === 'scalar') value = { kind: 'dimension', value: value.value / rhs.value };
        else return null;
      }
    }
    return value;
  };

  const parseExpression = (): ScalarValue | null => {
    let value = parseTerm();
    if (value == null) return null;
    while (trimmed[index] === '+' || trimmed[index] === '-') {
      const op = trimmed[index];
      index += 1;
      const rhs = parseTerm();
      if (rhs == null) return null;
      if (value == null) return null;
      const current = value;
      const [left, right] = upgradeMixedAdditiveKinds(current, rhs);
      if (left.kind !== right.kind) return null;
      value = {
        kind: left.kind,
        value: op === '+' ? left.value + right.value : left.value - right.value,
      };
    }
    return value;
  };

  const value = parseExpression();
  return value != null && index === trimmed.length ? value : null;
}

function parseNumericExpression(source: string): number | null {
  const parsed = parseScalarExpressionInternal(source);
  return parsed?.kind === 'scalar' ? parsed.value : null;
}

function parseDimensionExpression(source: string): number | null {
  const parsed = parseScalarExpressionInternal(source);
  if (!parsed) return null;
  return parsed.kind === 'dimension' ? parsed.value : parsed.value;
}

function parseDirectionKeyword(source: string): number | null {
  const normalized = source.trim().toLowerCase().replace(/\s+/g, ' ');
  switch (normalized) {
    case 'right':
    case 'east':
      return 0;
    case 'up':
    case 'north':
      return 90;
    case 'left':
    case 'west':
      return 180;
    case 'down':
    case 'south':
      return -90;
    case 'north east':
      return 45;
    case 'north west':
      return 135;
    case 'south west':
      return 225;
    case 'south east':
      return 315;
    default:
      return null;
  }
}

function parseAngleDegrees(source: string): number | null {
  return parseNumericExpression(source) ?? parseDirectionKeyword(source);
}

function scalePoint(point: GridPoint, factor: number): GridPoint {
  return { x: point.x * factor, y: point.y * factor };
}

function addPoints(a: GridPoint, b: GridPoint): GridPoint {
  return { x: a.x + b.x, y: a.y + b.y };
}

function interpolatePoint(a: GridPoint, b: GridPoint, t: number): GridPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function rotatePointAround(origin: GridPoint, point: GridPoint, angleDeg: number): GridPoint {
  const radians = angleDeg * Math.PI / 180;
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

function projectPointOntoLine(a: GridPoint, p: GridPoint, b: GridPoint): GridPoint | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  return {
    x: a.x + t * dx,
    y: a.y + t * dy,
  };
}

function parseKeyValueList(source: string): Map<string, string> {
  const result = new Map<string, string>();
  let start = 0;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let inMath = false;
  for (let index = 0; index <= source.length; index += 1) {
    const atEnd = index === source.length;
    const ch = atEnd ? ',' : source[index];
    const prev = index > 0 ? source[index - 1] : '';
    if (!atEnd) {
      if (ch === '$' && prev !== '\\') {
        inMath = !inMath;
        continue;
      }
      if (inMath) continue;
      if (ch === '(') paren += 1;
      else if (ch === ')') paren -= 1;
      else if (ch === '[') bracket += 1;
      else if (ch === ']') bracket -= 1;
      else if (ch === '{') brace += 1;
      else if (ch === '}') brace -= 1;
    }
    if (!atEnd && (paren !== 0 || bracket !== 0 || brace !== 0 || ch !== ',')) continue;
    const chunk = source.slice(start, index).trim();
    start = index + 1;
    if (!chunk) continue;
    const eq = chunk.indexOf('=');
    if (eq < 0) continue;
    result.set(chunk.slice(0, eq).trim(), chunk.slice(eq + 1).trim());
  }
  return result;
}

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

function resolvePolarPoint(innerRaw: string): GridPoint | null {
  const match = innerRaw.trim().match(/^([^:]+):(.+)$/);
  if (!match) return null;
  const angle = parseAngleDegrees(match[1]);
  if (angle == null) return null;
  const radii = match[2].trim().split(/\band\b/i).map((part) => part.trim()).filter(Boolean);
  if (radii.length === 0 || radii.length > 2) return null;
  const xRadius = parseNumericExpression(radii[0]);
  const yRadius = parseNumericExpression(radii[1] ?? radii[0]);
  if (xRadius == null || yRadius == null) return null;
  const radians = angle * Math.PI / 180;
  return {
    x: xRadius * Math.cos(radians),
    y: -yRadius * Math.sin(radians),
  };
}

function resolveCoordinateSystemPoint(
  innerRaw: string,
  doc: CircuitDocument,
  registry: ComponentRegistry,
): GridPoint | null {
  const trimmed = innerRaw.trim();
  const match = trimmed.match(/^([A-Za-z][\w-]*)\s+cs:(.+)$/);
  if (!match) return null;
  const system = match[1].toLowerCase();
  const kv = parseKeyValueList(match[2]);

  if (system === 'node') {
    const nodeName = kv.get('name');
    if (!nodeName) return null;
    const anchor = kv.get('anchor');
    const angle = kv.get('angle');
    if (anchor) return resolveReference({ nodeName, anchor }, doc, registry)?.point ?? null;
    if (angle) return resolveReference({ nodeName, anchor: angle }, doc, registry)?.point ?? null;
    return resolveReference({ nodeName }, doc, registry)?.point ?? null;
  }

  if (system === 'barycentric') {
    let totalWeight = 0;
    let sum: GridPoint = { x: 0, y: 0 };
    for (const [nodeName, weightText] of kv.entries()) {
      const weight = parseNumericExpression(weightText);
      const ref = resolveReference({ nodeName }, doc, registry);
      if (weight == null || !ref) return null;
      totalWeight += weight;
      sum = addPoints(sum, scalePoint(ref.point, weight));
    }
    if (!totalWeight) return null;
    return scalePoint(sum, 1 / totalWeight);
  }

  if (system === 'canvas polar' || system === 'xyz polar' || system === 'xy polar') {
    const angle = parseAngleDegrees(kv.get('angle') ?? '');
    const radius = parseNumericExpression(kv.get('radius') ?? '');
    const xRadius = parseNumericExpression(kv.get('x radius') ?? kv.get('radius') ?? '');
    const yRadius = parseNumericExpression(kv.get('y radius') ?? kv.get('radius') ?? '');
    if (angle == null || (radius == null && (xRadius == null || yRadius == null))) return null;
    const radians = angle * Math.PI / 180;
    const rx = xRadius ?? radius ?? 0;
    const ry = yRadius ?? radius ?? 0;
    return {
      x: rx * Math.cos(radians),
      y: -ry * Math.sin(radians),
    };
  }

  if (system === 'canvas' || system === 'xyz') {
    const x = parseNumericExpression(kv.get('x') ?? '0');
    const y = parseNumericExpression(kv.get('y') ?? '0');
    if (x == null || y == null) return null;
    return { x, y: -y };
  }

  return null;
}

function parseSingleTikzPoint(source: string): TikzPointSpec | null {
  const sequence = scanTikzPointSequence(source, 0);
  if (!sequence || sequence.points.length !== 1) return null;
  if (skipTikzWhitespace(source, sequence.end) !== source.length) return null;
  return sequence.points[0];
}

function resolveCalcCoordinateTerm(
  source: string,
  currentPoint: GridPoint | null,
  doc: CircuitDocument,
  registry: ComponentRegistry,
): { end: number; point: GridPoint } | null {
  let cursor = skipTikzWhitespace(source, 0);
  let factor = 1;

  const starIndex = findTopLevelToken(source.slice(cursor), '*');
  if (starIndex >= 0) {
    const factorText = source.slice(cursor, cursor + starIndex).trim();
    const parsedFactor = parseNumericExpression(factorText);
    const pointText = source.slice(cursor + starIndex + 1);
    const pointSpec = parseSingleTikzPoint(pointText.trim());
    if (parsedFactor != null && pointSpec) {
      factor = parsedFactor;
      const resolved = resolveTikzPointSpec(pointSpec, currentPoint, doc, registry);
      if (!resolved) return null;
      return {
        end: source.length,
        point: scalePoint(resolved.point, factor),
      };
    }
  }

  const pointScan = scanTikzPointSequence(source, cursor);
  if (!pointScan || pointScan.points.length !== 1) return null;
  let resolved = resolveTikzPointSpec(pointScan.points[0], currentPoint, doc, registry);
  if (!resolved) return null;
  cursor = skipTikzWhitespace(source, pointScan.end);

  while (cursor < source.length && source[cursor] === '!') {
    cursor += 1;
    const secondBang = findTopLevelToken(source.slice(cursor), '!');
    if (secondBang < 0) return null;
    const factorText = source.slice(cursor, cursor + secondBang).trim();
    cursor += secondBang + 1;
    const nextSeparator = (() => {
      const plusIndex = findTopLevelToken(source.slice(cursor), '+');
      const minusIndex = findTopLevelToken(source.slice(cursor), '-');
      const candidates = [plusIndex, minusIndex].filter((value) => value >= 0);
      return candidates.length > 0 ? Math.min(...candidates) : -1;
    })();
    const targetChunk = nextSeparator >= 0 ? source.slice(cursor, cursor + nextSeparator) : source.slice(cursor);
    const colonIndex = findTopLevelToken(targetChunk, ':');
    const angleText = colonIndex >= 0 ? targetChunk.slice(0, colonIndex).trim() : null;
    const pointText = colonIndex >= 0 ? targetChunk.slice(colonIndex + 1).trim() : targetChunk.trim();
    const targetPoint = parseSingleTikzPoint(pointText);
    if (!targetPoint) return null;
    const targetResolved = resolveTikzPointSpec(targetPoint, currentPoint, doc, registry);
    if (!targetResolved) return null;
    const projectionPoint = parseSingleTikzPoint(factorText);
    if (projectionPoint) {
      const projected = resolveTikzPointSpec(projectionPoint, currentPoint, doc, registry);
      if (!projected) return null;
      const projection = projectPointOntoLine(resolved.point, projected.point, targetResolved.point);
      if (!projection) return null;
      resolved = { point: projection };
      cursor = nextSeparator >= 0 ? cursor + nextSeparator : source.length;
      continue;
    }

    const rotatedTarget: GridPoint | null = ((): GridPoint | null => {
      if (!angleText) return targetResolved.point;
      const angle = parseAngleDegrees(angleText);
      return angle == null ? null : rotatePointAround(resolved.point, targetResolved.point, angle);
    })();
    if (!rotatedTarget) return null;

    const scalar = parseNumericExpression(factorText);
    if (scalar != null) {
      resolved = { point: interpolatePoint(resolved.point, rotatedTarget, scalar) };
      cursor = nextSeparator >= 0 ? cursor + nextSeparator : source.length;
      continue;
    }

    const distance = parseDimensionExpression(factorText);
    if (distance == null) return null;
    const dx: number = rotatedTarget.x - resolved.point.x;
    const dy: number = rotatedTarget.y - resolved.point.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return null;
    resolved = {
      point: {
        x: resolved.point.x + distance * dx / len,
        y: resolved.point.y + distance * dy / len,
      },
    };
    cursor = nextSeparator >= 0 ? cursor + nextSeparator : source.length;
  }

  if (cursor !== source.length) return null;
  return {
    end: cursor,
    point: scalePoint(resolved.point, factor),
  };
}

function splitCalcTerms(source: string): Array<{ sign: 1 | -1; text: string }> | null {
  const terms: Array<{ sign: 1 | -1; text: string }> = [];
  let cursor = 0;
  let start = 0;
  let sign: 1 | -1 = 1;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let inMath = false;

  while (cursor < source.length) {
    const ch = source[cursor];
    const prev = cursor > 0 ? source[cursor - 1] : '';
    if (ch === '$' && prev !== '\\') {
      inMath = !inMath;
      cursor += 1;
      continue;
    }
    if (inMath) {
      cursor += 1;
      continue;
    }
    if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    else if ((ch === '+' || ch === '-') && paren === 0 && bracket === 0 && brace === 0) {
      const chunk = source.slice(start, cursor).trim();
      if (chunk) terms.push({ sign, text: chunk });
      sign = ch === '+' ? 1 : -1;
      start = cursor + 1;
    }
    cursor += 1;
  }

  const chunk = source.slice(start).trim();
  if (chunk) terms.push({ sign, text: chunk });
  return terms.length > 0 ? terms : null;
}

function resolveCalcPoint(
  innerRaw: string,
  currentPoint: GridPoint | null,
  doc: CircuitDocument,
  registry: ComponentRegistry,
): GridPoint | null {
  const expression = innerRaw.trim();
  if (!expression.startsWith('$') || !expression.endsWith('$')) return null;
  const body = expression.slice(1, -1).trim();
  const terms = splitCalcTerms(body);
  if (!terms) return null;
  let total: GridPoint | null = null;
  for (const term of terms) {
    const resolved = resolveCalcCoordinateTerm(term.text, currentPoint, doc, registry);
    if (!resolved) return null;
    const signedPoint = term.sign === 1 ? resolved.point : scalePoint(resolved.point, -1);
    total = total ? addPoints(total, signedPoint) : signedPoint;
  }
  return total;
}

export function resolveReference(
  ref: { nodeName: string; anchor?: string },
  doc: CircuitDocument,
  registry: ComponentRegistry,
): ResolvedTikzPoint | null {
  const storedPoint = doc.getSymbolPoint(ref.nodeName, ref.anchor);
  if (storedPoint) {
    return {
      point: storedPoint,
      ref: {
        componentId: '',
        nodeName: ref.nodeName,
        anchor: ref.anchor ?? 'reference',
      },
    };
  }
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
  const match = doc.getSymbolPoint(ref.nodeName, ref.anchor);
  if (!match) return null;
  return {
    point: match,
    ref: {
      componentId: comp.id,
      nodeName: ref.nodeName,
      anchor: ref.anchor,
    },
  };
}

export function resolveEndpointToken(
  token: string,
  doc: CircuitDocument,
  registry: ComponentRegistry,
): ResolvedTikzPoint | null {
  const coord = parseCoord(token);
  if (coord) return { point: coord };
  const ref = parseReferenceInner(token.replace(/^\(\s*|\s*\)$/g, ''));
  if (!ref) return null;
  return resolveReference(ref, doc, registry);
}

export function resolveTikzPointSpec(
  point: TikzPointSpec,
  currentPoint: GridPoint | null,
  doc: CircuitDocument,
  registry: ComponentRegistry,
): ResolvedTikzPoint | null {
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
    case 'coordinate-system': {
      const coord = resolveCoordinateSystemPoint(point.innerRaw, doc, registry);
      return coord ? { point: coord } : null;
    }
    case 'polar': {
      const coord = resolvePolarPoint(point.innerRaw);
      return coord ? { point: coord } : null;
    }
    case 'calc': {
      const coord = resolveCalcPoint(point.innerRaw, currentPoint, doc, registry);
      return coord ? { point: coord } : null;
    }
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

export function resolvePositionSequencePreview(
  positionText: string,
  doc: CircuitDocument,
  registry: ComponentRegistry,
  basePoint: GridPoint | null = null,
  baseRef?: ConnectionRef,
): PositionSequencePreview | null {
  const tokens = scanTikzPointSequence(positionText, 0)?.points ?? [];
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

export function resolveStructuredPositionTexts(
  positionTexts: string[],
  doc: CircuitDocument,
  registry: ComponentRegistry,
): PositionSequencePreview[] | null {
  const sequences = resolveStructuredPositionTextsPartial(positionTexts, doc, registry);
  if (sequences.length === 0 || sequences.some((sequence) => !sequence)) return null;
  return sequences as PositionSequencePreview[];
}

export function resolveStructuredPositionTextsPartial(
  positionTexts: string[],
  doc: CircuitDocument,
  registry: ComponentRegistry,
): Array<PositionSequencePreview | null> {
  if (positionTexts.length === 0) return [];
  const sequences: Array<PositionSequencePreview | null> = [];
  let currentPoint: GridPoint | null = null;
  let currentRef: ConnectionRef | undefined;
  for (const positionText of positionTexts) {
    const resolved = resolvePositionSequencePreview(positionText, doc, registry, currentPoint, currentRef);
    sequences.push(resolved);
    if (resolved) {
      currentPoint = resolved.point;
      currentRef = resolved.ref;
    }
  }
  return sequences;
}
