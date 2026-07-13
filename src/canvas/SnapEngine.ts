import type { ConnectionRef, GridPoint } from '../types';
import { scaleState } from './ScaleState';

export interface SnapResult {
  point: GridPoint;
  ref?: ConnectionRef;
}

export class SnapEngine {
  connectionSnapEnabled = true;

  snap(raw: GridPoint, symbolPoints?: Map<string, GridPoint>): SnapResult {
    const gridPoint = this.snapToGrid(raw);
    if (!this.connectionSnapEnabled || !symbolPoints) return { point: gridPoint };

    const pinSnapRadius = 0.5 * scaleState.gridPitch;
    let best: SnapResult | null = null;
    let bestDist = pinSnapRadius;

    for (const [key, point] of symbolPoints) {
      const d = Math.hypot(raw.x - point.x, raw.y - point.y);
      if (d > bestDist) continue;
      bestDist = d;
      const dotIndex = key.indexOf('.');
      const nodeName = dotIndex >= 0 ? key.slice(0, dotIndex) : key;
      const anchor = dotIndex >= 0 ? key.slice(dotIndex + 1) : 'reference';
      best = { point, ref: { componentId: '', nodeName, anchor } };
    }

    return best ?? { point: gridPoint };
  }

  snapToGrid(raw: GridPoint): GridPoint {
    return {
      x: Math.round(raw.x / scaleState.gridPitch) * scaleState.gridPitch,
      y: Math.round(raw.y / scaleState.gridPitch) * scaleState.gridPitch,
    };
  }

  snapWorldToGrid(worldX: number, worldY: number): GridPoint {
    const gs = scaleState.effectiveGridSize;
    return {
      x: Math.round((worldX / gs) / scaleState.gridPitch) * scaleState.gridPitch,
      y: Math.round((worldY / gs) / scaleState.gridPitch) * scaleState.gridPitch,
    };
  }
}
