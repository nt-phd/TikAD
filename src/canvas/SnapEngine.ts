import type { GridPoint } from '../types';
import { scaleState } from './ScaleState';

export class SnapEngine {
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
