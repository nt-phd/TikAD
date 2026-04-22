import type { ConnectionRef, GridPoint } from '../types';
import { BaseTool, type SnapResult } from './BaseTool';
import { pointsEqual } from '../utils/geometry';
import { formatCoord } from '../codegen/CoordFormatter';

function formatEndpoint(point: GridPoint, ref?: ConnectionRef): string {
  if (!ref) return formatCoord(point);
  return ref.anchor === 'reference' ? `(${ref.nodeName})` : `(${ref.nodeName}.${ref.anchor})`;
}

export class PlaceBipoleTool extends BaseTool {
  private startPoint: GridPoint | null = null;
  private startRef: ConnectionRef | undefined = undefined;
  private hoverPoint: GridPoint | null = null;

  constructor(ctx: import('./BaseTool').ToolContext, private defId: string) {
    super(ctx);
  }

  onMouseDown({ point: gridPt, ref }: SnapResult, e: MouseEvent): void {
    if (e.button !== 0) {
      this.startPoint = null;
      this.startRef = undefined;
      this.hoverPoint = null;
      this.ctx.ghost.setGhostElement(null);
      return;
    }

    if (!this.startPoint) {
      this.startPoint = gridPt;
      this.startRef = ref;
      this.hoverPoint = null;
    } else {
      if (pointsEqual(this.startPoint, gridPt)) return;
      const tikzName = this.ctx.getDef(this.defId)?.tikzName ?? this.defId;
      this.ctx.appendLine(
        `\\draw ${formatEndpoint(this.startPoint, this.startRef)} to[${tikzName}] ${formatEndpoint(gridPt, ref)};`
      );
      this.startPoint = null;
      this.startRef = undefined;
      this.hoverPoint = null;
      this.ctx.ghost.setGhostElement(null);
    }
  }

  onBodyChanged(): void {
    this.rebuildGhost();
  }

  private rebuildGhost(): void {
    if (!this.startPoint || !this.hoverPoint) return;
    this.ctx.ghost.onGhostProbeReady = () => this.rebuildGhost();
    this.ctx.ghost.setGhostElement(this.ctx.ghost.buildBipoleGhost(this.defId, this.startPoint, this.hoverPoint, false));
  }

  onMouseMove({ point: gridPt }: SnapResult, _e: MouseEvent): void {
    if (!this.startPoint) return;
    if (pointsEqual(this.startPoint, gridPt)) {
      this.hoverPoint = null;
      this.ctx.ghost.setGhostElement(null);
      return;
    }
    const changed = !this.hoverPoint || !pointsEqual(this.hoverPoint, gridPt);
    this.hoverPoint = gridPt;
    if (changed) {
      this.ctx.ghost.onGhostProbeReady = () => this.rebuildGhost();
      const ghost = this.ctx.ghost.buildBipoleGhost(this.defId, this.startPoint, gridPt, false);
      this.ctx.ghost.setGhostElement(ghost);
    }
  }

  onMouseUp(_snap: SnapResult, _e: MouseEvent): void {}

  deactivate(): void {
    this.startPoint = null;
    this.startRef = undefined;
    this.hoverPoint = null;
    super.deactivate();
  }
}
