import { BaseTool, type SnapResult } from './BaseTool';
import type { SelectionState } from '../model/SelectionState';

const HANDLE_HIT_RADIUS = 0.5;

export class SplitPathTool extends BaseTool {
  private hoveredPathId: string | null = null;

  constructor(ctx: import('./BaseTool').ToolContext, private selection: SelectionState) {
    super(ctx);
  }

  private findSplittableVertex(gridPt: import('../types').GridPoint): { id: string; index: number } | null {
    const [id] = this.selection.getSelectedIds();
    if (!id) return null;
    const dp = this.ctx.getDocument().getDrawPath(id);
    if (!dp || dp.positionSequences.length <= 2) return null;
    // Any vertex but the first is a valid split point. Splitting on the last vertex of an
    // ordinary open path is a no-op (nothing follows it), same as splitting on a plain
    // coordinate that happens to equal the first point — splitDrawPathAtIndex handles that
    // degenerate case on its own. Splitting on a closed path's cycle point opens the cycle.
    for (let index = 1; index < dp.positionSequences.length; index++) {
      const pt = dp.positionSequences[index].point;
      if (Math.hypot(gridPt.x - pt.x, gridPt.y - pt.y) <= HANDLE_HIT_RADIUS) {
        return { id, index };
      }
    }
    return null;
  }

  onMouseDown({ point }: SnapResult, e: MouseEvent): void {
    if (e.button !== 0) return;
    const hit = this.findSplittableVertex(point);
    if (!hit) return;
    const statement = this.ctx.getEditableStatementModel(hit.id);
    if (!statement) return;
    this.ctx.splitDrawPathAt(statement, hit.index);
    this.hoveredPathId = null;
    this.ctx.ghost.renderDeletePreview(null);
  }

  onMouseMove({ point }: SnapResult, _e: MouseEvent): void {
    const hit = this.findSplittableVertex(point);
    const nextHoveredId = hit ? hit.id : null;
    if (nextHoveredId === this.hoveredPathId) return;
    this.hoveredPathId = nextHoveredId;
    this.ctx.ghost.renderDeletePreview(nextHoveredId);
  }

  onMouseUp(_snap: SnapResult, _e: MouseEvent): void {}

  activate(): void {
    this.hoveredPathId = null;
    this.ctx.ghost.renderDeletePreview(null);
  }

  deactivate(): void {
    this.hoveredPathId = null;
    this.ctx.ghost.renderDeletePreview(null);
    super.deactivate();
  }
}
