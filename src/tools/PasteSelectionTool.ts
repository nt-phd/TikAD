import type { GridPoint } from '../types';
import { BaseTool, type ToolContext } from './BaseTool';
import type { ClipboardPayload } from './SelectionClipboard';
import { previewClipboardAt } from './SelectionClipboard';

export class PasteSelectionTool extends BaseTool {
  constructor(
    ctx: ToolContext,
    private payload: ClipboardPayload,
    private onCommit: () => void,
    private onCancel: () => void,
  ) {
    super(ctx);
  }

  private renderGhost(gridPt: GridPoint): void {
    const entries = previewClipboardAt(this.payload, gridPt);
    this.ctx.ghost.setGhostElement(this.ctx.ghost.buildClipboardGhost(entries));
  }

  onMouseDown(gridPt: GridPoint, e: MouseEvent): void {
    if (e.button !== 0) return;
    this.ctx.placeClipboard(this.payload, gridPt);
    this.onCommit();
  }

  onMouseMove(gridPt: GridPoint, _e: MouseEvent): void {
    this.renderGhost(gridPt);
  }

  onMouseUp(_gridPt: GridPoint, _e: MouseEvent): void {}

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.onCancel();
  }

  deactivate(): void {
    super.deactivate();
  }
}
