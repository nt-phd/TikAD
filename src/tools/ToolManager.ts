import type { ToolType, AppEvent, WireRoutingMode } from '../types';
import { BaseTool, type ToolContext } from './BaseTool';
import { SelectTool } from './SelectTool';
import { PlaceBipoleTool } from './PlaceBipoleTool';
import { PlaceMonopoleTool } from './PlaceMonopoleTool';
import { WireTool } from './WireTool';
import { DeleteTool } from './DeleteTool';
import { DrawShapeTool } from './DrawShapeTool';
import { PasteSelectionTool } from './PasteSelectionTool';
import type { LatexCanvas } from '../canvas/LatexCanvas';
import type { SelectionState } from '../model/SelectionState';
import type { ClipboardPayload } from './SelectionClipboard';
import { copySelectionToClipboard } from './SelectionClipboard';

export class ToolManager {
  private currentTool: BaseTool;
  private _currentType: ToolType = 'select';
  private _currentDefId?: string;
  private _wireRoutingMode: WireRoutingMode = 'auto';
  private clipboard: ClipboardPayload | null = null;
  private positionPickMode = false;

  constructor(
    private ctx: ToolContext,
    private canvas: LatexCanvas,
    private selection: SelectionState,
    private emitEvent: (event: AppEvent) => void,
  ) {
    this.currentTool = new SelectTool(ctx, selection);
    this.attachListeners();
  }

  get currentType(): ToolType { return this._currentType; }
  get currentDefId(): string | undefined { return this._currentDefId; }
  get wireRoutingMode(): WireRoutingMode { return this._wireRoutingMode; }

  setTool(type: ToolType, defId?: string): void {
    this.currentTool.deactivate();
    this._currentType = type;
    this._currentDefId = defId;

    this.canvas.setPrimaryPanEnabled(false);
    switch (type) {
      case 'move':
        this.currentTool = new BaseTool(this.ctx);
        this.canvas.setPrimaryPanEnabled(true);
        break;
      case 'select':
        this.currentTool = new SelectTool(this.ctx, this.selection);
        break;
      case 'place-bipole':
        this.currentTool = new PlaceBipoleTool(this.ctx, defId!);
        break;
      case 'place-monopole':
        this.currentTool = new PlaceMonopoleTool(this.ctx, defId!);
        break;
      case 'wire':
        this.currentTool = new WireTool(this.ctx);
        (this.currentTool as WireTool).setRoutingMode(this._wireRoutingMode);
        break;
      case 'delete':
        this.currentTool = new DeleteTool(this.ctx);
        break;
      case 'draw-text':
        this.currentTool = new DrawShapeTool(this.ctx, 'text');
        break;
      case 'draw-rectangle':
        this.currentTool = new DrawShapeTool(this.ctx, 'rectangle');
        break;
      case 'draw-circle':
        this.currentTool = new DrawShapeTool(this.ctx, 'circle');
        break;
      case 'draw-bezier':
        this.currentTool = new DrawShapeTool(this.ctx, 'bezier');
        break;
      case 'paste-selection':
        if (!this.clipboard) {
          this.currentTool = new SelectTool(this.ctx, this.selection);
          this._currentType = 'select';
          break;
        }
        this.currentTool = new PasteSelectionTool(
          this.ctx,
          this.clipboard,
          () => this.setTool('select'),
          () => this.setTool('select'),
        );
        break;
    }

    this.currentTool.activate();
    this.updateCursor();
    this.emitEvent({ type: 'tool-changed', tool: type, defId });
  }

  setWireRoutingMode(mode: WireRoutingMode): void {
    this._wireRoutingMode = mode;
    if (this.currentTool instanceof WireTool) {
      this.currentTool.setRoutingMode(mode);
    }
  }

  setPositionPickMode(enabled: boolean): void {
    if (this.positionPickMode === enabled) return;
    this.positionPickMode = enabled;
    this.updateCursor();
  }

  private updateCursor(): void {
    const overlay = this.canvas.overlaySvg;
    if (this.positionPickMode) {
      overlay.style.cursor = 'crosshair';
      return;
    }
    switch (this._currentType) {
      case 'move':
        overlay.style.cursor = 'grab';
        break;
      case 'select':
      case 'delete':
        overlay.style.cursor = 'default';
        break;
      default:
        overlay.style.cursor = 'crosshair';
        break;
    }
  }

  private attachListeners(): void {
    const el = this.canvas.overlaySvg;

    el.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 1) return;
      if (this.canvas.isCurrentlyPanning) return;
      if (this.positionPickMode) return;
      this.currentTool.onMouseDown(this.canvas.eventToGrid(e), e);
    });

    el.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.canvas.isCurrentlyPanning) return;
      if (this.positionPickMode) return;
      this.currentTool.onMouseMove(this.canvas.eventToGrid(e), e);
    });

    el.addEventListener('mouseup', (e: MouseEvent) => {
      if (this.canvas.isCurrentlyPanning) return;
      if (this.positionPickMode) return;
      this.currentTool.onMouseUp(this.canvas.eventToGrid(e), e);
    });

    el.addEventListener('click', (e: MouseEvent) => {
      if (e.button === 1) return;
      if (this.canvas.isCurrentlyPanning) return;
      if (!this.positionPickMode) return;
      if (!this.canvas.isEventInsideCanvas(e)) return;
      const raw = this.canvas.eventToGrid(e);
      const snapped = this.canvas.snap.snapToGrid(raw);
      this.emitEvent({ type: 'canvas-clicked', gridPt: snapped });
    });

    el.addEventListener('dblclick', (_e: MouseEvent) => {
      if (this.currentTool instanceof WireTool) {
        (this.currentTool as WireTool).finishWire();
      }
    });

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'SELECT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.ctx.undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const doc = this.ctx.getDocument();
        const selectedIds = [
          ...doc.components.map((component) => component.id),
          ...doc.wires.map((wire) => wire.id),
          ...doc.drawings.map((drawing) => drawing.id),
        ];
        this.selection.setSelectedIds(selectedIds);
        this.emitEvent({ type: 'selection-changed', selectedIds, source: 'canvas' });
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'c') {
        const selectedIds = this.selection.getSelectedIds();
        if (selectedIds.length > 0) {
          e.preventDefault();
          this.clipboard = copySelectionToClipboard(this.ctx.getDocument(), selectedIds);
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'x') {
        const selectedIds = this.selection.getSelectedIds();
        if (selectedIds.length > 0) {
          e.preventDefault();
          this.clipboard = copySelectionToClipboard(this.ctx.getDocument(), selectedIds);
          this.ctx.deleteElements(selectedIds);
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'v') {
        if (this.clipboard) {
          e.preventDefault();
          this.setTool('paste-selection');
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedIds = this.selection.getSelectedIds();
        if (selectedIds.length > 0) {
          e.preventDefault();
          this.ctx.deleteElements(selectedIds);
          return;
        }
      }

      this.currentTool.onKeyDown(e);
      if (e.key === 'Escape') this.setTool('select');
    });

    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
