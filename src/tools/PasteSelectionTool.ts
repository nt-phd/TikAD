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

  private lastGridPt: GridPoint | null = null;

  private renderGhost(gridPt: GridPoint): void {
    this.ctx.ghost.onGhostProbeReady = () => this.renderGhost(gridPt);
    const entries = previewClipboardAt(this.payload, gridPt);
    this.ctx.ghost.setGhostElement(this.ctx.ghost.buildClipboardGhost(entries));
  }

  onBodyChanged(): void {
    this.lastGridPt = null;
    this.ctx.ghost.setGhostElement(null);
  }

  onMouseDown(gridPt: GridPoint, e: MouseEvent): void {
    if (e.button !== 0) return;
    this.ctx.placeClipboard(this.payload, gridPt);
    this.onCommit();
  }

  onMouseMove(gridPt: GridPoint, _e: MouseEvent): void {
    this.lastGridPt = gridPt;
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
