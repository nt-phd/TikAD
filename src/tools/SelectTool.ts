import type { GridPoint, BipoleInstance, MonopoleInstance, SourceCoordinateTranslation, WireInstance } from '../types';
import { BaseTool } from './BaseTool';
import type { SelectionState } from '../model/SelectionState';

export class SelectTool extends BaseTool {
  private static readonly BIPOLE_ENDPOINT_HIT_RADIUS = 0.5;
  private static readonly DRAWING_HANDLE_HIT_RADIUS = 0.5;
  private static readonly WIRE_HANDLE_HIT_RADIUS = 0.5;
  private selection: SelectionState;
  private isDragging = false;
  private isMarqueeSelecting = false;
  private hasDragged = false;
  private dragStartGrid: GridPoint | null = null;
  private dragDelta: GridPoint = { x: 0, y: 0 };
  private dragBipoleEndpoint: { id: string; endpoint: 'start' | 'end' } | null = null;
  private dragDrawingHandle: { id: string; handle: 'start' | 'end' | 'position' | 'center' | 'control1' | 'control2' } | null = null;
  private dragWireHandle: { id: string; index: number } | null = null;
  private dragOriginalPositions = new Map<string, {
    start?: GridPoint;
    end?: GridPoint;
    position?: GridPoint;
    points?: GridPoint[];
    pathPoints?: GridPoint[];
    center?: GridPoint;
    control1?: GridPoint;
    control2?: GridPoint;
  }>();
  private marqueeBaseSelection = new Set<string>();
  private marqueeMode: 'replace' | 'add' | 'toggle' = 'replace';

  constructor(ctx: import('./BaseTool').ToolContext, selection: SelectionState) {
    super(ctx);
    this.selection = selection;
  }

  onMouseDown(gridPt: GridPoint, e: MouseEvent): void {
    if (e.button !== 0) return;

    const endpointTarget = this.findSelectedBipoleEndpoint(gridPt);
    if (endpointTarget) {
      const hitComp = this.ctx.getDocument().getComponent(endpointTarget.id);
      if (hitComp?.type === 'bipole') {
        this.isMarqueeSelecting = false;
        this.isDragging = true;
        this.hasDragged = false;
        this.dragStartGrid = gridPt;
        this.dragDelta = { x: 0, y: 0 };
        this.dragBipoleEndpoint = endpointTarget;
        this.dragDrawingHandle = null;
        this.dragOriginalPositions.clear();
        this.dragOriginalPositions.set(endpointTarget.id, { start: { ...hitComp.start }, end: { ...hitComp.end } });
        this.ctx.emit({ type: 'selection-changed', selectedIds: this.selection.getSelectedIds(), source: 'canvas' });
        return;
      }
    }

    const drawingHandleTarget = this.findSelectedDrawingHandle(gridPt);
    if (drawingHandleTarget) {
      const drawing = this.ctx.getDocument().getDrawing(drawingHandleTarget.id);
      if (drawing) {
        this.isMarqueeSelecting = false;
        this.isDragging = true;
        this.hasDragged = false;
        this.dragStartGrid = gridPt;
        this.dragDelta = { x: 0, y: 0 };
        this.dragBipoleEndpoint = null;
        this.dragDrawingHandle = drawingHandleTarget;
        this.dragWireHandle = null;
        this.dragOriginalPositions.clear();
        switch (drawing.kind) {
          case 'line':
          case 'arrow':
          case 'rectangle':
            this.dragOriginalPositions.set(drawing.id, { start: { ...drawing.start }, end: { ...drawing.end } });
            break;
          case 'text':
            this.dragOriginalPositions.set(drawing.id, { position: { ...drawing.position } });
            break;
          case 'circle':
            this.dragOriginalPositions.set(drawing.id, { center: { ...drawing.center } });
            break;
          case 'bezier':
            this.dragOriginalPositions.set(drawing.id, {
              start: { ...drawing.start },
              end: { ...drawing.end },
              control1: { ...drawing.control1 },
              control2: { ...drawing.control2 },
            });
            break;
        }
        this.ctx.emit({ type: 'selection-changed', selectedIds: this.selection.getSelectedIds(), source: 'canvas' });
        return;
      }
    }

    const wireHandleTarget = this.findSelectedWireHandle(gridPt);
    if (wireHandleTarget) {
      const wire = this.ctx.getDocument().getWire(wireHandleTarget.id);
      if (wire) {
        this.isMarqueeSelecting = false;
        this.isDragging = true;
        this.hasDragged = false;
        this.dragStartGrid = gridPt;
        this.dragDelta = { x: 0, y: 0 };
        this.dragBipoleEndpoint = null;
        this.dragDrawingHandle = null;
        this.dragWireHandle = wireHandleTarget;
        this.dragOriginalPositions.clear();
        this.dragOriginalPositions.set(wire.id, {
          points: wire.points.map((point) => ({ ...point })),
          pathPoints: wire.pathPoints?.map((point) => ({ ...point })),
        });
        this.ctx.emit({ type: 'selection-changed', selectedIds: this.selection.getSelectedIds(), source: 'canvas' });
        return;
      }
    }

    const selectedIds = this.selection.getSelectedIds();
    const selectedHitId = selectedIds.length > 0
      ? this.ctx.hitTester.hitTestAmong(gridPt, new Set(selectedIds))
      : null;
    const hitId = selectedHitId ?? this.ctx.hitTester.hitTest(gridPt);

    if (hitId) {
      this.isMarqueeSelecting = false;
      if (e.shiftKey) {
        this.selection.toggle(hitId);
      } else if (!this.selection.isSelected(hitId)) {
        this.selection.select(hitId);
      }
      this.isDragging = true;
      this.hasDragged = false;
      this.dragStartGrid = gridPt;
      this.dragDelta = { x: 0, y: 0 };
      this.dragBipoleEndpoint = null;
      this.dragDrawingHandle = null;
      this.dragWireHandle = null;

      this.dragOriginalPositions.clear();
      for (const id of this.selection.getSelectedIds()) {
        const comp = this.ctx.getDocument().getComponent(id);
        if (comp) {
          if (comp.type === 'bipole') {
            this.dragOriginalPositions.set(id, { start: { ...comp.start }, end: { ...comp.end } });
          } else if (comp.type === 'monopole' || comp.type === 'node') {
            this.dragOriginalPositions.set(id, { position: { ...comp.position } });
          }
          continue;
        }
        const wire = this.ctx.getDocument().getWire(id);
        if (wire) {
          this.dragOriginalPositions.set(id, {
            points: wire.points.map((point) => ({ ...point })),
            pathPoints: wire.pathPoints?.map((point) => ({ ...point })),
          });
          continue;
        }
        const drawing = this.ctx.getDocument().getDrawing(id);
        if (drawing) {
          switch (drawing.kind) {
            case 'line':
            case 'arrow':
            case 'rectangle':
              this.dragOriginalPositions.set(id, { start: { ...drawing.start }, end: { ...drawing.end } });
              break;
            case 'text':
              this.dragOriginalPositions.set(id, { position: { ...drawing.position } });
              break;
            case 'circle':
              this.dragOriginalPositions.set(id, { center: { ...drawing.center } });
              break;
            case 'bezier':
              this.dragOriginalPositions.set(id, {
                start: { ...drawing.start },
                end: { ...drawing.end },
                control1: { ...drawing.control1 },
                control2: { ...drawing.control2 },
              });
              break;
          }
        }
      }
      this.ctx.emit({ type: 'selection-changed', selectedIds: this.selection.getSelectedIds(), source: 'canvas' });
    } else {
      this.isDragging = false;
      this.isMarqueeSelecting = true;
      this.hasDragged = false;
      this.dragStartGrid = gridPt;
      this.marqueeBaseSelection = new Set(this.selection.getSelectedIds());
      this.marqueeMode = e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'replace';
      this.ctx.ghost.setGhostElement(this.ctx.ghost.buildMarqueeGhost(gridPt, gridPt));
    }
  }

  onMouseMove(gridPt: GridPoint, _e: MouseEvent): void {
    if (this.isMarqueeSelecting && this.dragStartGrid) {
      this.hasDragged = true;
      const hitIds = this.ctx.hitTester.getElementsInRect(this.dragStartGrid, gridPt);
      if (this.marqueeMode === 'replace') {
        this.selection.setSelectedIds(hitIds);
      } else if (this.marqueeMode === 'add') {
        this.selection.setSelectedIds([...new Set([...this.marqueeBaseSelection, ...hitIds])]);
      } else {
        const next = new Set(this.marqueeBaseSelection);
        for (const id of hitIds) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        this.selection.setSelectedIds([...next]);
      }
      this.ctx.emit({ type: 'selection-changed', selectedIds: this.selection.getSelectedIds(), source: 'canvas' });
      this.ctx.ghost.setGhostElement(this.ctx.ghost.buildMarqueeGhost(this.dragStartGrid, gridPt));
      return;
    }

    if (!this.isDragging || !this.dragStartGrid) return;
    const dx = gridPt.x - this.dragStartGrid.x;
    const dy = gridPt.y - this.dragStartGrid.y;
    if (dx === 0 && dy === 0) return;

    this.hasDragged = true;
    this.dragDelta = { x: dx, y: dy };
    const doc = this.ctx.getDocument();
    if (this.dragBipoleEndpoint) {
      const comp = doc.getComponent(this.dragBipoleEndpoint.id);
      const orig = this.dragOriginalPositions.get(this.dragBipoleEndpoint.id);
      if (comp?.type === 'bipole' && orig?.start && orig?.end) {
        const snapped = this.ctx.hitTester.connectionSnapEnabled
          ? this.ctx.hitTester.findNearestConnectionTarget(gridPt, 0.5)
          : null;
        const targetPoint = snapped?.point ?? gridPt;
        if (this.dragBipoleEndpoint.endpoint === 'start') {
          comp.start = { x: targetPoint.x, y: targetPoint.y };
          comp.end = { ...orig.end };
          comp.startRef = snapped?.ref;
          comp.startSequence = undefined;
        } else {
          comp.start = { ...orig.start };
          comp.end = { x: targetPoint.x, y: targetPoint.y };
          comp.endRef = snapped?.ref;
          comp.endSequence = undefined;
        }
        // Drop sequences on all other selected bipoles so the ghost uses
        // raw coordinates instead of stale node-reference positions.
        for (const id of this.selection.getSelectedIds()) {
          if (id === this.dragBipoleEndpoint.id) continue;
          const other = doc.getComponent(id);
          if (other?.type === 'bipole') {
            (other as BipoleInstance).startSequence = undefined;
            (other as BipoleInstance).endSequence = undefined;
          }
        }
        this.ctx.emit({ type: 'selection-changed', selectedIds: this.selection.getSelectedIds(), source: 'canvas' });
      }
      return;
    }
    if (this.dragDrawingHandle) {
      const drawing = doc.getDrawing(this.dragDrawingHandle.id);
      const orig = this.dragOriginalPositions.get(this.dragDrawingHandle.id);
      if (drawing && orig) {
        switch (drawing.kind) {
          case 'line':
          case 'arrow':
          case 'rectangle':
            if (this.dragDrawingHandle.handle === 'start' && orig.start) {
              drawing.start = { x: orig.start.x + dx, y: orig.start.y + dy };
            } else if (this.dragDrawingHandle.handle === 'end' && orig.end) {
              drawing.end = { x: orig.end.x + dx, y: orig.end.y + dy };
            }
            break;
          case 'text':
            if (this.dragDrawingHandle.handle === 'position' && orig.position) {
              drawing.position = { x: orig.position.x + dx, y: orig.position.y + dy };
            }
            break;
          case 'circle':
            if (this.dragDrawingHandle.handle === 'center' && orig.center) {
              drawing.center = { x: orig.center.x + dx, y: orig.center.y + dy };
            }
            break;
          case 'bezier':
            if (this.dragDrawingHandle.handle === 'start' && orig.start) {
              drawing.start = { x: orig.start.x + dx, y: orig.start.y + dy };
            } else if (this.dragDrawingHandle.handle === 'end' && orig.end) {
              drawing.end = { x: orig.end.x + dx, y: orig.end.y + dy };
            } else if (this.dragDrawingHandle.handle === 'control1' && orig.control1) {
              drawing.control1 = { x: orig.control1.x + dx, y: orig.control1.y + dy };
            } else if (this.dragDrawingHandle.handle === 'control2' && orig.control2) {
              drawing.control2 = { x: orig.control2.x + dx, y: orig.control2.y + dy };
            }
            break;
        }
        this.ctx.emit({ type: 'selection-changed', selectedIds: this.selection.getSelectedIds(), source: 'canvas' });
      }
      return;
    }
    if (this.dragWireHandle) {
      const wire = doc.getWire(this.dragWireHandle.id);
      const orig = this.dragOriginalPositions.get(this.dragWireHandle.id);
      if (wire && orig?.points) {
        const snapped = this.ctx.hitTester.connectionSnapEnabled
          ? this.ctx.hitTester.findNearestConnectionTarget(gridPt, 0.5)
          : null;
        const targetPoint = snapped?.point ?? gridPt;
        const sourcePoints = orig.pathPoints && orig.pathPoints.length > 0 ? orig.pathPoints : orig.points;
        const nextPoints = sourcePoints.map((point) => ({ ...point }));
        const originalPoint = sourcePoints[this.dragWireHandle.index];
        if (originalPoint) {
          nextPoints[this.dragWireHandle.index] = { x: targetPoint.x, y: targetPoint.y };
          if (orig.pathPoints && wire.operators && wire.operators.length === orig.pathPoints.length - 1) {
            wire.pathPoints = nextPoints;
            wire.points = this.rebuildExpandedWirePoints(nextPoints, wire.operators);
          } else {
            wire.points = nextPoints;
            wire.pathPoints = undefined;
            wire.operators = undefined;
          }
          wire.pathSequences = undefined;
          if (this.dragWireHandle.index === 0) wire.startRef = snapped?.ref;
          if (this.dragWireHandle.index === sourcePoints.length - 1) wire.endRef = snapped?.ref;
          this.ctx.emit({ type: 'selection-changed', selectedIds: this.selection.getSelectedIds(), source: 'canvas' });
        }
      }
      return;
    }
    for (const [id, orig] of this.dragOriginalPositions) {
      const comp = doc.getComponent(id);
      if (comp && comp.type === 'bipole' && orig.start && orig.end) {
        (comp as BipoleInstance).start = { x: orig.start.x + dx, y: orig.start.y + dy };
        (comp as BipoleInstance).end   = { x: orig.end.x   + dx, y: orig.end.y   + dy };
        (comp as BipoleInstance).startRef = undefined;
        (comp as BipoleInstance).endRef = undefined;
        (comp as BipoleInstance).startSequence = undefined;
        (comp as BipoleInstance).endSequence = undefined;
      } else if (comp && (comp.type === 'monopole' || comp.type === 'node') && orig.position) {
        (comp as MonopoleInstance).position = { x: orig.position.x + dx, y: orig.position.y + dy };
        // Drop positionSequence during drag so the ghost uses the raw position
        // instead of stale relative/reference corner data.
        (comp as MonopoleInstance).positionSequence = undefined;
      } else {
        const wire = doc.getWire(id);
        if (wire && orig.points) {
          (wire as WireInstance).points = orig.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
          if (orig.pathPoints) {
            (wire as WireInstance).pathPoints = orig.pathPoints.map((point) => ({ x: point.x + dx, y: point.y + dy }));
          }
          (wire as WireInstance).pathSequences = undefined;
          continue;
        }
        const drawing = doc.getDrawing(id);
        if (drawing) {
          switch (drawing.kind) {
            case 'line':
            case 'arrow':
            case 'rectangle':
              if (orig.start && orig.end) {
                drawing.start = { x: orig.start.x + dx, y: orig.start.y + dy };
                drawing.end = { x: orig.end.x + dx, y: orig.end.y + dy };
              }
              break;
            case 'text':
              if (orig.position) drawing.position = { x: orig.position.x + dx, y: orig.position.y + dy };
              break;
            case 'circle':
              if (orig.center) drawing.center = { x: orig.center.x + dx, y: orig.center.y + dy };
              break;
            case 'bezier':
              if (orig.start && orig.end && orig.control1 && orig.control2) {
                drawing.start = { x: orig.start.x + dx, y: orig.start.y + dy };
                drawing.end = { x: orig.end.x + dx, y: orig.end.y + dy };
                drawing.control1 = { x: orig.control1.x + dx, y: orig.control1.y + dy };
                drawing.control2 = { x: orig.control2.x + dx, y: orig.control2.y + dy };
              }
              break;
          }
        }
      }
    }
    // Only refresh overlay during drag, not a full recompile
    this.ctx.emit({ type: 'selection-changed', selectedIds: this.selection.getSelectedIds(), source: 'canvas' });
  }

  onMouseUp(_gridPt: GridPoint, _e: MouseEvent): void {
    if (this.isMarqueeSelecting) {
      if (!this.hasDragged) {
        if (this.marqueeMode === 'replace') {
          this.selection.clear();
          this.ctx.emit({ type: 'selection-changed', selectedIds: [], source: 'canvas' });
        }
      }
      this.ctx.ghost.setGhostElement(null);
      this.isMarqueeSelecting = false;
      this.hasDragged = false;
      this.dragStartGrid = null;
      this.marqueeBaseSelection.clear();
      return;
    }

    if (this.hasDragged) {
      const sourceTranslations = this.buildSourceTranslations();
      if (sourceTranslations.length > 0) {
        this.ctx.emit({ type: 'document-changed', sourceTranslations });
      } else {
        this.ctx.emit({ type: 'document-changed' });
      }
    }
    this.isDragging = false;
    this.hasDragged = false;
    this.dragStartGrid = null;
    this.dragDelta = { x: 0, y: 0 };
    this.dragBipoleEndpoint = null;
    this.dragDrawingHandle = null;
    this.dragWireHandle = null;
    this.dragOriginalPositions.clear();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.ctx.deleteElements(this.selection.getSelectedIds());
    }
  }

  private getHitBipoleEndpoint(gridPt: GridPoint, comp: BipoleInstance): 'start' | 'end' | null {
    const startDist = Math.hypot(gridPt.x - comp.start.x, gridPt.y - comp.start.y);
    const endDist = Math.hypot(gridPt.x - comp.end.x, gridPt.y - comp.end.y);
    const radius = SelectTool.BIPOLE_ENDPOINT_HIT_RADIUS;
    if (startDist > radius && endDist > radius) return null;
    return startDist <= endDist ? 'start' : 'end';
  }

  private findSelectedBipoleEndpoint(gridPt: GridPoint): { id: string; endpoint: 'start' | 'end' } | null {
    for (const id of this.selection.getSelectedIds()) {
      const comp = this.ctx.getDocument().getComponent(id);
      if (comp?.type !== 'bipole') continue;
      const endpoint = this.getHitBipoleEndpoint(gridPt, comp);
      if (endpoint) return { id, endpoint };
    }
    return null;
  }

  private findSelectedDrawingHandle(gridPt: GridPoint): { id: string; handle: 'start' | 'end' | 'position' | 'center' | 'control1' | 'control2' } | null {
    const radius = SelectTool.DRAWING_HANDLE_HIT_RADIUS;
    for (const id of this.selection.getSelectedIds()) {
      const drawing = this.ctx.getDocument().getDrawing(id);
      if (!drawing) continue;
      const hit = (point: GridPoint) => Math.hypot(gridPt.x - point.x, gridPt.y - point.y) <= radius;
      switch (drawing.kind) {
        case 'line':
        case 'arrow':
        case 'rectangle':
          if (hit(drawing.start)) return { id, handle: 'start' };
          if (hit(drawing.end)) return { id, handle: 'end' };
          break;
        case 'text':
          if (hit(drawing.position)) return { id, handle: 'position' };
          break;
        case 'circle':
          if (hit(drawing.center)) return { id, handle: 'center' };
          break;
        case 'bezier':
          if (hit(drawing.start)) return { id, handle: 'start' };
          if (hit(drawing.control1)) return { id, handle: 'control1' };
          if (hit(drawing.control2)) return { id, handle: 'control2' };
          if (hit(drawing.end)) return { id, handle: 'end' };
          break;
      }
    }
    return null;
  }

  private rebuildExpandedWirePoints(pathPoints: GridPoint[], operators?: Array<'--' | '|-' | '-|'>): GridPoint[] {
    if (pathPoints.length === 0) return [];
    if (!operators || operators.length !== pathPoints.length - 1) {
      return pathPoints.map((point) => ({ ...point }));
    }
    const expanded: GridPoint[] = [{ ...pathPoints[0] }];
    for (let i = 0; i < operators.length; i++) {
      const a = pathPoints[i];
      const b = pathPoints[i + 1];
      const op = operators[i];
      if (op === '--') {
        expanded.push({ ...b });
      } else if (op === '|-') {
        expanded.push({ x: a.x, y: b.y });
        expanded.push({ ...b });
      } else {
        expanded.push({ x: b.x, y: a.y });
        expanded.push({ ...b });
      }
    }
    return expanded;
  }

  private findSelectedWireHandle(gridPt: GridPoint): { id: string; index: number } | null {
    const radius = SelectTool.WIRE_HANDLE_HIT_RADIUS;
    for (const id of this.selection.getSelectedIds()) {
      const wire = this.ctx.getDocument().getWire(id);
      if (!wire) continue;
      const handlePoints = wire.pathPoints && wire.pathPoints.length > 0 ? wire.pathPoints : wire.points;
      for (let index = 0; index < handlePoints.length; index++) {
        const point = handlePoints[index];
        if (Math.hypot(gridPt.x - point.x, gridPt.y - point.y) <= radius) {
          return { id, index };
        }
      }
    }
    return null;
  }

  private buildSourceTranslations(): SourceCoordinateTranslation[] {
    if (!this.dragBipoleEndpoint && !this.dragDrawingHandle && !this.dragWireHandle) {
      return this.selection.getSelectedIds().map((id) => ({
        id,
        dx: this.dragDelta.x,
        dy: this.dragDelta.y,
      }));
    }

    const doc = this.ctx.getDocument();

    if (this.dragBipoleEndpoint) {
      const comp = doc.getComponent(this.dragBipoleEndpoint.id);
      const orig = this.dragOriginalPositions.get(this.dragBipoleEndpoint.id);
      if (comp?.type !== 'bipole' || !orig?.start || !orig.end) return [];
      const from = this.dragBipoleEndpoint.endpoint === 'start' ? orig.start : orig.end;
      const to = this.dragBipoleEndpoint.endpoint === 'start' ? comp.start : comp.end;
      return [{
        id: comp.id,
        matchPoint: from,
        dx: to.x - from.x,
        dy: to.y - from.y,
      }];
    }

    if (this.dragDrawingHandle) {
      const drawing = doc.getDrawing(this.dragDrawingHandle.id);
      const orig = this.dragOriginalPositions.get(this.dragDrawingHandle.id);
      if (!drawing || !orig) return [];
      const from = this.getDrawingHandlePoint(drawing.kind, this.dragDrawingHandle.handle, orig);
      const to = this.getDrawingHandlePoint(drawing.kind, this.dragDrawingHandle.handle, drawing);
      if (!from || !to) return [];
      return [{
        id: drawing.id,
        matchPoint: from,
        dx: to.x - from.x,
        dy: to.y - from.y,
      }];
    }

    if (this.dragWireHandle) {
      const wire = doc.getWire(this.dragWireHandle.id);
      const orig = this.dragOriginalPositions.get(this.dragWireHandle.id);
      if (!wire || !orig?.points) return [];
      const sourcePoints = orig.pathPoints && orig.pathPoints.length > 0 ? orig.pathPoints : orig.points;
      const currentPoints = wire.pathPoints && wire.pathPoints.length > 0 ? wire.pathPoints : wire.points;
      const from = sourcePoints[this.dragWireHandle.index];
      const to = currentPoints[this.dragWireHandle.index];
      if (!from || !to) return [];
      return [{
        id: wire.id,
        matchPoint: from,
        dx: to.x - from.x,
        dy: to.y - from.y,
      }];
    }

    return [];
  }

  private getDrawingHandlePoint(
    kind: 'line' | 'arrow' | 'text' | 'rectangle' | 'circle' | 'bezier',
    handle: 'start' | 'end' | 'position' | 'center' | 'control1' | 'control2',
    source: {
      start?: GridPoint;
      end?: GridPoint;
      position?: GridPoint;
      center?: GridPoint;
      control1?: GridPoint;
      control2?: GridPoint;
    },
  ): GridPoint | null {
    switch (kind) {
      case 'line':
      case 'arrow':
      case 'rectangle':
        return handle === 'start' ? source.start ?? null : handle === 'end' ? source.end ?? null : null;
      case 'text':
        return handle === 'position' ? source.position ?? null : null;
      case 'circle':
        return handle === 'center' ? source.center ?? null : null;
      case 'bezier':
        if (handle === 'start') return source.start ?? null;
        if (handle === 'end') return source.end ?? null;
        if (handle === 'control1') return source.control1 ?? null;
        if (handle === 'control2') return source.control2 ?? null;
        return null;
    }
  }
}
