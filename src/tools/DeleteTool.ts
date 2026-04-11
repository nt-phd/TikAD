import type { GridPoint } from '../types';
import { BaseTool } from './BaseTool';

export class DeleteTool extends BaseTool {
  private hoveredId: string | null = null;

  onMouseDown(gridPt: GridPoint, e: MouseEvent): void {
    if (e.button !== 0) return;
    const hitId = this.ctx.hitTester.hitTest(gridPt);
    if (hitId) {
      this.ctx.deleteElements([hitId]);
      this.hoveredId = null;
      this.ctx.ghost.renderDeletePreview(null);
    }
  }
  onMouseMove(gridPt: GridPoint, _e: MouseEvent): void {
    const hitId = this.ctx.hitTester.hitTest(gridPt);
    if (hitId === this.hoveredId) return;
    this.hoveredId = hitId;
    this.ctx.ghost.renderDeletePreview(hitId);
  }
  onMouseUp(_gridPt: GridPoint, _e: MouseEvent): void {}

  activate(): void {
    this.hoveredId = null;
    this.ctx.ghost.renderDeletePreview(null);
  }

  deactivate(): void {
    this.hoveredId = null;
    this.ctx.ghost.renderDeletePreview(null);
    super.deactivate();
  }
}
