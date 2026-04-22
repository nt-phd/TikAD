import type { ConnectionRef, GridPoint, WireRoutingMode } from '../types';
import { BaseTool, type SnapResult } from './BaseTool';
import { pointsEqual } from '../utils/geometry';
import { emitWirePath } from '../codegen/WirePathEmitter';

export class WireTool extends BaseTool {
  private points: GridPoint[] = [];
  private pathPoints: GridPoint[] = [];
  private operators: Array<'--' | '|-' | '-|'> = [];
  private startRef?: ConnectionRef;
  private endRef?: ConnectionRef;
  private lastSnap: SnapResult | null = null;
  private routingMode: WireRoutingMode = 'auto';

  setRoutingMode(mode: WireRoutingMode): void {
    this.routingMode = mode;
    if (this.lastSnap) this.onMouseMove(this.lastSnap, {} as MouseEvent);
  }

  private chooseOperator(target: SnapResult): '--' | '|-' | '-|' {
    const last = this.pathPoints[this.pathPoints.length - 1];
    if (!last) return '--';
    if (last.x === target.point.x || last.y === target.point.y) return '--';
    if (this.routingMode !== 'auto') return this.routingMode;
    if (this.pathPoints.length >= 2) {
      const prev = this.pathPoints[this.pathPoints.length - 2];
      if (prev.y === last.y) return '|-';
      if (prev.x === last.x) return '-|';
    }
    return '-|';
  }

  private rebuildExpandedPoints(pathPoints = this.pathPoints, operators = this.operators): GridPoint[] {
    if (pathPoints.length === 0) return [];
    const expanded: GridPoint[] = [pathPoints[0]];
    for (let i = 0; i < operators.length; i++) {
      const a = pathPoints[i];
      const b = pathPoints[i + 1];
      const op = operators[i];
      if (op === '--') {
        expanded.push(b);
      } else if (op === '|-') {
        expanded.push({ x: a.x, y: b.y }, b);
      } else {
        expanded.push({ x: b.x, y: a.y }, b);
      }
    }
    return expanded;
  }

  onMouseDown(snap: SnapResult, e: MouseEvent): void {
    if (e.button !== 0) { this.cancel(); return; }

    if (this.points.length === 0) {
      this.pathPoints.push(snap.point);
      this.points = this.rebuildExpandedPoints();
      this.startRef = snap.ref;
      this.endRef = undefined;
    } else {
      const last = this.points[this.points.length - 1];
      if (pointsEqual(last, snap.point)) return;
      this.operators.push(this.chooseOperator(snap));
      this.pathPoints.push(snap.point);
      this.points = this.rebuildExpandedPoints();
      this.endRef = snap.ref;
    }
  }

  onMouseMove(snap: SnapResult, _e: MouseEvent): void {
    this.lastSnap = snap;
    if (this.points.length === 0) return;
    const last = this.pathPoints[this.pathPoints.length - 1];
    let preview = [...this.points];
    if (last && !pointsEqual(last, snap.point)) {
      const previewPathPoints = [...this.pathPoints, snap.point];
      const previewOperators = [...this.operators, this.chooseOperator(snap)];
      preview = this.rebuildExpandedPoints(previewPathPoints, previewOperators);
      this.ctx.ghost.setGhostElement(this.ctx.ghost.buildWireGhost(
        preview,
        previewPathPoints,
        this.startRef,
        snap.ref,
      ));
      return;
    }
    this.ctx.ghost.setGhostElement(this.ctx.ghost.buildWireGhost(
      preview,
      this.pathPoints,
      this.startRef,
      this.endRef,
    ));
  }

  onMouseUp(_snap: SnapResult, _e: MouseEvent): void {}

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.cancel();
    else if (e.key === 'Enter') this.finishWire();
  }

  finishWire(): void {
    if (this.points.length >= 2) {
      this.ctx.appendLine(`\\draw ${emitWirePath({
        id: '__preview__',
        operators: this.operators,
        pathPoints: this.pathPoints,
        points: this.points,
        startRef: this.startRef,
        endRef: this.endRef,
        junctions: new Map(),
      })};`);
    }
    this.points = [];
    this.pathPoints = [];
    this.operators = [];
    this.startRef = undefined;
    this.endRef = undefined;
    this.ctx.ghost.setGhostElement(null);
  }

  private cancel(): void {
    this.points = [];
    this.pathPoints = [];
    this.operators = [];
    this.startRef = undefined;
    this.endRef = undefined;
    this.lastSnap = null;
    this.ctx.ghost.setGhostElement(null);
  }

  deactivate(): void {
    if (this.points.length >= 2) this.finishWire();
    this.points = [];
    this.pathPoints = [];
    this.operators = [];
    this.startRef = undefined;
    this.endRef = undefined;
    this.lastSnap = null;
    super.deactivate();
  }
}
