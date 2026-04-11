import type { ConnectionRef, GridPoint, WireInstance } from '../types';
import { formatCoord } from './CoordFormatter';

function formatEndpoint(point: GridPoint, ref?: ConnectionRef): string {
  if (!ref) return formatCoord(point);
  return ref.anchor === 'reference' ? `(${ref.nodeName})` : `(${ref.nodeName}.${ref.anchor})`;
}

function isHorizontal(a: GridPoint, b: GridPoint): boolean {
  return a.y === b.y && a.x !== b.x;
}

function isVertical(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y !== b.y;
}

function chooseCornerOperator(
  prev: GridPoint,
  corner: GridPoint,
  next: GridPoint,
): '|-' | '-|' | null {
  if (isHorizontal(prev, corner)) return '|-';
  if (isVertical(prev, corner)) return '-|';
  if (prev.x === corner.x && corner.y === next.y) return '|-';
  if (prev.y === corner.y && corner.x === next.x) return '-|';

  if (isHorizontal(prev, corner)) {
    if (prev.x === next.x && corner.y === next.y) return '|-';
    if (prev.y === next.y && corner.x === next.x) return '-|';
  }

  if (isVertical(prev, corner)) {
    if (prev.x === next.x && corner.y === next.y) return '|-';
    if (prev.y === next.y && corner.x === next.x) return '-|';
  }

  return null;
}

export function emitWirePath(wire: WireInstance): string {
  if (wire.pathPoints && wire.pathPoints.length > 0 && (!wire.operators || wire.operators.length === 0)) {
    return wire.pathPoints
      .map((point, index, points) => formatEndpoint(
        point,
        index === 0 ? wire.startRef : index === points.length - 1 ? wire.endRef : undefined,
      ))
      .join(' ');
  }
  if (wire.points.length < 2) return '';
  if (wire.operators && wire.pathPoints && wire.pathPoints.length === wire.operators.length + 1) {
    const parts: string[] = [formatEndpoint(wire.pathPoints[0], wire.startRef)];
    for (let i = 0; i < wire.operators.length; i++) {
      const ref = i === wire.operators.length - 1 ? wire.endRef : undefined;
      parts.push(wire.operators[i], formatEndpoint(wire.pathPoints[i + 1], ref));
    }
    return parts.join(' ');
  }
  const parts: string[] = [formatEndpoint(wire.points[0], wire.startRef)];
  let i = 0;
  while (i < wire.points.length - 1) {
    const prev = wire.points[i];
    const corner = wire.points[i + 1];
    const next = wire.points[i + 2];
    if (next) {
      const op = chooseCornerOperator(prev, corner, next);
      if (op) {
        const ref = i + 2 === wire.points.length - 1 ? wire.endRef : undefined;
        parts.push(op, formatEndpoint(next, ref));
        i += 2;
        continue;
      }
    }
    const target = wire.points[i + 1];
    const ref = i + 1 === wire.points.length - 1 ? wire.endRef : undefined;
    parts.push('--', formatEndpoint(target, ref));
    i += 1;
  }
  return parts.join(' ');
}
