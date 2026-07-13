import type { ConnectionRef, GridPoint, Rotation } from '../types';
import { BaseTool, type SnapResult } from './BaseTool';
import { formatEndpoint } from '../codegen/TikzEndpointFormatter';

export class PlaceMonopoleTool extends BaseTool {
  private rotation: Rotation = 0;
  private lastGridPt: GridPoint | null = null;
  private lastRef: ConnectionRef | undefined = undefined;

  constructor(ctx: import('./BaseTool').ToolContext, private defId: string) {
    super(ctx);
  }

  onBodyChanged(): void {
    this.rebuildGhost();
  }

  private rebuildGhost(): void {
    if (!this.lastGridPt) return;
    this.ctx.ghost.setGhostElement(this.ctx.ghost.buildMonopoleGhost(this.defId, this.lastGridPt, this.rotation, this.lastRef));
  }

  onMouseDown({ point: gridPt, ref }: SnapResult, e: MouseEvent): void {
    if (e.button !== 0) {
      this.ctx.ghost.setGhostElement(null);
      return;
    }
    const tikzName = this.ctx.getDef(this.defId)?.tikzName ?? this.defId;
    const nodeName = this.ctx.getDocument().nextNodeName();
    this.ctx.appendLine(`\\node[${tikzName}](${nodeName}) at ${formatEndpoint(gridPt, ref)} {};`);
  }

  onMouseMove({ point: gridPt, ref }: SnapResult, _e: MouseEvent): void {
    this.lastGridPt = gridPt;
    this.lastRef = ref;
    const ghost = this.ctx.ghost.buildMonopoleGhost(this.defId, gridPt, this.rotation, ref);
    this.ctx.ghost.setGhostElement(ghost);
  }

  onMouseUp(_snap: SnapResult, _e: MouseEvent): void {}

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'r' || e.key === 'R') {
      this.rotation = ((this.rotation + 90) % 360) as Rotation;
    }
  }

  deactivate(): void {
    this.rotation = 0;
    this.lastGridPt = null;
    this.lastRef = undefined;
    super.deactivate();
  }
}
