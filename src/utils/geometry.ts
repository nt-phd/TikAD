import type { GridPoint } from '../types';

export function distance(a: GridPoint, b: GridPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function midpoint(a: GridPoint, b: GridPoint): GridPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function angleDeg(a: GridPoint, b: GridPoint): number {
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
}

export function snapToGrid(value: number, gridSize: number = 1): number {
  return Math.round(value / gridSize) * gridSize;
}

export function pointsEqual(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}
