import { BaseTool, type SnapResult } from './BaseTool';

export class DeleteTool extends BaseTool {
  private hoveredId: string | null = null;

  onMouseDown({ point }: SnapResult, e: MouseEvent): void {
    if (e.button !== 0) return;
    const hitId = this.ctx.hitTester.hitTest(point);
    if (hitId) {
      this.ctx.deleteElements([hitId]);
      this.hoveredId = null;
      this.ctx.ghost.renderDeletePreview(null);
    }
  }
  onMouseMove({ point }: SnapResult, _e: MouseEvent): void {
    const hitId = this.ctx.hitTester.hitTest(point);
    if (hitId === this.hoveredId) return;
    this.hoveredId = hitId;
    this.ctx.ghost.renderDeletePreview(hitId);
  }
  onMouseUp(_snap: SnapResult, _e: MouseEvent): void {}

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
