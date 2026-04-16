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
} from '../types';
import type { ComponentRegistry } from '../definitions/ComponentRegistry';
import type { SelectionState } from '../model/SelectionState';
import type { CircuitDocument } from '../model/CircuitDocument';
import { SELECTION_COLOR, GHOST_OPACITY } from '../constants';
import { scaleState } from './ScaleState';
import { createCircle, createGroup, createLine, createRect } from '../utils/svg';
import { getBipoleBodyMetrics, getPlacedComponentMetrics } from './ComponentGeometry';
import { componentProbeService, type ComponentRenderProbe } from './ComponentProbeService';
import type { ClipboardEntry } from '../tools/SelectionClipboard';

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
  private hoverGroup: SVGGElement;
  private renderedAnchorMap = new Map<string, GridPoint>();

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
    this.hoverGroup = createGroup('hover');
    this.overlaySvg.appendChild(this.selectionGroup);
    this.overlaySvg.appendChild(this.deletePreviewGroup);
    this.overlaySvg.appendChild(this.ghostGroup);
    this.overlaySvg.appendChild(this.hoverGroup);
  }

  private get gs(): number { return scaleState.effectiveGridSize; }

  // ====== GHOST ======

  setGhostElement(el: SVGElement | null): void {
    this.ghostGroup.innerHTML = '';
    if (!el) this.setLatexGhostPreview(null);
    if (el) this.ghostGroup.appendChild(el);
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

  buildBipoleGhost(defId: string, start: GridPoint, end: GridPoint, showLatexPreview = true): SVGGElement | null {
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
      const ghostComp: BipoleInstance = {
        id: '__ghost__',
        defId,
        type: 'bipole',
        start,
        end,
        props: {},
      };
      const probe = showLatexPreview
        ? componentProbeService.getBipoleGhostProbe(def, ghostComp, () => this.setGhostElement(this.buildBipoleGhost(defId, start, end, true)))
        : null;
      if (probe && showLatexPreview) {
        this.setLatexGhostPreview({
          anchorX: sx,
          anchorY: sy,
          angleDeg,
          opacity: GHOST_OPACITY,
          svgMarkup: probe.svgMarkup,
          tx: probe.tx,
          ty: probe.ty,
        });
      } else {
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
    }
    g.appendChild(this.createOverlayLine(sx, sy, ex, ey, { opacity: GHOST_LINE_OPACITY }, SELECTION_COLOR));
    g.appendChild(this.crossAt(sx, sy, gs * OVERLAY_MARKER_RADIUS, GHOST_LINE_OPACITY, OVERLAY_MARKER_COLOR));
    g.appendChild(this.crossAt(ex, ey, gs * OVERLAY_MARKER_RADIUS, GHOST_LINE_OPACITY, OVERLAY_MARKER_COLOR));
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
        g.appendChild(this.tooltipRingAt(p.x * gs, p.y * gs, gs * OVERLAY_MARKER_RADIUS, ref.anchor, SELECTION_COLOR, GHOST_LINE_OPACITY));
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

  buildMonopoleGhost(defId: string, position: GridPoint, rotation = 0): SVGGElement | null {
    const def = this.registry.get(defId);
    if (!def) return null;
    const probe = componentProbeService.getPlacedGhostProbe(def, rotation, () => this.setGhostElement(this.buildMonopoleGhost(defId, position, rotation)));
    if (probe) {
      this.setLatexGhostPreview({
        anchorX: position.x * this.gs,
        anchorY: position.y * this.gs,
        opacity: GHOST_OPACITY,
        svgMarkup: probe.svgMarkup,
        tx: probe.tx,
        ty: probe.ty,
      });
    } else {
      this.setLatexGhostPreview(null);
    }
    const g = createGroup('ghost-monopole');
    if (!probe) {
      const ghost = this.buildPlacedComponentSelection(position.x, position.y, def, rotation, true);
      if (ghost) g.appendChild(ghost);
    } else {
      g.appendChild(this.crossAt(position.x * this.gs, position.y * this.gs, this.gs * OVERLAY_MARKER_RADIUS, GHOST_LINE_OPACITY, OVERLAY_MARKER_COLOR));
    }
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
          g.appendChild(this.buildPlacedComponentSelection(
            entry.item.position.x,
            entry.item.position.y,
            def,
            entry.item.rotation,
            false,
          ));
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
    this.renderedAnchorMap = this.buildRenderedAnchorMap();
    const selectedIds = this.selection.getSelectedIds();
    const groupedByLine = new Map<number, string[]>();
    for (const id of selectedIds) {
      const parts = this.lineIdParts(id);
      if (parts.subIndex === null || parts.lineIndex < 0) continue;
      const group = groupedByLine.get(parts.lineIndex) ?? [];
      group.push(id);
      groupedByLine.set(parts.lineIndex, group);
    }
    const handledIds = new Set<string>();
    for (const ids of groupedByLine.values()) {
      if (ids.length < 2) continue;
      const group = this.buildSelectionGroup(ids, SELECTION_COLOR);
      if (!group) continue;
      this.selectionGroup.appendChild(group);
      ids.forEach((id) => handledIds.add(id));
    }
    for (const id of selectedIds) {
      if (handledIds.has(id)) continue;
      const group = this.buildSelectionGroup([id], SELECTION_COLOR);
      if (group) this.selectionGroup.appendChild(group);
    }
  }

  setHoverSequences(sequences: PositionSequencePreview[], cursor: GridPoint, tolerance: number): void {
    this.hoverGroup.innerHTML = '';
    if (sequences.length === 0) return;
    for (const sequence of sequences) {
      for (let index = 0; index < sequence.corners.length; index++) {
        const displayPoint = this.resolveDisplayedCornerPoint(sequence, index);
        if (Math.abs(displayPoint.x - cursor.x) > tolerance) continue;
        if (Math.abs(displayPoint.y - cursor.y) > tolerance) continue;
        this.hoverGroup.appendChild(this.buildCornerMarker(sequence, index, SELECTION_COLOR, GHOST_LINE_OPACITY));
      }
    }
  }

  private buildSelectionGroup(ids: string[], color: string): SVGGElement | null {
    if (ids.length === 1) {
      const single = this.buildSingleSelectionGroup(ids[0], color);
      if (single) return single;
    }
    const ordered = [...ids]
      .map((id) => ({ id, ...this.lineIdParts(id) }))
      .filter((entry) => entry.subIndex !== null)
      .sort((a, b) => (a.subIndex ?? 0) - (b.subIndex ?? 0));
    if (ordered.length === 0) return null;
    const sequences: PositionSequencePreview[] = [];
    const operators: Array<'--' | '|-' | '-|'> = [];
    for (let i = 0; i < ordered.length; i++) {
      const entry = ordered[i];
      const extracted = this.extractSelectionSequences(entry.id);
      if (!extracted || extracted.sequences.length === 0) continue;
      // Sub-wires on the same line are connected in series: the first point of each
      // sub-wire (after the first) is the same shared endpoint as the last point of
      // the previous sub-wire. Skip it unconditionally to avoid a duplicate crosshair.
      const isConsecutiveSubWire = i > 0 && sequences.length > 0;
      if (isConsecutiveSubWire) {
        sequences.push(...extracted.sequences.slice(1));
      } else {
        sequences.push(...extracted.sequences);
      }
      operators.push(...extracted.operators);
    }
    if (sequences.length === 0) return null;
    const group = this.buildSequenceSelection(sequences, operators, color);
    for (const entry of ordered) {
      const comp = this.doc.getComponent(entry.id);
      if (!comp || comp.type !== 'bipole') continue;
      const def = this.registry.get(comp.defId);
      if (!def) continue;
      this.appendBipoleBody(group, comp, def, color);
    }
    return group;
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
    const displayPathPoints = operators.length === displayHandlePoints.length - 1
      ? this.expandDisplayedWirePoints(displayHandlePoints, operators)
      : displayHandlePoints;
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

  private sameSequenceEndpoint(a: PositionSequencePreview, b: PositionSequencePreview): boolean {
    if (a.ref?.nodeName && b.ref?.nodeName) {
      return a.ref.nodeName === b.ref.nodeName && a.ref.anchor === b.ref.anchor;
    }
    return a.point.x === b.point.x && a.point.y === b.point.y;
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

  private lineIdParts(id: string): { lineIndex: number; subIndex: number | null } {
    const match = id.match(/^line:(\d+)(?::(\d+))?$/);
    return {
      lineIndex: match ? Number.parseInt(match[1], 10) : -1,
      subIndex: match?.[2] ? Number.parseInt(match[2], 10) : null,
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
      this.deletePreviewGroup.appendChild(this.buildPlacedComponentSelection(
        comp.position.x,
        comp.position.y,
        def,
        comp.rotation,
        false,
        id,
        DELETE_PREVIEW_COLOR,
      ));
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
        g.appendChild(this.crossAt(drawing.start.x * gs, drawing.start.y * gs, gs * OVERLAY_MARKER_RADIUS, 1, color));
        g.appendChild(this.crossAt(drawing.end.x * gs, drawing.end.y * gs, gs * OVERLAY_MARKER_RADIUS, 1, color));
        return g;
      case 'text':
        g.appendChild(this.crossAt(drawing.position.x * gs, drawing.position.y * gs, gs * OVERLAY_MARKER_RADIUS, 1, color));
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
        g.appendChild(this.crossAt(drawing.start.x * gs, drawing.start.y * gs, gs * OVERLAY_MARKER_RADIUS, 1, color));
        g.appendChild(this.crossAt(drawing.end.x * gs, drawing.end.y * gs, gs * OVERLAY_MARKER_RADIUS, 1, color));
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
        g.appendChild(this.crossAt(drawing.center.x * gs, drawing.center.y * gs, gs * OVERLAY_MARKER_RADIUS, 1, color));
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
        g.appendChild(this.crossAt(drawing.start.x * gs, drawing.start.y * gs, gs * OVERLAY_MARKER_RADIUS, 1, color));
        g.appendChild(this.crossAt(drawing.control1.x * gs, drawing.control1.y * gs, gs * OVERLAY_MARKER_RADIUS, 1, color));
        g.appendChild(this.crossAt(drawing.control2.x * gs, drawing.control2.y * gs, gs * OVERLAY_MARKER_RADIUS, 1, color));
        g.appendChild(this.crossAt(drawing.end.x * gs, drawing.end.y * gs, gs * OVERLAY_MARKER_RADIUS, 1, color));
        return g;
      }
    }
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
    const handlePoints = path.positionSequences.map((s) => this.resolveDisplayedSequencePoint(s));
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
  ): SVGGElement {
    const gs = this.gs;
    const cx = x * gs;
    const cy = y * gs;
    const selectedComp = selectionId ? this.doc.getComponent(selectionId) : undefined;
    const probe = ghost
      ? null
      : selectionId && selectedComp
        ? componentProbeService.getSelectionProbe(selectionId, selectedComp, def, () => this.renderSelection())
        : null;
    if (probe) {
      const anchorX = cx;
      const anchorY = cy;
      const g = this.buildProbeSelectionGroup(anchorX, anchorY, probe, ghost, rotation, color, showAnchorMarker);
      return g;
    }
    if (selectionId && !ghost) {
      return createGroup('sel-point-pending');
    }
    const { width, height, leftOffset, topOffset } = getPlacedComponentMetrics(def, gs);
    const anchorX = cx;
    const anchorY = cy;
    const left = anchorX + leftOffset;
    const top = anchorY + topOffset;
    const g = createGroup('sel-point');
    g.appendChild(createRect(left, top, width, height, ghost ? {
      fill: color,
      opacity: OVERLAY_FILL_OPACITY,
    } : {
      fill: color,
      opacity: OVERLAY_FILL_OPACITY,
      stroke: color,
      'stroke-width': OVERLAY_STROKE_WIDTH,
      'vector-effect': 'non-scaling-stroke',
    }));
    if (showAnchorMarker) {
      g.appendChild(this.crossAt(
        anchorX,
        anchorY,
        gs * OVERLAY_MARKER_RADIUS,
        ghost ? GHOST_LINE_OPACITY : SELECTION_LINE_OPACITY,
        color,
      ));
    }
    return g;
  }

  private buildProbeSelectionGroup(
    anchorX: number,
    anchorY: number,
    probe: ComponentRenderProbe,
    ghost = false,
    rotationDeg = 0,
    color: string = SELECTION_COLOR,
    showAnchorMarker = true,
  ): SVGGElement {
    const gs = this.gs;
    const g = createGroup('sel-probe');
    g.setAttribute('transform', `translate(${anchorX}, ${anchorY}) rotate(${rotationDeg})`);
    g.appendChild(createRect(
      probe.bboxLeft,
      probe.bboxTop,
      probe.bboxWidth,
      probe.bboxHeight,
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
      if (ghost) {
        g.appendChild(this.crossAt(0, 0, gs * OVERLAY_MARKER_RADIUS, GHOST_LINE_OPACITY, color));
      } else {
        g.appendChild(this.crossAt(0, 0, gs * OVERLAY_MARKER_RADIUS, SELECTION_LINE_OPACITY, color));
      }
    }
    if (!ghost) {
      for (const pin of probe.pinOffsets) {
        g.appendChild(this.tooltipRingAt(
          pin.x,
          pin.y,
          gs * OVERLAY_MARKER_RADIUS,
          pin.name,
          color,
          SELECTION_LINE_OPACITY,
        ));
      }
    }
    return g;
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
      if (corner.kind === 'relative' && corner.relativeFromIndex !== undefined) {
        const originPoint = this.resolveDisplayedCornerPoint(sequence, corner.relativeFromIndex);
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
    const x = displayPoint.x * gs;
    const y = displayPoint.y * gs;
    if (this.resolveCornerMarkerKind(sequence, index) === 'ring') {
      const ringRef = this.resolveCornerReference(sequence, index);
      return this.tooltipRingAt(x, y, gs * OVERLAY_MARKER_RADIUS, ringRef?.anchor ?? 'reference', color, opacity);
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

  private resolveDisplayedSequencePoint(sequence: PositionSequencePreview): GridPoint {
    return this.resolveDisplayedCornerPoint(sequence, sequence.corners.length - 1);
  }

  private resolveDisplayedCornerPoint(sequence: PositionSequencePreview, index: number): GridPoint {
    const corner = sequence.corners[index];
    if (corner.kind === 'reference' && corner.ref) {
      const key = this.anchorMapKey(corner.ref.nodeName, corner.ref.anchor);
      const mapped = this.renderedAnchorMap.get(key);
      if (mapped) return mapped;
    }
    if (corner.kind === 'relative' && corner.relativeFromIndex !== undefined) {
      const originDisplay = this.resolveDisplayedCornerPoint(sequence, corner.relativeFromIndex);
      const originLogical = sequence.corners[corner.relativeFromIndex].point;
      return {
        x: originDisplay.x + (corner.point.x - originLogical.x),
        y: originDisplay.y + (corner.point.y - originLogical.y),
      };
    }
    return corner.point;
  }

  private buildRenderedAnchorMap(): Map<string, GridPoint> {
    const map = new Map<string, GridPoint>();
    for (const comp of this.doc.components) {
      if (comp.type === 'bipole' || !comp.nodeName) continue;
      const def = this.registry.get(comp.defId);
      if (!def) continue;
      const displayReferencePoint = comp.positionSequence
        ? this.resolveDisplayedSequencePointWithMap(comp.positionSequence, map)
        : comp.position;
      map.set(this.anchorMapKey(comp.nodeName, 'reference'), displayReferencePoint);
      const probe = componentProbeService.getSelectionProbe(comp.id, comp, def, () => this.renderSelection());
      if (!probe) continue;
      for (const pin of probe.pinOffsets) {
        map.set(this.anchorMapKey(comp.nodeName, pin.name), {
          x: displayReferencePoint.x + pin.x / this.gs,
          y: displayReferencePoint.y + pin.y / this.gs,
        });
      }
    }
    return map;
  }

  private resolveDisplayedSequencePointWithMap(sequence: PositionSequencePreview, map: Map<string, GridPoint>): GridPoint {
    return this.resolveDisplayedCornerPointWithMap(sequence, sequence.corners.length - 1, map);
  }

  private resolveDisplayedCornerPointWithMap(
    sequence: PositionSequencePreview,
    index: number,
    map: Map<string, GridPoint>,
  ): GridPoint {
    const corner = sequence.corners[index];
    if (corner.kind === 'reference' && corner.ref) {
      const mapped = map.get(this.anchorMapKey(corner.ref.nodeName, corner.ref.anchor));
      if (mapped) return mapped;
    }
    if (corner.kind === 'relative' && corner.relativeFromIndex !== undefined) {
      const originDisplay = this.resolveDisplayedCornerPointWithMap(sequence, corner.relativeFromIndex, map);
      const originLogical = sequence.corners[corner.relativeFromIndex].point;
      return {
        x: originDisplay.x + (corner.point.x - originLogical.x),
        y: originDisplay.y + (corner.point.y - originLogical.y),
      };
    }
    return corner.point;
  }

  private anchorMapKey(nodeName: string, anchor: string): string {
    return `${nodeName}.${anchor}`;
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
