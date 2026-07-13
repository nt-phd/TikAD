import type { ConnectionRef, GridPoint } from '../types';
import { formatCoord } from './CoordFormatter';

export function formatConnectionRef(ref: ConnectionRef): string {
  return ref.anchor === 'reference' ? ref.nodeName : `${ref.nodeName}.${ref.anchor}`;
}

export function formatEndpoint(point: GridPoint, ref?: ConnectionRef): string {
  if (!ref) return formatCoord(point);
  return `(${formatConnectionRef(ref)})`;
}
