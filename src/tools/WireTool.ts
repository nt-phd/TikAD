import type { ConnectionRef, GridPoint, WireRoutingMode } from '../types';
import { BaseTool } from './BaseTool';
import { pointsEqual } from '../utils/geometry';
import { emitWirePath } from '../codegen/WirePathEmitter';

export class WireTool extends BaseTool {
  private points: GridPoint[] = [];
  private pathPoints: GridPoint[] = [];
  private operators: Array<'--' | '|-' | '-|'> = [];
  private startRef?: ConnectionRef;
  private endRef?: ConnectionRef;
  private hoverPoint: GridPoint | null = null;
  private routingMode: WireRoutingMode = 'auto';

  setRoutingMode(mode: WireRoutingMode): void {
    this.routingMode = mode;
    if (this.hoverPoint) this.onMouseMove(this.hoverPoint, {} as MouseEvent);
  }

  private snapConnection(gridPt: GridPoint): { point: GridPoint; ref?: ConnectionRef } {
    if (!this.ctx.hitTester.connectionSnapEnabled) return { point: gridPt };
    return this.ctx.hitTester.findNearestConnectionTarget(gridPt, 0.5, () => {
      if (this.hoverPoint) this.onMouseMove(this.hoverPoint, {} as MouseEvent);
    }) ?? { point: gridPt };
  }

  private chooseOperator(target: { point: GridPoint; ref?: ConnectionRef }): '--' | '|-' | '-|' {
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

  onMouseDown(gridPt: GridPoint, e: MouseEvent): void {
    if (e.button !== 0) { this.cancel(); return; }
    const snapped = this.snapConnection(gridPt);
    const snappedPt = snapped.point;

    if (this.points.length === 0) {
      this.pathPoints.push(snappedPt);
      this.points = this.rebuildExpandedPoints();
      this.startRef = snapped.ref;
      this.endRef = undefined;
    } else {
      const last = this.points[this.points.length - 1];
      if (pointsEqual(last, snappedPt)) return;
      this.operators.push(this.chooseOperator(snapped));
      this.pathPoints.push(snappedPt);
      this.points = this.rebuildExpandedPoints();
      this.endRef = snapped.ref;
    }
  }

  onMouseMove(gridPt: GridPoint, _e: MouseEvent): void {
    this.hoverPoint = gridPt;
    if (this.points.length === 0) return;
    const snapped = this.snapConnection(gridPt);
    const snappedPt = snapped.point;
    const last = this.pathPoints[this.pathPoints.length - 1];
    let preview = [...this.points];
    if (last && !pointsEqual(last, snappedPt)) {
      const previewPathPoints = [...this.pathPoints, snappedPt];
      const previewOperators = [...this.operators, this.chooseOperator(snapped)];
      preview = this.rebuildExpandedPoints(previewPathPoints, previewOperators);
      this.ctx.ghost.setGhostElement(this.ctx.ghost.buildWireGhost(
        preview,
        previewPathPoints,
        this.startRef,
        snapped.ref,
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

  onMouseUp(_gridPt: GridPoint, _e: MouseEvent): void {}

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
    this.hoverPoint = null;
    this.ctx.ghost.setGhostElement(null);
  }

  deactivate(): void {
    if (this.points.length >= 2) this.finishWire();
    this.points = [];
    this.pathPoints = [];
    this.operators = [];
    this.startRef = undefined;
    this.endRef = undefined;
    this.hoverPoint = null;
    super.deactivate();
  }
}
