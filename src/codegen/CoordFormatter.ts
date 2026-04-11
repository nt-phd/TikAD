import type { GridPoint } from '../types';

/**
 * Formats grid coordinates as CircuiTikZ coordinate strings.
 * SVG uses Y-down, TikZ uses Y-up → we negate Y.
 */
function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  const rounded = Math.abs(value) < 1e-9 ? 0 : value;
  return rounded.toFixed(4).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function formatCoord(p: GridPoint): string {
  const tx = p.x;
  const ty = -p.y; // flip Y for TikZ
  const fx = formatNumber(tx);
  const fy = formatNumber(ty);
  return `(${fx},${fy})`;
}
