import type { GridPoint } from '../types';
import { BaseTool, type ToolContext, type SnapResult } from './BaseTool';
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

  onMouseDown({ point }: SnapResult, e: MouseEvent): void {
    if (e.button !== 0) return;
    this.ctx.placeClipboard(this.payload, point);
    this.onCommit();
  }

  onMouseMove({ point }: SnapResult, _e: MouseEvent): void {
    this.lastGridPt = point;
    this.renderGhost(point);
  }

  onMouseUp(_snap: SnapResult, _e: MouseEvent): void {}

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.onCancel();
  }

  deactivate(): void {
    super.deactivate();
  }
}
