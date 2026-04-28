/**
 * Renders ghost (placement preview) and selection indicators on the overlay SVG.
 * Uses scaleState.effectiveGridSize so coordinates stay aligned with the
 * pdflatex-rendered SVG regardless of \begin{tikzpicture}[scale=...].
 */
import type {
  GridPoint,
  BipoleInstance,
  ComponentDef,
  DrawingInstance,
  DrawPathInstance,
  ConnectionRef,
  PositionSequencePreview,
  RenderComponentBounds,
  RenderSymbolPointGroup,
} from '../types';
import type { ComponentRegistry } from '../definitions/ComponentRegistry';
import type { SelectionState } from '../model/SelectionState';
import type { CircuitDocument } from '../model/CircuitDocument';
import { SELECTION_COLOR } from '../constants';
import { scaleState } from './ScaleState';
import { createCircle, createGroup, createLine, createRect } from '../utils/svg';
import { getBipoleBodyMetrics, getPlacedComponentMetrics } from './ComponentGeometry';
import type { ClipboardEntry } from '../tools/SelectionClipboard';
import { formatConnectionRef } from '../codegen/TikzEndpointFormatter';

const OVERLAY_MARKER_COLOR = SELECTION_COLOR;
const OVERLAY_STROKE_COLOR = SELECTION_COLOR;
const OVERLAY_STROKE_WIDTH = 0.5;
const OVERLAY_FILL_OPACITY = 0.2;
const SELECTION_LINE_OPACITY = 1;
const GHOST_LINE_OPACITY = 0.5;
const CONNECTION_LINE_OPACITY = 0.5;
const OVERLAY_MARKER_RADIUS = 0.1;
const DELETE_PREVIEW_COLOR = '#d32f2f';

export interface GhostLatexPreview {
  anchorX: number;
  anchorY: number;
  angleDeg?: number;
  opacity: number;
  svgMarkup: string;
  tx: number;
  ty: number;
}

export class GhostRenderer {
  private ghostGroup: SVGGElement;
  private deletePreviewGroup: SVGGElement;
  private selectionGroup: SVGGElement;
  private snapPreviewGroup: SVGGElement;
  private hoverGroup: SVGGElement;
  private transientPointRefs = new Map<string, ConnectionRef | undefined>();

  constructor(
    private overlaySvg: SVGSVGElement,
    private doc: CircuitDocument,
    private registry: ComponentRegistry,
    private selection: SelectionState,
    private setLatexGhostPreview: (preview: GhostLatexPreview | null) => void,
  ) {
    this.ghostGroup = createGroup('ghost');
    this.deletePreviewGroup = createGroup('delete-preview');
    this.selectionGroup = createGroup('selection');
    this.snapPreviewGroup = createGroup('snap-preview');
    this.hoverGroup = createGroup('hover');
    this.overlaySvg.appendChild(this.selectionGroup);
    this.overlaySvg.appendChild(this.deletePreviewGroup);
    this.overlaySvg.appendChild(this.ghostGroup);
    this.overlaySvg.appendChild(this.snapPreviewGroup);
    this.overlaySvg.appendChild(this.hoverGroup);
  }

  private get gs(): number { return scaleState.effectiveGridSize; }

  // ====== GHOST ======

  setGhostElement(el: SVGElement | null): void {
    this.ghostGroup.innerHTML = '';
    if (!el) this.setLatexGhostPreview(null);
    if (el) this.ghostGroup.appendChild(el);
    this.dedupePinMarkers();
  }

  setTransientPointRef(key: string, ref?: ConnectionRef): void {
    if (ref) this.transientPointRefs.set(key, ref);
    else this.transientPointRefs.delete(key);
  }

  clearTransientPointRefs(): void {
    this.transientPointRefs.clear();
  }

  setSnapPreview(point?: GridPoint, ref?: ConnectionRef): void {
    this.snapPreviewGroup.innerHTML = '';
    if (!point || !ref) return;
    const gs = this.gs;
    const g = createGroup('snap-preview-marker');
    const x = point.x * gs;
    const y = point.y * gs;
    const radius = gs * OVERLAY_MARKER_RADIUS;
    g.appendChild(createCircle(x, y, radius * 2.1, {
      fill: SELECTION_COLOR,
      opacity: 0.14,
      stroke: 'none',
      'pointer-events': 'none',
    }));
    g.appendChild(createCircle(x, y, radius * 1.25, {
      fill: SELECTION_COLOR,
      opacity: 0.18,
      stroke: 'none',
      'pointer-events': 'none',
    }));
    g.appendChild(this.ringAt(x, y, radius * 1.35, SELECTION_COLOR, 1));
    g.appendChild(this.ringAt(x, y, radius * 0.8, SELECTION_COLOR, 0.9));
    this.snapPreviewGroup.appendChild(g);
  }

  buildMarqueeGhost(start: GridPoint, end: GridPoint): SVGGElement {
    this.setLatexGhostPreview(null);
    const gs = this.gs;
    const x1 = start.x * gs;
    const y1 = start.y * gs;
    const x2 = end.x * gs;
    const y2 = end.y * gs;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    const g = createGroup('ghost-marquee');
    g.appendChild(createRect(left, top, width, height, {
      fill: SELECTION_COLOR,
      opacity: OVERLAY_FILL_OPACITY,
      stroke: SELECTION_COLOR,
      'stroke-width': OVERLAY_STROKE_WIDTH,
      'stroke-dasharray': '4 3',
      'vector-effect': 'non-scaling-stroke',
    }));
    return g;
  }

  buildBipoleGhost(
    defId: string,
    start: GridPoint,
    end: GridPoint,
    startRef?: ConnectionRef,
    endRef?: ConnectionRef,
  ): SVGGElement | null {
    const gs = this.gs;
    const sx = start.x * gs, sy = start.y * gs;
    const ex = end.x   * gs, ey = end.y   * gs;
    const def = this.registry.get(defId);
    const g = createGroup('ghost-bipole');
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.hypot(dx, dy);
    const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    if (def) {
      this.setLatexGhostPreview(null);
      const { bodyWidth, bodyHeight, bodyX, bodyY } = getBipoleBodyMetrics(def, gs, dist);
      const body = createGroup('ghost-bipole-body');
      body.setAttribute('transform', `translate(${sx}, ${sy}) rotate(${angleDeg})`);
      body.appendChild(createRect(bodyX, bodyY, bodyWidth, bodyHeight, {
        fill: SELECTION_COLOR,
        opacity: OVERLAY_FILL_OPACITY,
      }));
      g.appendChild(body);
    }
    g.appendChild(this.createOverlayLine(sx, sy, ex, ey, { opacity: GHOST_LINE_OPACITY }, SELECTION_COLOR));
    g.appendChild(startRef
      ? this.tooltipRingAt(sx, sy, gs * OVERLAY_MARKER_RADIUS, formatConnectionRef(startRef), SELECTION_COLOR, GHOST_LINE_OPACITY)
      : this.crossAt(sx, sy, gs * OVERLAY_MARKER_RADIUS, GHOST_LINE_OPACITY, OVERLAY_MARKER_COLOR));
    g.appendChild(endRef
      ? this.tooltipRingAt(ex, ey, gs * OVERLAY_MARKER_RADIUS, formatConnectionRef(endRef), SELECTION_COLOR, GHOST_LINE_OPACITY)
      : this.crossAt(ex, ey, gs * OVERLAY_MARKER_RADIUS, GHOST_LINE_OPACITY, OVERLAY_MARKER_COLOR));
    return g;
  }

  buildWireGhost(
    points: GridPoint[],
    handlePoints: GridPoint[] = points,
    startRef?: { anchor: string; componentId: string; nodeName: string },
    endRef?: { anchor: string; componentId: string; nodeName: string },
  ): SVGGElement | null {
    this.setLatexGhostPreview(null);
    if (points.length < 2) return null;
    const gs = this.gs;
    const g = createGroup('ghost-wire');
    for (let i = 0; i < handlePoints.length; i++) {
      const p = handlePoints[i];
      const ref = i === 0 ? startRef : i === handlePoints.length - 1 ? endRef : undefined;
      if (ref) {
        g.appendChild(this.tooltipRingAt(p.x * gs, p.y * gs, gs * OVERLAY_MARKER_RADIUS, formatConnectionRef(ref), SELECTION_COLOR, GHOST_LINE_OPACITY));
      } else {
        g.appendChild(this.crossAt(p.x * gs, p.y * gs, gs * OVERLAY_MARKER_RADIUS, GHOST_LINE_OPACITY, OVERLAY_MARKER_COLOR));
      }
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      g.appendChild(this.createOverlayLine(
        a.x * gs, a.y * gs, b.x * gs, b.y * gs,
        { opacity: CONNECTION_LINE_OPACITY },
        SELECTION_COLOR,
      ));
    }
    return g;
  }

  buildMonopoleGhost(defId: string, position: GridPoint, rotation = 0, ref?: ConnectionRef): SVGGElement | null {
    const def = this.registry.get(defId);
    if (!def) return null;
    this.setLatexGhostPreview(null);
    const g = createGroup('ghost-monopole');
    const metrics = getPlacedComponentMetrics(def, 1);
    const body = createGroup('ghost-monopole-body');
    body.setAttribute('transform', `translate(${position.x * this.gs}, ${position.y * this.gs}) rotate(${rotation})`);
    body.appendChild(createRect(
      metrics.leftOffset * this.gs,
      metrics.topOffset * this.gs,
      metrics.width * this.gs,
      metrics.height * this.gs,
      {
        fill: SELECTION_COLOR,
        opacity: OVERLAY_FILL_OPACITY,
      },
    ));
    g.appendChild(body);
    g.appendChild(ref
      ? this.tooltipRingAt(position.x * this.gs, position.y * this.gs, this.gs * OVERLAY_MARKER_RADIUS, formatConnectionRef(ref), SELECTION_COLOR, GHOST_LINE_OPACITY)
      : this.crossAt(position.x * this.gs, position.y * this.gs, this.gs * OVERLAY_MARKER_RADIUS, GHOST_LINE_OPACITY, OVERLAY_MARKER_COLOR));
    return g;
  }

  buildClipboardGhost(entries: ClipboardEntry[]): SVGGElement {
    this.setLatexGhostPreview(null);
    const g = createGroup('ghost-clipboard');
    for (const entry of entries) {
      if (entry.kind === 'component') {
        const def = this.registry.get(entry.item.defId);
        if (!def) continue;
        if (entry.item.type === 'bipole') {
          g.appendChild(this.buildSingleBipoleSelection(entry.item, def, SELECTION_COLOR));
        } else {
          const clipGroup = this.buildPlacedComponentSelection(
            entry.item.position.x,
            entry.item.position.y,
            def,
            entry.item.rotation,
            false,
          );
          if (clipGroup) g.appendChild(clipGroup);
        }
        continue;
      }
      if (entry.kind === 'wire') {
        const wireGroup = this.buildWireSelection(entry.item, SELECTION_COLOR);
        if (wireGroup) g.appendChild(wireGroup);
        continue;
      }
      g.appendChild(this.buildDrawingSelection(entry.item, SELECTION_COLOR));
    }
    return g;
  }

  // ====== SELECTION ======

  renderSelection(): void {
    this.selectionGroup.innerHTML = '';
    for (const id of this.selection.getSelectedIds()) {
      const group = this.buildSingleSelectionGroup(id, SELECTION_COLOR);
      if (group) this.selectionGroup.appendChild(group);
    }
    this.dedupePinMarkers();
  }

  setHoverSequences(sequences: PositionSequencePreview[], cursor: GridPoint, tolerance: number): void {
    this.hoverGroup.innerHTML = '';
    if (sequences.length === 0) {
      this.dedupePinMarkers();
      return;
    }
    for (const sequence of sequences) {
      for (let index = 0; index < sequence.corners.length; index++) {
        const displayPoint = this.resolveDisplayedCornerPoint(sequence, index);
        if (!displayPoint) continue;
        if (Math.abs(displayPoint.x - cursor.x) > tolerance) continue;
        if (Math.abs(displayPoint.y - cursor.y) > tolerance) continue;
        this.hoverGroup.appendChild(this.buildCornerMarker(sequence, index, SELECTION_COLOR, GHOST_LINE_OPACITY));
      }
    }
    this.dedupePinMarkers();
  }



  private buildSingleSelectionGroup(id: string, color: string): SVGGElement | null {
    const comp = this.doc.getComponent(id);
    if (comp) {
      const def = this.registry.get(comp.defId);
      if (!def) return null;
      if (comp.type === 'bipole') {
        return this.buildSingleBipoleSelection(comp, def, color);
      }
      const bodyGroup = this.buildPlacedComponentSelection(
        comp.position.x,
        comp.position.y,
        def,
        comp.rotation,
        false,
        comp.id,
        color,
        true,
      );
      if (!bodyGroup) return null;
      if (comp.positionSequence) {
        const group = createGroup('sel-component-group');
        group.appendChild(bodyGroup);
        this.appendPositionSequencePreview(group, comp.positionSequence, color, 1, true);
        return group;
      }
      return bodyGroup;
    }
    const wire = this.doc.getWire(id);
    if (wire) {
      const extracted = this.extractSelectionSequences(id);
      if (!extracted) return null;
      return this.buildSequenceSelection(extracted.sequences, extracted.operators, color);
    }
    const drawPath = this.doc.getDrawPath(id);
    if (drawPath) return this.buildDrawPathSelection(drawPath, color);
    const drawing = this.doc.getDrawing(id);
    if (drawing) return this.buildDrawingSelection(drawing, color);
    return null;
  }

  private buildWireSelection(wire: { id: string }, color: string): SVGGElement | null {
    const extracted = this.extractSelectionSequences(wire.id);
    if (!extracted) return null;
    return this.buildSequenceSelection(extracted.sequences, extracted.operators, color);
  }

  private extractSelectionSequences(id: string): {
    operators: Array<'--' | '|-' | '-|'>;
    sequences: PositionSequencePreview[];
  } | null {
    const comp = this.doc.getComponent(id);
    if (comp) {
      if (comp.type === 'bipole') {
        return {
          sequences: [
            comp.startSequence ?? this.singleSequence(comp.start, comp.startRef),
            comp.endSequence ?? this.singleSequence(comp.end, comp.endRef),
          ],
          operators: ['--'],
        };
      }
      return {
        sequences: [comp.positionSequence ?? this.singleSequence(comp.position)],
        operators: [],
      };
    }
    const wire = this.doc.getWire(id);
    if (wire) {
      const sequences = wire.pathSequences && wire.pathSequences.length > 0
        ? wire.pathSequences
        : (wire.pathPoints ?? wire.points).map((point, index, points) => this.singleSequence(
          point,
          index === 0 ? wire.startRef : index === points.length - 1 ? wire.endRef : undefined,
        ));
      const operators = wire.operators
        ? [...wire.operators]
        : new Array(Math.max(0, sequences.length - 1)).fill('--');
      return { sequences, operators };
    }
    return null;
  }

  private buildSequenceSelection(
    sequences: PositionSequencePreview[],
    operators: Array<'--' | '|-' | '-|'>,
    color: string,
  ): SVGGElement {
    const gs = this.gs;
    const g = createGroup('sel-statement-group');
    const displayHandlePoints = sequences.map((sequence) => this.resolveDisplayedSequencePoint(sequence));
    if (displayHandlePoints.some((p) => p === null)) return g;
    const resolvedHandlePoints = displayHandlePoints as GridPoint[];
    const displayPathPoints = operators.length === resolvedHandlePoints.length - 1
      ? this.expandDisplayedWirePoints(resolvedHandlePoints, operators)
      : resolvedHandlePoints;
    for (let i = 0; i < displayPathPoints.length - 1; i++) {
      const a = displayPathPoints[i];
      const b = displayPathPoints[i + 1];
      g.appendChild(this.createOverlayLine(
        a.x * gs,
        a.y * gs,
        b.x * gs,
        b.y * gs,
        { opacity: CONNECTION_LINE_OPACITY },
        color,
      ));
    }
    for (const sequence of sequences) {
      this.appendPositionSequencePreview(g, sequence, color, 1);
    }
    return g;
  }

  private singleSequence(point: GridPoint, ref?: ConnectionRef): PositionSequencePreview {
    return {
      corners: [{
        kind: ref ? 'reference' : 'absolute',
        point,
        ref,
      }],
      point,
      ref,
    };
  }

  renderDeletePreview(id: string | null): void {
    this.deletePreviewGroup.innerHTML = '';
    if (!id) return;
    const comp = this.doc.getComponent(id);
    if (comp) {
      const def = this.registry.get(comp.defId);
      if (!def) return;
      if (comp.type === 'bipole') {
        this.deletePreviewGroup.appendChild(this.buildSingleBipoleSelection(comp, def, DELETE_PREVIEW_COLOR));
        return;
      }
      const deleteGroup = this.buildPlacedComponentSelection(
        comp.position.x,
        comp.position.y,
        def,
        comp.rotation,
        false,
        id,
        DELETE_PREVIEW_COLOR,
      );
      if (deleteGroup) this.deletePreviewGroup.appendChild(deleteGroup);
      return;
    }
    const wire = this.doc.getWire(id);
    if (wire) {
      const wireGroup = this.buildWireSelection(wire, DELETE_PREVIEW_COLOR);
      if (wireGroup) this.deletePreviewGroup.appendChild(wireGroup);
      return;
    }
    const drawPath = this.doc.getDrawPath(id);
    if (drawPath) {
      this.deletePreviewGroup.appendChild(this.buildDrawPathSelection(drawPath, DELETE_PREVIEW_COLOR));
      return;
    }
    const drawing = this.doc.getDrawing(id);
    if (drawing) this.deletePreviewGroup.appendChild(this.buildDrawingSelection(drawing, DELETE_PREVIEW_COLOR));
  }

  private buildDrawingSelection(drawing: DrawingInstance, color: string): SVGGElement {
    const gs = this.gs;
    const g = createGroup('sel-drawing');
    switch (drawing.kind) {
      case 'line':
      case 'arrow':
        g.appendChild(this.createOverlayLine(drawing.start.x * gs, drawing.start.y * gs, drawing.end.x * gs, drawing.end.y * gs, {}, color));
        g.appendChild(this.buildTransientPointMarker(`drawing:${drawing.id}:start`, drawing.start, color));
        g.appendChild(this.buildTransientPointMarker(`drawing:${drawing.id}:end`, drawing.end, color));
        return g;
      case 'text':
        g.appendChild(this.buildTransientPointMarker(`drawing:${drawing.id}:position`, drawing.position, color));
        return g;
      case 'rectangle': {
        const left = Math.min(drawing.start.x, drawing.end.x) * gs;
        const top = Math.min(drawing.start.y, drawing.end.y) * gs;
        const width = Math.abs(drawing.end.x - drawing.start.x) * gs;
        const height = Math.abs(drawing.end.y - drawing.start.y) * gs;
        g.appendChild(createRect(left, top, width, height, {
          fill: 'none',
          stroke: color,
          'stroke-width': OVERLAY_STROKE_WIDTH,
          'vector-effect': 'non-scaling-stroke',
        }));
        g.appendChild(this.buildTransientPointMarker(`drawing:${drawing.id}:start`, drawing.start, color));
        g.appendChild(this.buildTransientPointMarker(`drawing:${drawing.id}:end`, drawing.end, color));
        return g;
      }
      case 'circle': {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(drawing.center.x * gs));
        circle.setAttribute('cy', String(drawing.center.y * gs));
        circle.setAttribute('r', String(drawing.radius * gs));
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', color);
        circle.setAttribute('stroke-width', String(OVERLAY_STROKE_WIDTH));
        circle.setAttribute('vector-effect', 'non-scaling-stroke');
        g.appendChild(circle);
        g.appendChild(this.buildTransientPointMarker(`drawing:${drawing.id}:center`, drawing.center, color));
        return g;
      }
      case 'bezier': {
        g.appendChild(this.createOverlayLine(
          drawing.start.x * gs,
          drawing.start.y * gs,
          drawing.control1.x * gs,
          drawing.control1.y * gs,
          { 'stroke-dasharray': '4 3', opacity: GHOST_LINE_OPACITY },
          color,
        ));
        g.appendChild(this.createOverlayLine(
          drawing.control2.x * gs,
          drawing.control2.y * gs,
          drawing.end.x * gs,
          drawing.end.y * gs,
          { 'stroke-dasharray': '4 3', opacity: GHOST_LINE_OPACITY },
          color,
        ));
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${drawing.start.x * gs} ${drawing.start.y * gs} C ${drawing.control1.x * gs} ${drawing.control1.y * gs}, ${drawing.control2.x * gs} ${drawing.control2.y * gs}, ${drawing.end.x * gs} ${drawing.end.y * gs}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', String(OVERLAY_STROKE_WIDTH));
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        g.appendChild(path);
        g.appendChild(this.buildTransientPointMarker(`drawing:${drawing.id}:start`, drawing.start, color));
        g.appendChild(this.buildTransientPointMarker(`drawing:${drawing.id}:control1`, drawing.control1, color));
        g.appendChild(this.buildTransientPointMarker(`drawing:${drawing.id}:control2`, drawing.control2, color));
        g.appendChild(this.buildTransientPointMarker(`drawing:${drawing.id}:end`, drawing.end, color));
        return g;
      }
    }
  }

  private buildTransientPointMarker(key: string, point: GridPoint, color: string): SVGGElement {
    const gs = this.gs;
    const ref = this.transientPointRefs.get(key);
    return ref
      ? this.tooltipRingAt(point.x * gs, point.y * gs, gs * OVERLAY_MARKER_RADIUS, formatConnectionRef(ref), color, 1)
      : this.crossAt(point.x * gs, point.y * gs, gs * OVERLAY_MARKER_RADIUS, 1, color);
  }

  private buildSingleBipoleSelection(comp: BipoleInstance, def: ComponentDef, color: string): SVGGElement {
    const group = this.buildSequenceSelection(
      [
        comp.startSequence ?? this.singleSequence(comp.start, comp.startRef),
        comp.endSequence ?? this.singleSequence(comp.end, comp.endRef),
      ],
      ['--'],
      color,
    );
    this.appendBipoleBody(group, comp, def, color);
    return group;
  }

  private buildDrawPathSelection(path: DrawPathInstance, color: string): SVGGElement {
    const gs = this.gs;
    const g = createGroup('sel-draw-path');
    // Connection lines between consecutive positions
    const operators = path.segments.map((s) => (s.kind === 'connection' ? (s.operator ?? '--') : '--') as '--' | '|-' | '-|');
    const resolvedPoints = path.positionSequences.map((s) => this.resolveDisplayedSequencePoint(s));
    if (resolvedPoints.some((p) => p === null)) return g;
    const handlePoints = resolvedPoints as GridPoint[];
    const displayPoints = this.expandDisplayedWirePoints(handlePoints, operators);
    for (let i = 0; i < displayPoints.length - 1; i++) {
      const a = displayPoints[i];
      const b = displayPoints[i + 1];
      g.appendChild(this.createOverlayLine(a.x * gs, a.y * gs, b.x * gs, b.y * gs, { opacity: CONNECTION_LINE_OPACITY }, color));
    }
    // Crosshairs on each position
    for (const seq of path.positionSequences) {
      this.appendPositionSequencePreview(g, seq, color, 1);
    }
    // Bipole bodies
    for (let i = 0; i < path.segments.length; i++) {
      const seg = path.segments[i];
      if (seg.kind !== 'bipole' || !seg.defId) continue;
      const def = this.registry.get(seg.defId);
      if (!def) continue;
      const startPt = handlePoints[i];
      const endPt = handlePoints[i + 1];
      if (!startPt || !endPt) continue;
      const sx = startPt.x * gs;
      const sy = startPt.y * gs;
      const ex = endPt.x * gs;
      const ey = endPt.y * gs;
      const dx = ex - sx;
      const dy = ey - sy;
      const dist = Math.hypot(dx, dy);
      const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
      const { bodyWidth, bodyHeight, bodyX, bodyY } = getBipoleBodyMetrics(def, gs, dist);
      const body = createGroup('sel-bipole-body');
      body.setAttribute('transform', `translate(${sx}, ${sy}) rotate(${angleDeg})`);
      body.appendChild(createRect(bodyX, bodyY, bodyWidth, bodyHeight, { fill: color, opacity: OVERLAY_FILL_OPACITY }));
      g.appendChild(body);
    }
    return g;
  }

  private appendBipoleBody(group: SVGGElement, comp: BipoleInstance, def: ComponentDef, color: string): void {
    const gs = this.gs;
    const startPoint = comp.startSequence ? this.resolveDisplayedSequencePoint(comp.startSequence) : comp.start;
    const endPoint = comp.endSequence ? this.resolveDisplayedSequencePoint(comp.endSequence) : comp.end;
    if (!startPoint || !endPoint) return;
    const sx = startPoint.x * gs;
    const sy = startPoint.y * gs;
    const ex = endPoint.x * gs;
    const ey = endPoint.y * gs;
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.hypot(dx, dy);
    const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    const { bodyWidth, bodyHeight, bodyX, bodyY } = getBipoleBodyMetrics(def, gs, dist);
    const body = createGroup('sel-bipole-body');
    body.setAttribute('transform', `translate(${sx}, ${sy}) rotate(${angleDeg})`);
    body.appendChild(createRect(bodyX, bodyY, bodyWidth, bodyHeight, {
      fill: color,
      opacity: OVERLAY_FILL_OPACITY,
    }));
    group.appendChild(body);
  }

  private buildPlacedComponentSelection(
    x: number,
    y: number,
    def: ComponentDef,
    rotation: number,
    ghost = false,
    selectionId?: string,
    color: string = SELECTION_COLOR,
    showAnchorMarker = true,
  ): SVGGElement | null {
    const gs = this.gs;
    const cx = x * gs;
    const cy = y * gs;
    const selectedComp = selectionId ? this.doc.getComponent(selectionId) : undefined;
    const measuredBounds = selectionId ? this.doc.getMeasuredComponentBounds(selectionId) : undefined;
    const nodeName = selectedComp && 'nodeName' in selectedComp ? selectedComp.nodeName : undefined;
    const currentRef = selectedComp && selectedComp.type !== 'bipole' ? selectedComp.positionSequence?.ref : undefined;
    const hasMeasuredTerminals = nodeName ? this.doc.getMeasuredNodePointGroups(nodeName, 'terminal').length > 0 : false;
    const shouldShowReferenceAsSnap = Boolean(nodeName && def.geometry?.reference?.snap && !hasMeasuredTerminals);
    const wrapper = createGroup('sel-component-wrapper');
    if (measuredBounds) {
      wrapper.appendChild(this.buildMeasuredBoundsGroup(
        measuredBounds,
        color,
        showAnchorMarker,
        currentRef,
        shouldShowReferenceAsSnap ? nodeName : undefined,
      ));
    } else {
      wrapper.appendChild(this.buildStaticBoundsGroup(
        cx,
        cy,
        def,
        rotation,
        ghost,
        color,
        showAnchorMarker,
        currentRef,
        shouldShowReferenceAsSnap ? nodeName : undefined,
      ));
    }
    if (!ghost && nodeName) {
      this.appendMeasuredPinMarkers(wrapper, nodeName, color);
    }
    return wrapper.childNodes.length > 0 ? wrapper : null;
  }

  private buildStaticBoundsGroup(
    anchorX: number,
    anchorY: number,
    def: ComponentDef,
    rotationDeg: number,
    ghost: boolean,
    color: string,
    showAnchorMarker: boolean,
    currentRef?: ConnectionRef,
    fallbackReferenceLabel?: string,
  ): SVGGElement {
    const gs = this.gs;
    const metrics = getPlacedComponentMetrics(def, 1);
    const g = createGroup('sel-static-bounds');
    g.setAttribute('transform', `translate(${anchorX}, ${anchorY}) rotate(${rotationDeg})`);
    g.appendChild(createRect(
      metrics.leftOffset * gs,
      metrics.topOffset * gs,
      metrics.width * gs,
      metrics.height * gs,
      ghost ? {
        fill: color,
        opacity: OVERLAY_FILL_OPACITY,
      } : {
        fill: color,
        opacity: OVERLAY_FILL_OPACITY,
        stroke: color,
        'stroke-width': OVERLAY_STROKE_WIDTH,
        'vector-effect': 'non-scaling-stroke',
      },
    ));
    if (showAnchorMarker) {
      if (currentRef) {
        g.appendChild(this.tooltipRingAt(
          0,
          0,
          gs * OVERLAY_MARKER_RADIUS,
          formatConnectionRef(currentRef),
          color,
          ghost ? GHOST_LINE_OPACITY : SELECTION_LINE_OPACITY,
        ));
      } else if (fallbackReferenceLabel) {
        g.appendChild(this.tooltipRingAt(
          0,
          0,
          gs * OVERLAY_MARKER_RADIUS,
          fallbackReferenceLabel,
          color,
          ghost ? GHOST_LINE_OPACITY : SELECTION_LINE_OPACITY,
        ));
      } else {
        g.appendChild(ghost
          ? this.crossAt(0, 0, gs * OVERLAY_MARKER_RADIUS, GHOST_LINE_OPACITY, color)
          : this.crossAt(0, 0, gs * OVERLAY_MARKER_RADIUS, SELECTION_LINE_OPACITY, color));
      }
    }
    return g;
  }

  private buildMeasuredBoundsGroup(
    bounds: RenderComponentBounds,
    color: string,
    showAnchorMarker: boolean,
    currentRef?: ConnectionRef,
    fallbackReferenceLabel?: string,
  ): SVGGElement {
    const gs = this.gs;
    const g = createGroup('sel-measured-bounds');
    g.appendChild(createRect(
      bounds.left * gs,
      bounds.top * gs,
      bounds.width * gs,
      bounds.height * gs,
      {
        fill: color,
        opacity: OVERLAY_FILL_OPACITY,
        stroke: color,
        'stroke-width': OVERLAY_STROKE_WIDTH,
        'vector-effect': 'non-scaling-stroke',
      },
    ));
    if (showAnchorMarker) {
      const ref = this.doc.getMeasuredSymbolPoint(bounds.nodeName, 'reference');
      if (ref) {
        if (currentRef) {
          g.appendChild(this.tooltipRingAt(
            ref.point.x * gs,
            ref.point.y * gs,
            gs * OVERLAY_MARKER_RADIUS,
            formatConnectionRef(currentRef),
            color,
            SELECTION_LINE_OPACITY,
          ));
        } else if (fallbackReferenceLabel || ref.snap) {
          g.appendChild(this.tooltipRingAt(
            ref.point.x * gs,
            ref.point.y * gs,
            gs * OVERLAY_MARKER_RADIUS,
            fallbackReferenceLabel ?? bounds.nodeName,
            color,
            SELECTION_LINE_OPACITY,
          ));
        } else {
          g.appendChild(this.crossAt(
            ref.point.x * gs,
            ref.point.y * gs,
            gs * OVERLAY_MARKER_RADIUS,
            SELECTION_LINE_OPACITY,
            color,
          ));
        }
      }
    }
    return g;
  }

  private appendMeasuredPinMarkers(parent: SVGGElement, nodeName: string, color: string): void {
    const gs = this.gs;
    const groups = this.doc.getMeasuredNodePointGroups(nodeName, 'terminal');
    for (const group of groups) {
      const label = group.names.map((name) => `${nodeName}.${name}`).join('\n');
      parent.appendChild(this.tooltipRingAt(
        group.point.x * gs,
        group.point.y * gs,
        gs * OVERLAY_MARKER_RADIUS,
        label,
        color,
        SELECTION_LINE_OPACITY,
      ));
    }
  }

  private appendPositionSequencePreview(
    parent: SVGGElement,
    sequence: PositionSequencePreview,
    color: string,
    opacity: number,
    skipLastCorner = false,
  ): void {
    const gs = this.gs;
    const lastIndex = sequence.corners.length - 1;
    const relativeOriginIndexes = new Set<number>();
    for (const corner of sequence.corners) {
      if (corner.kind === 'relative' && corner.relativeFromIndex !== undefined) {
        relativeOriginIndexes.add(corner.relativeFromIndex);
      }
    }
    for (let index = 0; index < sequence.corners.length; index++) {
      // The last corner is the node's own position — already drawn as a cross
      // by buildProbeSelectionGroup (tied to comp.position, moves during drag).
      if (skipLastCorner && index === lastIndex) continue;
      const corner = sequence.corners[index];
      const displayPoint = this.resolveDisplayedCornerPoint(sequence, index);
      if (!displayPoint) continue;
      if (corner.kind === 'relative' && corner.relativeFromIndex !== undefined) {
        const originPoint = this.resolveDisplayedCornerPoint(sequence, corner.relativeFromIndex);
        if (!originPoint) continue;
        parent.appendChild(this.buildRelativeOriginMarker(sequence, corner.relativeFromIndex, color));
        parent.appendChild(this.createRelativeVector(
          originPoint.x * gs,
          originPoint.y * gs,
          displayPoint.x * gs,
          displayPoint.y * gs,
          color,
          1,
        ));
      }
      if (relativeOriginIndexes.has(index)) continue;
      parent.appendChild(this.buildCornerMarker(sequence, index, color, corner.kind === 'relative' ? 1 : opacity));
    }
  }

  private buildCornerMarker(
    sequence: PositionSequencePreview,
    index: number,
    color: string,
    opacity: number,
  ): SVGGElement {
    const gs = this.gs;
    const displayPoint = this.resolveDisplayedCornerPoint(sequence, index);
    if (!displayPoint) return createGroup('sel-corner-empty');
    const x = displayPoint.x * gs;
    const y = displayPoint.y * gs;
    if (this.resolveCornerMarkerKind(sequence, index) === 'ring') {
      const ringRef = this.resolveCornerReference(sequence, index);
      return this.tooltipRingAt(x, y, gs * OVERLAY_MARKER_RADIUS, ringRef ? formatConnectionRef(ringRef) : 'reference', color, opacity);
    }
    return this.crossAt(x, y, gs * OVERLAY_MARKER_RADIUS, opacity, color);
  }

  private buildRelativeOriginMarker(
    sequence: PositionSequencePreview,
    index: number,
    color: string,
  ): SVGGElement {
    const gs = this.gs;
    const displayPoint = this.resolveDisplayedCornerPoint(sequence, index);
    if (!displayPoint) return createGroup('sel-relative-origin-empty');
    const x = displayPoint.x * gs;
    const y = displayPoint.y * gs;
    if (this.resolveCornerMarkerKind(sequence, index) === 'ring') {
      const g = createGroup('sel-relative-origin-ring');
      g.appendChild(createCircle(x, y, gs * OVERLAY_MARKER_RADIUS, {
        fill: color,
        opacity: OVERLAY_FILL_OPACITY,
        stroke: 'none',
      }));
      return g;
    }
    const g = createGroup('sel-relative-origin-square');
    g.appendChild(createRect(
      x - gs * OVERLAY_MARKER_RADIUS,
      y - gs * OVERLAY_MARKER_RADIUS,
      gs * OVERLAY_MARKER_RADIUS * 2,
      gs * OVERLAY_MARKER_RADIUS * 2,
      {
        fill: color,
        opacity: OVERLAY_FILL_OPACITY,
        stroke: 'none',
      },
    ));
    return g;
  }

  private resolveCornerMarkerKind(sequence: PositionSequencePreview, index: number): 'square' | 'ring' {
    const corner = sequence.corners[index];
    if (corner.kind === 'absolute') return 'square';
    if (corner.kind === 'reference') return 'ring';
    if (corner.relativeFromIndex !== undefined) return this.resolveCornerMarkerKind(sequence, corner.relativeFromIndex);
    return 'square';
  }

  private resolveCornerReference(sequence: PositionSequencePreview, index: number): ConnectionRef | undefined {
    const corner = sequence.corners[index];
    if (corner.kind === 'reference') return corner.ref;
    if (corner.relativeFromIndex !== undefined) return this.resolveCornerReference(sequence, corner.relativeFromIndex);
    return undefined;
  }

  private resolveDisplayedSequencePoint(sequence: PositionSequencePreview): GridPoint | null {
    return this.resolveDisplayedCornerPoint(sequence, sequence.corners.length - 1);
  }

  private resolveDisplayedCornerPoint(sequence: PositionSequencePreview, index: number): GridPoint | null {
    const corner = sequence.corners[index];
    if (corner.kind === 'reference' && corner.ref) {
      return this.doc.getMeasuredSymbolPoint(corner.ref.nodeName, corner.ref.anchor)?.point ?? corner.point;
    }
    if (corner.kind === 'relative' && corner.relativeFromIndex !== undefined) {
      const originDisplay = this.resolveDisplayedCornerPoint(sequence, corner.relativeFromIndex);
      if (!originDisplay) return null;
      const originLogical = sequence.corners[corner.relativeFromIndex].point;
      return {
        x: originDisplay.x + (corner.point.x - originLogical.x),
        y: originDisplay.y + (corner.point.y - originLogical.y),
      };
    }
    return corner.point;
  }

  private expandDisplayedWirePoints(
    points: GridPoint[],
    operators: Array<'--' | '|-' | '-|'>,
  ): GridPoint[] {
    const expanded: GridPoint[] = [points[0]];
    for (let i = 0; i < operators.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      const op = operators[i];
      if (op === '--') {
        expanded.push(b);
        continue;
      }
      if (op === '|-') {
        expanded.push({ x: a.x, y: b.y });
        expanded.push(b);
        continue;
      }
      expanded.push({ x: b.x, y: a.y });
      expanded.push(b);
    }
    return expanded;
  }

  private createRelativeVector(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    opacity: number,
  ): SVGGElement {
    const g = createGroup('sel-relative-vector');
    const markerId = `relative-arrow-${Math.random().toString(36).slice(2, 10)}`;
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', markerId);
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '7');
    marker.setAttribute('refY', '4');
    marker.setAttribute('orient', 'auto');
    marker.setAttribute('markerUnits', 'strokeWidth');
    const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrowPath.setAttribute('d', 'M 0 2 L 8 4 L 0 6 z');
    arrowPath.setAttribute('fill', color);
    arrowPath.setAttribute('opacity', String(opacity));
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    g.appendChild(defs);
    const line = this.createOverlayLine(x1, y1, x2, y2, {
      opacity,
      'stroke-dasharray': '0 1',
      'stroke-linecap': 'round',
    }, color);
    line.setAttribute('marker-end', `url(#${markerId})`);
    g.appendChild(line);
    return g;
  }

  private crossAt(
    x: number,
    y: number,
    radius: number,
    opacity = 1,
    color: string = SELECTION_COLOR,
  ): SVGGElement {
    const g = createGroup('sel-cross');
    g.appendChild(createLine(x - radius, y - radius, x + radius, y + radius, {
      stroke: color,
      opacity,
      'stroke-width': OVERLAY_STROKE_WIDTH,
      'vector-effect': 'non-scaling-stroke',
    }));
    g.appendChild(createLine(x - radius, y + radius, x + radius, y - radius, {
      stroke: color,
      opacity,
      'stroke-width': OVERLAY_STROKE_WIDTH,
      'vector-effect': 'non-scaling-stroke',
    }));
    return g;
  }

  private ringAt(x: number, y: number, radius: number, color: string, opacity = 1): SVGCircleElement {
    return createCircle(x, y, radius, {
      fill: 'none',
      opacity,
      stroke: color,
      'stroke-width': OVERLAY_STROKE_WIDTH,
      'vector-effect': 'non-scaling-stroke',
    });
  }

  private tooltipRingAt(x: number, y: number, radius: number, label: string, color: string, opacity = 1): SVGGElement {
    const g = createGroup('sel-ring-label');
    g.setAttribute('data-pin-label', label);
    g.appendChild(createCircle(x, y, radius * 2.2, {
      fill: 'transparent',
      stroke: 'none',
      'pointer-events': 'all',
    }));
    g.appendChild(this.ringAt(x, y, radius, color, opacity));
    return g;
  }

  private dedupePinMarkers(): void {
    const seen = new Set<string>();
    for (const marker of this.overlaySvg.querySelectorAll<SVGGElement>('[data-pin-label]')) {
      const label = marker.getAttribute('data-pin-label');
      if (!label) continue;
      const ring = marker.querySelector<SVGCircleElement>('circle[fill="none"]');
      const matrix = ring?.getCTM();
      if (!ring || !matrix) continue;
      const cx = Number.parseFloat(ring.getAttribute('cx') ?? '0');
      const cy = Number.parseFloat(ring.getAttribute('cy') ?? '0');
      const x = matrix.a * cx + matrix.c * cy + matrix.e;
      const y = matrix.b * cx + matrix.d * cy + matrix.f;
      const key = `${label}@${Math.round(x)},${Math.round(y)}`;
      if (seen.has(key)) {
        marker.remove();
        continue;
      }
      seen.add(key);
    }
  }

  private createOverlayLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    attrs: Record<string, string | number> = {},
    color: string = SELECTION_COLOR,
  ): SVGLineElement {
    return createLine(x1, y1, x2, y2, {
      stroke: color || OVERLAY_STROKE_COLOR,
      'stroke-width': OVERLAY_STROKE_WIDTH,
      'stroke-linecap': 'butt',
      'vector-effect': 'non-scaling-stroke',
      ...attrs,
    });
  }
}
