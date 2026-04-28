import type { GridPoint, BipoleInstance, MonopoleInstance, SourceCoordinateTranslation, WireInstance, DrawPathInstance } from '../types';
import { BaseTool, type SnapResult } from './BaseTool';
import type { SelectionState } from '../model/SelectionState';
import { formatCoord } from '../codegen/CoordFormatter';
import { formatEndpoint } from '../codegen/TikzEndpointFormatter';

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
  private dragDrawPathHandle: { id: string; index: number } | null = null;
  private dragOriginalPositions = new Map<string, {
    start?: GridPoint;
    end?: GridPoint;
    position?: GridPoint;
    points?: GridPoint[];
    pathPoints?: GridPoint[];
    drawPathPositions?: GridPoint[];
    center?: GridPoint;
    control1?: GridPoint;
    control2?: GridPoint;
  }>();
  private dragSingleSnapSelectionId: string | null = null;
  private marqueeBaseSelection = new Set<string>();
  private marqueeMode: 'replace' | 'add' | 'toggle' = 'replace';
  private pendingToggleSelectionId: string | null = null;

  constructor(ctx: import('./BaseTool').ToolContext, selection: SelectionState) {
    super(ctx);
    this.selection = selection;
  }

  private emitSelectionChanged(): void {
    this.ctx.emit({ type: 'selection-changed', selectedIds: this.selection.getSelectedIds(), source: 'canvas' });
  }

  private syncMeasuredGeometryOffsets(): void {
    const offsets = new Map<string, GridPoint>();
    const doc = this.ctx.getDocument();
    for (const [id, orig] of this.dragOriginalPositions) {
      const comp = doc.getComponent(id);
      if (!comp || comp.type === 'bipole' || !orig.position) continue;
      offsets.set(id, {
        x: comp.position.x - orig.position.x,
        y: comp.position.y - orig.position.y,
      });
    }
    this.ctx.ghost.setMeasuredGeometryOffsets(offsets);
  }

  private isToggleModifierActive(e: MouseEvent): boolean {
    return e.ctrlKey || e.metaKey;
  }

  onMouseDown({ point: gridPt }: SnapResult, e: MouseEvent): void {
    if (e.button !== 0) return;
    this.pendingToggleSelectionId = null;
    const hasMultiSelection = this.selection.count > 1;

    const endpointTarget = !hasMultiSelection ? this.findSelectedBipoleEndpoint(gridPt) : null;
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
        this.emitSelectionChanged();
        return;
      }
    }

    const drawingHandleTarget = !hasMultiSelection ? this.findSelectedDrawingHandle(gridPt) : null;
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
        this.emitSelectionChanged();
        return;
      }
    }

    const wireHandleTarget = !hasMultiSelection ? this.findSelectedWireHandle(gridPt) : null;
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
        this.emitSelectionChanged();
        return;
      }
    }

    const drawPathHandleTarget = !hasMultiSelection ? this.findSelectedDrawPathHandle(gridPt) : null;
    if (drawPathHandleTarget) {
      const dp = this.ctx.getDocument().getDrawPath(drawPathHandleTarget.id);
      if (dp) {
        this.isMarqueeSelecting = false;
        this.isDragging = true;
        this.hasDragged = false;
        this.dragStartGrid = gridPt;
        this.dragDelta = { x: 0, y: 0 };
        this.dragBipoleEndpoint = null;
        this.dragDrawingHandle = null;
        this.dragWireHandle = null;
        this.dragDrawPathHandle = drawPathHandleTarget;
        this.dragOriginalPositions.clear();
        this.dragOriginalPositions.set(dp.id, {
          drawPathPositions: dp.positionSequences.map((s) => ({ ...s.point })),
        });
        this.emitSelectionChanged();
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
      const wasSelected = this.selection.isSelected(hitId);
      if (this.isToggleModifierActive(e)) {
        if (!wasSelected) this.selection.addToSelection(hitId);
        else this.pendingToggleSelectionId = hitId;
      } else if (e.shiftKey) {
        if (!wasSelected) this.selection.addToSelection(hitId);
      } else if (!wasSelected) {
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
      this.dragSingleSnapSelectionId = null;
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
        const drawPath = this.ctx.getDocument().getDrawPath(id);
        if (drawPath) {
          this.dragOriginalPositions.set(id, {
            drawPathPositions: drawPath.positionSequences.map((s) => ({ ...s.point })),
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
      this.emitSelectionChanged();
      if (this.selection.getSelectedIds().length === 1) {
        const selectedId = this.selection.getSelectedIds()[0];
        const comp = this.ctx.getDocument().getComponent(selectedId);
        const drawing = this.ctx.getDocument().getDrawing(selectedId);
        if ((comp && (comp.type === 'monopole' || comp.type === 'node')) || drawing?.kind === 'text' || drawing?.kind === 'circle') {
          this.dragSingleSnapSelectionId = selectedId;
        }
      }
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

  onMouseMove({ point: gridPt, ref }: SnapResult, _e: MouseEvent): void {
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
      this.emitSelectionChanged();
      this.ctx.ghost.setGhostElement(this.ctx.ghost.buildMarqueeGhost(this.dragStartGrid, gridPt));
      return;
    }

    if (!this.isDragging || !this.dragStartGrid) return;
    const dx = gridPt.x - this.dragStartGrid.x;
    const dy = gridPt.y - this.dragStartGrid.y;

    this.hasDragged = true;
    this.dragDelta = { x: dx, y: dy };
    const doc = this.ctx.getDocument();
    if (this.dragBipoleEndpoint) {
      const comp = doc.getComponent(this.dragBipoleEndpoint.id);
      const orig = this.dragOriginalPositions.get(this.dragBipoleEndpoint.id);
      if (comp?.type === 'bipole' && orig?.start && orig?.end) {
        if (this.dragBipoleEndpoint.endpoint === 'start') {
          comp.start = { x: gridPt.x, y: gridPt.y };
          comp.end = { ...orig.end };
          comp.startRef = ref;
          comp.startSequence = undefined;
        } else {
          comp.start = { ...orig.start };
          comp.end = { x: gridPt.x, y: gridPt.y };
          comp.endRef = ref;
          comp.endSequence = undefined;
        }
        this.syncMeasuredGeometryOffsets();
        this.emitSelectionChanged();
      }
      return;
    }
    if (this.dragDrawingHandle) {
      const drawing = doc.getDrawing(this.dragDrawingHandle.id);
      const orig = this.dragOriginalPositions.get(this.dragDrawingHandle.id);
      if (drawing && orig) {
        this.ctx.ghost.setTransientPointRef(`drawing:${drawing.id}:${this.dragDrawingHandle.handle}`, ref);
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
        this.syncMeasuredGeometryOffsets();
        this.emitSelectionChanged();
      }
      return;
    }
    if (this.dragWireHandle) {
      const wire = doc.getWire(this.dragWireHandle.id);
      const orig = this.dragOriginalPositions.get(this.dragWireHandle.id);
      if (wire && orig?.points) {
        const sourcePoints = orig.pathPoints && orig.pathPoints.length > 0 ? orig.pathPoints : orig.points;
        const nextPoints = sourcePoints.map((point) => ({ ...point }));
        const originalPoint = sourcePoints[this.dragWireHandle.index];
        if (originalPoint) {
          nextPoints[this.dragWireHandle.index] = { x: gridPt.x, y: gridPt.y };
          const sequenceSource = wire.pathSequences && wire.pathSequences.length === sourcePoints.length
            ? wire.pathSequences
            : sourcePoints.map((point, index, points) => this.singleSequence(
              point,
              index === 0 ? wire.startRef : index === points.length - 1 ? wire.endRef : undefined,
            ));
          const nextSequences = sequenceSource.map((sequence) => ({
            ...sequence,
            point: { ...sequence.point },
            corners: sequence.corners.map((corner) => ({ ...corner, point: { ...corner.point } })),
          }));
          const seq = nextSequences[this.dragWireHandle.index];
          if (seq) {
            seq.point = { x: gridPt.x, y: gridPt.y };
            const lastCorner = seq.corners.length - 1;
            if (lastCorner >= 0) {
              seq.corners[lastCorner] = {
                ...seq.corners[lastCorner],
                kind: ref ? 'reference' : 'absolute',
                point: { x: gridPt.x, y: gridPt.y },
                ref,
              };
            }
            seq.ref = ref;
          }
          wire.pathSequences = nextSequences;
          if (orig.pathPoints && wire.operators && wire.operators.length === orig.pathPoints.length - 1) {
            wire.pathPoints = nextPoints;
            wire.points = this.rebuildExpandedWirePoints(nextPoints, wire.operators);
          } else {
            wire.points = nextPoints;
            wire.pathPoints = nextPoints;
            wire.operators = wire.operators ?? new Array(Math.max(0, nextPoints.length - 1)).fill('--');
          }
          if (this.dragWireHandle.index === 0) wire.startRef = ref;
          if (this.dragWireHandle.index === sourcePoints.length - 1) wire.endRef = ref;
          this.syncMeasuredGeometryOffsets();
          this.emitSelectionChanged();
        }
      }
      return;
    }
    if (this.dragDrawPathHandle) {
      const dp = doc.getDrawPath(this.dragDrawPathHandle.id);
      const orig = this.dragOriginalPositions.get(this.dragDrawPathHandle.id);
      if (dp && orig?.drawPathPositions) {
        const idx = this.dragDrawPathHandle.index;
        const seq = dp.positionSequences[idx];
        const markerKind: 'reference' | 'absolute' = ref ? 'reference' : 'absolute';
        const updatedCorners = seq.corners.map((c, ci) =>
          ci === seq.corners.length - 1 ? { ...c, kind: markerKind, point: gridPt, ref } : c,
        );
        dp.positionSequences[idx] = { ...seq, point: gridPt, corners: updatedCorners, ref };
        if (idx === 0) dp.startRef = ref;
        if (idx === dp.positionSequences.length - 1) dp.endRef = ref;
        dp.points = this.rebuildDrawPathPoints(dp);
        this.syncMeasuredGeometryOffsets();
        this.emitSelectionChanged();
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
        if (this.dragSingleSnapSelectionId === id) {
          (comp as MonopoleInstance).position = { x: gridPt.x, y: gridPt.y };
          (comp as MonopoleInstance).positionSequence = this.singleSequence({ x: gridPt.x, y: gridPt.y }, ref);
        } else {
          (comp as MonopoleInstance).position = { x: orig.position.x + dx, y: orig.position.y + dy };
          (comp as MonopoleInstance).positionSequence = undefined;
        }
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
        const drawPath = doc.getDrawPath(id);
        if (drawPath && orig.drawPathPositions) {
          for (let i = 0; i < drawPath.positionSequences.length; i++) {
            const origPt = orig.drawPathPositions[i];
            if (!origPt) continue;
            const newPt = { x: origPt.x + dx, y: origPt.y + dy };
            const seq = drawPath.positionSequences[i];
            const updatedCorners = seq.corners.map((c, ci) =>
              ci === seq.corners.length - 1 ? { ...c, point: newPt } : c,
            );
            drawPath.positionSequences[i] = { ...seq, point: newPt, corners: updatedCorners };
          }
          drawPath.startRef = undefined;
          drawPath.endRef = undefined;
          drawPath.points = this.rebuildDrawPathPoints(drawPath);
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
              if (orig.position) {
                if (this.dragSingleSnapSelectionId === id) {
                  this.ctx.ghost.setTransientPointRef(`drawing:${drawing.id}:position`, ref);
                }
                drawing.position = this.dragSingleSnapSelectionId === id
                  ? { x: gridPt.x, y: gridPt.y }
                  : { x: orig.position.x + dx, y: orig.position.y + dy };
              }
              break;
            case 'circle':
              if (orig.center) {
                if (this.dragSingleSnapSelectionId === id) {
                  this.ctx.ghost.setTransientPointRef(`drawing:${drawing.id}:center`, ref);
                }
                drawing.center = this.dragSingleSnapSelectionId === id
                  ? { x: gridPt.x, y: gridPt.y }
                  : { x: orig.center.x + dx, y: orig.center.y + dy };
              }
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
    this.syncMeasuredGeometryOffsets();
    this.emitSelectionChanged();
  }

  onMouseUp(snap: SnapResult, _e: MouseEvent): void {
    if (this.isMarqueeSelecting) {
      if (!this.hasDragged) {
        if (this.marqueeMode === 'replace') {
          this.selection.clear();
          this.emitSelectionChanged();
        }
      }
      this.ctx.ghost.setGhostElement(null);
      this.isMarqueeSelecting = false;
      this.hasDragged = false;
      this.dragStartGrid = null;
      this.marqueeBaseSelection.clear();
      this.pendingToggleSelectionId = null;
      return;
    }

    if (!this.hasDragged && this.pendingToggleSelectionId) {
      this.selection.deselect(this.pendingToggleSelectionId);
      this.emitSelectionChanged();
    }

    if (this.hasDragged) {
      if (this.tryCommitStructuredSelection(snap)) {
        this.resetDragState();
        return;
      }
      const sourceTranslations = this.buildSourceTranslations(snap);
      if (sourceTranslations.length > 0) {
        this.ctx.emit({ type: 'document-changed', sourceTranslations });
      } else {
        this.ctx.emit({ type: 'document-changed' });
      }
    }
    this.resetDragState();
  }

  private tryCommitStructuredSelection(finalSnap: SnapResult): boolean {
    const doc = this.ctx.getDocument();

    if (this.dragBipoleEndpoint) {
      const comp = doc.getComponent(this.dragBipoleEndpoint.id);
      const statement = this.ctx.getEditableStatementModel(this.dragBipoleEndpoint.id);
      if (comp?.type !== 'bipole' || !statement || statement.command === 'node') return false;
      statement.positionTexts = [
        formatEndpoint(comp.start, comp.startRef),
        formatEndpoint(comp.end, comp.endRef),
      ];
      this.ctx.applyEditableStatement(statement);
      return true;
    }

    if (this.dragWireHandle) {
      const wire = doc.getWire(this.dragWireHandle.id);
      const statement = this.ctx.getEditableStatementModel(this.dragWireHandle.id);
      if (!wire || !statement || statement.command === 'node') return false;
      const points = wire.pathPoints && wire.pathPoints.length > 0 ? wire.pathPoints : wire.points;
      if (points.length === 0) return false;
      statement.positionTexts = points.map((point, index) =>
        formatEndpoint(point, wire.pathSequences?.[index]?.ref ?? (
          index === 0 ? wire.startRef : index === points.length - 1 ? wire.endRef : undefined
        )),
      );
      this.ctx.applyEditableStatement(statement);
      return true;
    }

    if (this.dragDrawPathHandle) {
      const dp = doc.getDrawPath(this.dragDrawPathHandle.id);
      const statement = this.ctx.getEditableStatementModel(this.dragDrawPathHandle.id);
      if (!dp || !statement || statement.command === 'node') return false;
      statement.positionTexts = dp.positionSequences.map((sequence, index) =>
        formatEndpoint(
          sequence.point,
          sequence.ref ?? (index === 0 ? dp.startRef : index === dp.positionSequences.length - 1 ? dp.endRef : undefined),
        ),
      );
      this.ctx.applyEditableStatement(statement);
      return true;
    }

    if (this.dragDrawingHandle) {
      const drawing = doc.getDrawing(this.dragDrawingHandle.id);
      const statement = this.ctx.getEditableStatementModel(this.dragDrawingHandle.id);
      if (!drawing || !statement) return false;
      switch (drawing.kind) {
        case 'text':
          if (statement.command !== 'node') return false;
          statement.positionTexts = [formatEndpoint(drawing.position, finalSnap.ref)];
          const nodeSegment = statement.segments.find((segment) => segment.kind === 'node');
          if (nodeSegment && nodeSegment.kind === 'node') {
            nodeSegment.positionText = statement.positionTexts[0];
          }
          this.ctx.applyEditableStatement(statement);
          return true;
        case 'line':
        case 'arrow':
        case 'rectangle':
          statement.positionTexts = [formatCoord(drawing.start), formatCoord(drawing.end)];
          this.ctx.applyEditableStatement(statement);
          return true;
        case 'circle':
          statement.positionTexts = [formatCoord(drawing.center)];
          this.ctx.applyEditableStatement(statement);
          return true;
        case 'bezier':
          statement.positionTexts = [
            formatCoord(drawing.start),
            formatCoord(drawing.control1),
            formatCoord(drawing.control2),
            formatCoord(drawing.end),
          ];
          this.ctx.applyEditableStatement(statement);
          return true;
      }
    }

    if (!this.dragSingleSnapSelectionId) return false;
    const id = this.dragSingleSnapSelectionId;
    const comp = doc.getComponent(id);
    const drawing = doc.getDrawing(id);
    const statement = this.ctx.getEditableStatementModel(id);
    if (!statement) return false;
    if (comp && (comp.type === 'monopole' || comp.type === 'node')) {
      const nextPositionText = formatEndpoint(comp.position, finalSnap.ref);
      if (statement.command !== 'node') return false;
      statement.positionTexts = [nextPositionText];
      const nodeSegment = statement.segments.find((segment) => segment.kind === 'node');
      if (nodeSegment && nodeSegment.kind === 'node') {
        nodeSegment.positionText = nextPositionText;
      }
      this.ctx.applyEditableStatement(statement);
      return true;
    }
    if (drawing?.kind === 'text') {
      const nextPositionText = formatEndpoint(drawing.position, finalSnap.ref);
      if (statement.command !== 'node') return false;
      statement.positionTexts = [nextPositionText];
      const nodeSegment = statement.segments.find((segment) => segment.kind === 'node');
      if (nodeSegment && nodeSegment.kind === 'node') {
        nodeSegment.positionText = nextPositionText;
      }
      this.ctx.applyEditableStatement(statement);
      return true;
    }
    return false;
  }

  private resetDragState(): void {
    this.isDragging = false;
    this.hasDragged = false;
    this.dragStartGrid = null;
    this.dragDelta = { x: 0, y: 0 };
    this.dragBipoleEndpoint = null;
    this.dragDrawingHandle = null;
    this.dragWireHandle = null;
    this.dragDrawPathHandle = null;
    this.dragSingleSnapSelectionId = null;
    this.pendingToggleSelectionId = null;
    this.dragOriginalPositions.clear();
    this.ctx.ghost.clearTransientPointRefs();
    this.ctx.ghost.clearMeasuredGeometryOffsets();
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

  private findSelectedDrawPathHandle(gridPt: GridPoint): { id: string; index: number } | null {
    const radius = SelectTool.WIRE_HANDLE_HIT_RADIUS;
    for (const id of this.selection.getSelectedIds()) {
      const dp = this.ctx.getDocument().getDrawPath(id);
      if (!dp) continue;
      for (let index = 0; index < dp.positionSequences.length; index++) {
        const pt = dp.positionSequences[index].point;
        if (Math.hypot(gridPt.x - pt.x, gridPt.y - pt.y) <= radius) {
          return { id, index };
        }
      }
    }
    return null;
  }

  private rebuildDrawPathPoints(dp: DrawPathInstance): GridPoint[] {
    if (dp.positionSequences.length === 0) return [];
    const expanded: GridPoint[] = [{ ...dp.positionSequences[0].point }];
    for (let i = 0; i < dp.segments.length; i++) {
      const a = dp.positionSequences[i].point;
      const b = dp.positionSequences[i + 1]?.point;
      if (!b) break;
      const op = dp.segments[i].kind === 'connection' ? (dp.segments[i].operator ?? '--') : '--';
      if (op === '|-') { expanded.push({ x: a.x, y: b.y }); }
      else if (op === '-|') { expanded.push({ x: b.x, y: a.y }); }
      expanded.push({ ...b });
    }
    return expanded;
  }

  private singleSequence(point: GridPoint, ref?: SnapResult['ref']) {
    return {
      corners: [{
        kind: ref ? 'reference' as const : 'absolute' as const,
        point: { ...point },
        ref,
      }],
      point: { ...point },
      ref,
    };
  }

  private buildSourceTranslations(finalSnap?: SnapResult): SourceCoordinateTranslation[] {
    if (!this.dragBipoleEndpoint && !this.dragDrawingHandle && !this.dragWireHandle && !this.dragDrawPathHandle) {
      return this.selection.getSelectedIds().map((id) => {
        const comp = this.ctx.getDocument().getComponent(id);
        const drawing = this.ctx.getDocument().getDrawing(id);
        if (this.dragSingleSnapSelectionId === id) {
          const targetPoint = comp && (comp.type === 'monopole' || comp.type === 'node')
            ? comp.position
            : drawing?.kind === 'text'
              ? drawing.position
              : drawing?.kind === 'circle'
                ? drawing.center
                : undefined;
          if (targetPoint && finalSnap) {
            const orig = this.dragOriginalPositions.get(id);
            const matchPoint = orig?.position ?? orig?.center;
            return {
              id,
              matchPoint,
              targetPoint: { ...targetPoint },
              dx: targetPoint.x - (matchPoint?.x ?? 0),
              dy: targetPoint.y - (matchPoint?.y ?? 0),
            };
          }
        }
        return {
          id,
          dx: this.dragDelta.x,
          dy: this.dragDelta.y,
        };
      });
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
        targetPoint: { ...to },
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
        targetPoint: { ...to },
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
        targetPoint: { ...to },
        dx: to.x - from.x,
        dy: to.y - from.y,
      }];
    }

    if (this.dragDrawPathHandle) {
      const dp = doc.getDrawPath(this.dragDrawPathHandle.id);
      const orig = this.dragOriginalPositions.get(this.dragDrawPathHandle.id);
      if (!dp || !orig?.drawPathPositions) return [];
      const idx = this.dragDrawPathHandle.index;
      const from = orig.drawPathPositions[idx];
      const to = dp.positionSequences[idx]?.point;
      if (!from || !to) return [];
      return [{
        id: dp.id,
        matchPoint: from,
        targetPoint: { ...to },
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
