import type { ConnectionRef, GridPoint } from '../types';
import type { TikzGeometryState } from '../codegen/TikzGeometryStore';
import { scaleState } from './ScaleState';

export interface SnapResult {
  point: GridPoint;
  ref?: ConnectionRef;
}

const PIN_SNAP_RADIUS = 0.5;

export class SnapEngine {
  connectionSnapEnabled = true;

  snap(raw: GridPoint, geometry?: TikzGeometryState): SnapResult {
    const gridPoint = this.snapToGrid(raw);
    if (!this.connectionSnapEnabled || !geometry) return { point: gridPoint };

    let best: SnapResult | null = null;
    let bestDist = PIN_SNAP_RADIUS;

    for (const [key, point] of geometry.symbolPoints) {
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
