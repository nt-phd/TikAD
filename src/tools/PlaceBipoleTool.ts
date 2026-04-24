import type { ConnectionRef, GridPoint } from '../types';
import { BaseTool, type SnapResult } from './BaseTool';
import { pointsEqual } from '../utils/geometry';
import { formatEndpoint } from '../codegen/TikzEndpointFormatter';

function refsEqual(a?: ConnectionRef, b?: ConnectionRef): boolean {
  return a?.nodeName === b?.nodeName && a?.anchor === b?.anchor;
}

export class PlaceBipoleTool extends BaseTool {
  private startPoint: GridPoint | null = null;
  private startRef: ConnectionRef | undefined = undefined;
  private hoverPoint: GridPoint | null = null;
  private hoverRef: ConnectionRef | undefined = undefined;

  constructor(ctx: import('./BaseTool').ToolContext, private defId: string) {
    super(ctx);
  }

  onMouseDown({ point: gridPt, ref }: SnapResult, e: MouseEvent): void {
    if (e.button !== 0) {
      this.startPoint = null;
      this.startRef = undefined;
      this.hoverPoint = null;
      this.hoverRef = undefined;
      this.ctx.ghost.setGhostElement(null);
      return;
    }

    if (!this.startPoint) {
      this.startPoint = gridPt;
      this.startRef = ref;
      this.hoverPoint = null;
      this.hoverRef = undefined;
    } else {
      if (pointsEqual(this.startPoint, gridPt)) return;
      const tikzName = this.ctx.getDef(this.defId)?.tikzName ?? this.defId;
      this.ctx.appendLine(
        `\\draw ${formatEndpoint(this.startPoint, this.startRef)} to[${tikzName}] ${formatEndpoint(gridPt, ref)};`
      );
      this.startPoint = null;
      this.startRef = undefined;
      this.hoverPoint = null;
      this.hoverRef = undefined;
      this.ctx.ghost.setGhostElement(null);
    }
  }

  onBodyChanged(): void {
    this.rebuildGhost();
  }

  private rebuildGhost(): void {
    if (!this.startPoint || !this.hoverPoint) return;
    this.ctx.ghost.setGhostElement(this.ctx.ghost.buildBipoleGhost(
      this.defId,
      this.startPoint,
      this.hoverPoint,
      this.startRef,
      this.hoverRef,
    ));
  }

  onMouseMove({ point: gridPt, ref }: SnapResult, _e: MouseEvent): void {
    if (!this.startPoint) return;
    if (pointsEqual(this.startPoint, gridPt)) {
      this.hoverPoint = null;
      this.hoverRef = undefined;
      this.ctx.ghost.setGhostElement(null);
      return;
    }
    const changed = !this.hoverPoint || !pointsEqual(this.hoverPoint, gridPt) || !refsEqual(this.hoverRef, ref);
    this.hoverPoint = gridPt;
    this.hoverRef = ref;
    if (changed) {
      const ghost = this.ctx.ghost.buildBipoleGhost(this.defId, this.startPoint, gridPt, this.startRef, ref);
      this.ctx.ghost.setGhostElement(ghost);
    }
  }

  onMouseUp(_snap: SnapResult, _e: MouseEvent): void {}

  deactivate(): void {
    this.startPoint = null;
    this.startRef = undefined;
    this.hoverPoint = null;
    this.hoverRef = undefined;
    super.deactivate();
  }
}
