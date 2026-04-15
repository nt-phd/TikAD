import type { GridPoint } from '../types';
import { BaseTool } from './BaseTool';
import { pointsEqual } from '../utils/geometry';
import { formatCoord } from '../codegen/CoordFormatter';

export class PlaceBipoleTool extends BaseTool {
  private startPoint: GridPoint | null = null;
  private hoverPoint: GridPoint | null = null;

  constructor(ctx: import('./BaseTool').ToolContext, private defId: string) {
    super(ctx);
  }

  onMouseDown(gridPt: GridPoint, e: MouseEvent): void {
    if (e.button !== 0) {
      this.startPoint = null;
      this.hoverPoint = null;
      this.ctx.ghost.setGhostElement(null);
      return;
    }

    if (!this.startPoint) {
      this.startPoint = gridPt;
      this.hoverPoint = null;
    } else {
      if (pointsEqual(this.startPoint, gridPt)) return;
      const tikzName = this.ctx.getDef(this.defId)?.tikzName ?? this.defId;
      this.ctx.appendLine(
        `\\draw ${formatCoord(this.startPoint)} to[${tikzName}] ${formatCoord(gridPt)};`
      );
      this.startPoint = null;
      this.hoverPoint = null;
      this.ctx.ghost.setGhostElement(null);
    }
  }

  onMouseMove(gridPt: GridPoint, _e: MouseEvent): void {
    if (!this.startPoint) return;
    if (pointsEqual(this.startPoint, gridPt)) {
      this.hoverPoint = null;
      this.ctx.ghost.setGhostElement(null);
      return;
    }
    const changed = !this.hoverPoint || !pointsEqual(this.hoverPoint, gridPt);
    this.hoverPoint = gridPt;
    if (changed) {
      const ghost = this.ctx.ghost.buildBipoleGhost(this.defId, this.startPoint, gridPt, false);
      this.ctx.ghost.setGhostElement(ghost);
    }
  }

  onMouseUp(_gridPt: GridPoint, _e: MouseEvent): void {}

  deactivate(): void {
    this.startPoint = null;
    this.hoverPoint = null;
    super.deactivate();
  }
}
