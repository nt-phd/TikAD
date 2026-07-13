import type { GridPoint } from '../types';
import type { GhostRenderer } from '../canvas/GhostRenderer';
import type { HitTester } from '../canvas/HitTester';
import type { ComponentDef } from '../types';
import type { ClipboardPayload } from './SelectionClipboard';
import type { SnapResult } from '../canvas/SnapEngine';
import type { EditableStatement } from '../types';

export type { SnapResult };

export interface ToolContext {
  ghost: GhostRenderer;
  hitTester: HitTester;
  emit: (event: import('../types').AppEvent) => void;
  getDocument: () => import('../model/CircuitDocument').CircuitDocument;
  getDef: (defId: string) => ComponentDef | undefined;
  /** Append a \draw line to the tikzpicture body and trigger a render. */
  appendLine: (line: string) => void;
  /** Delete model elements and their corresponding LaTeX source lines. */
  deleteElements: (ids: string[]) => void;
  placeClipboard: (payload: ClipboardPayload, target: GridPoint) => void;
  getEditableStatementModel: (id: string) => EditableStatement | null;
  applyEditableStatement: (statement: EditableStatement) => void;
  undo: () => void;
  redo: () => void;
}

export class BaseTool {
  constructor(protected ctx: ToolContext) {}

  onMouseDown(_snap: SnapResult, _e: MouseEvent): void {}
  onMouseMove(_snap: SnapResult, _e: MouseEvent): void {}
  onMouseUp(_snap: SnapResult, _e: MouseEvent): void {}
  onKeyDown(_e: KeyboardEvent): void {}
  onBodyChanged(): void {}
  activate(): void {}
  deactivate(): void { this.ctx.ghost.setGhostElement(null); }
}
