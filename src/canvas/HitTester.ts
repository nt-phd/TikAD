/**
 * Model-based hit testing — no DOM queries needed.
 * Works in grid coordinates (integer TikZ units).
 */
import type { ComponentDef, ComponentInstance, ConnectionRef, DrawingInstance, DrawPathInstance, GridPoint } from '../types';
import type { CircuitDocument } from '../model/CircuitDocument';
import type { ComponentRegistry } from '../definitions/ComponentRegistry';
import { getBipoleBodyMetrics, getPlacedComponentMetrics } from './ComponentGeometry';
import { componentProbeService } from './ComponentProbeService';
import { scaleState } from './ScaleState';

const HIT_THRESHOLD = 0.5; // grid units

function distPointToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointInRect(px: number, py: number, left: number, top: number, right: number, bottom: number): boolean {
  return px >= left && px <= right && py >= top && py <= bottom;
}

function distanceToRect(px: number, py: number, left: number, top: number, right: number, bottom: number): number {
  const dx = px < left ? left - px : px > right ? px - right : 0;
  const dy = py < top ? top - py : py > bottom ? py - bottom : 0;
  return Math.hypot(dx, dy);
}

function ccw(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = ccw(ax, ay, bx, by, cx, cy);
  const d2 = ccw(ax, ay, bx, by, dx, dy);
  const d3 = ccw(cx, cy, dx, dy, ax, ay);
  const d4 = ccw(cx, cy, dx, dy, bx, by);
  return (d1 === 0 && d2 === 0)
    ? Math.max(Math.min(ax, bx), Math.min(cx, dx)) <= Math.min(Math.max(ax, bx), Math.max(cx, dx)) &&
        Math.max(Math.min(ay, by), Math.min(cy, dy)) <= Math.min(Math.max(ay, by), Math.max(cy, dy))
    : (d1 <= 0 && d2 >= 0 || d1 >= 0 && d2 <= 0) && (d3 <= 0 && d4 >= 0 || d3 >= 0 && d4 <= 0);
}

function segmentIntersectsRect(
  ax: number, ay: number, bx: number, by: number,
  left: number, top: number, right: number, bottom: number,
): boolean {
  if (pointInRect(ax, ay, left, top, right, bottom) || pointInRect(bx, by, left, top, right, bottom)) {
    return true;
  }
  if (Math.max(ax, bx) < left || Math.min(ax, bx) > right || Math.max(ay, by) < top || Math.min(ay, by) > bottom) {
    return false;
  }
  return (
    segmentsIntersect(ax, ay, bx, by, left, top, right, top) ||
    segmentsIntersect(ax, ay, bx, by, right, top, right, bottom) ||
    segmentsIntersect(ax, ay, bx, by, right, bottom, left, bottom) ||
    segmentsIntersect(ax, ay, bx, by, left, bottom, left, top)
  );
}

function distanceToDrawing(drawing: DrawingInstance, pt: GridPoint): number {
  switch (drawing.kind) {
    case 'line':
    case 'arrow':
      return distPointToSegment(pt.x, pt.y, drawing.start.x, drawing.start.y, drawing.end.x, drawing.end.y);
    case 'text':
      return pointInRect(pt.x, pt.y, drawing.position.x - 0.5, drawing.position.y - 0.3, drawing.position.x + 0.5, drawing.position.y + 0.3)
        ? 0
        : Math.hypot(pt.x - drawing.position.x, pt.y - drawing.position.y);
    case 'rectangle': {
      const left = Math.min(drawing.start.x, drawing.end.x);
      const right = Math.max(drawing.start.x, drawing.end.x);
      const top = Math.min(drawing.start.y, drawing.end.y);
      const bottom = Math.max(drawing.start.y, drawing.end.y);
      if (pointInRect(pt.x, pt.y, left, top, right, bottom)) return 0;
      return Math.min(
        distPointToSegment(pt.x, pt.y, left, top, right, top),
        distPointToSegment(pt.x, pt.y, right, top, right, bottom),
        distPointToSegment(pt.x, pt.y, right, bottom, left, bottom),
        distPointToSegment(pt.x, pt.y, left, bottom, left, top),
      );
    }
    case 'circle': {
      const d = Math.hypot(pt.x - drawing.center.x, pt.y - drawing.center.y);
      return Math.abs(d - drawing.radius);
    }
    case 'bezier': {
      let best = Infinity;
      let prev = drawing.start;
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const mt = 1 - t;
        const sample = {
          x: mt ** 3 * drawing.start.x + 3 * mt ** 2 * t * drawing.control1.x + 3 * mt * t ** 2 * drawing.control2.x + t ** 3 * drawing.end.x,
          y: mt ** 3 * drawing.start.y + 3 * mt ** 2 * t * drawing.control1.y + 3 * mt * t ** 2 * drawing.control2.y + t ** 3 * drawing.end.y,
        };
        best = Math.min(best, distPointToSegment(pt.x, pt.y, prev.x, prev.y, sample.x, sample.y));
        prev = sample;
      }
      return best;
    }
  }
}

function getPlacedHitMetrics(
  comp: ComponentInstance,
  def: ComponentDef,
): {
  height: number;
  leftOffset: number;
  topOffset: number;
  width: number;
} {
  if (comp.type !== 'bipole') {
    const probe = componentProbeService.getPlacedGhostProbe(def, comp.rotation ?? 0, () => {});
    if (probe) {
      const gs = scaleState.effectiveGridSize;
      return {
        height: probe.bboxHeight / gs,
        leftOffset: probe.bboxLeft / gs,
        topOffset: probe.bboxTop / gs,
        width: probe.bboxWidth / gs,
      };
    }
  }

  const { width, height, leftOffset, topOffset } = getPlacedComponentMetrics(def, 1);
  return { width, height, leftOffset, topOffset };
}

function drawingIntersectsRect(drawing: DrawingInstance, left: number, top: number, right: number, bottom: number): boolean {
  switch (drawing.kind) {
    case 'line':
    case 'arrow':
      return segmentIntersectsRect(drawing.start.x, drawing.start.y, drawing.end.x, drawing.end.y, left, top, right, bottom);
    case 'text':
      return pointInRect(drawing.position.x, drawing.position.y, left, top, right, bottom);
    case 'rectangle': {
      const l = Math.min(drawing.start.x, drawing.end.x);
      const r = Math.max(drawing.start.x, drawing.end.x);
      const t = Math.min(drawing.start.y, drawing.end.y);
      const b = Math.max(drawing.start.y, drawing.end.y);
      return !(r < left || l > right || b < top || t > bottom);
    }
    case 'circle':
      return !(drawing.center.x + drawing.radius < left || drawing.center.x - drawing.radius > right || drawing.center.y + drawing.radius < top || drawing.center.y - drawing.radius > bottom);
    case 'bezier': {
      let prev = drawing.start;
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const mt = 1 - t;
        const sample = {
          x: mt ** 3 * drawing.start.x + 3 * mt ** 2 * t * drawing.control1.x + 3 * mt * t ** 2 * drawing.control2.x + t ** 3 * drawing.end.x,
          y: mt ** 3 * drawing.start.y + 3 * mt ** 2 * t * drawing.control1.y + 3 * mt * t ** 2 * drawing.control2.y + t ** 3 * drawing.end.y,
        };
        if (segmentIntersectsRect(prev.x, prev.y, sample.x, sample.y, left, top, right, bottom)) return true;
        prev = sample;
      }
      return false;
    }
  }
}

export class HitTester {
  connectionSnapEnabled = true;

  constructor(
    private doc: CircuitDocument,
    private registry: ComponentRegistry,
  ) {}

  findNearestConnectionTarget(gridPt: GridPoint, radius = 0.5, onResolved?: () => void): { point: GridPoint; ref?: ConnectionRef } | null {
    let best: { point: GridPoint; ref?: ConnectionRef } | null = null;
    let bestDist = radius;

    const consider = (pt: GridPoint, ref?: ConnectionRef) => {
      const d = Math.hypot(gridPt.x - pt.x, gridPt.y - pt.y);
      if (d <= bestDist) {
        bestDist = d;
        best = { point: pt, ref };
      }
    };

    for (const comp of this.doc.components) {
      if (comp.type === 'bipole') {
        consider(comp.start, comp.startRef);
        consider(comp.end, comp.endRef);
        continue;
      }

      if (comp.nodeName) {
        for (const [key, point] of this.doc.geometry.symbolPoints.entries()) {
          const referenceKey = `${comp.nodeName}.reference`;
          if (key === comp.nodeName && this.doc.geometry.symbolPoints.has(referenceKey)) continue;
          if (key !== comp.nodeName && !key.startsWith(`${comp.nodeName}.`)) continue;
          const anchor = key === comp.nodeName
            ? 'reference'
            : key.slice(comp.nodeName.length + 1);
          consider(point, { componentId: comp.id, nodeName: comp.nodeName, anchor });
        }
      } else {
        consider(comp.position);
      }
    }

    for (const wire of this.doc.wires) {
      if (wire.points.length === 0) continue;
      consider(wire.points[0], wire.startRef);
      consider(wire.points[wire.points.length - 1], wire.endRef);
    }

    for (const dp of this.doc.drawPaths) {
      if (dp.positionSequences.length === 0) continue;
      consider(dp.positionSequences[0].point, dp.startRef);
      consider(dp.positionSequences[dp.positionSequences.length - 1].point, dp.endRef);
    }

    return best;
  }

  findNearestConnectionPoint(gridPt: GridPoint, radius = 0.5, onResolved?: () => void): GridPoint | null {
    return this.findNearestConnectionTarget(gridPt, radius, onResolved)?.point ?? null;
  }

  /** Returns the id of the closest component/wire at gridPt, or null. */
  hitTest(gridPt: GridPoint): string | null {
    return this.hitTestAmong(gridPt);
  }

  hitTestAmong(gridPt: GridPoint, allowedIds?: Set<string>): string | null {
    let best: string | null = null;
    let bestDist = HIT_THRESHOLD;

    for (const comp of this.doc.components) {
      if (allowedIds && !allowedIds.has(comp.id)) continue;
      let d = Infinity;
      if (comp.type === 'bipole') {
        const def = this.registry.get(comp.defId);
        if (!def) continue;
        const dx = comp.end.x - comp.start.x;
        const dy = comp.end.y - comp.start.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) continue;
        const ux = dx / dist;
        const uy = dy / dist;
        const relX = gridPt.x - comp.start.x;
        const relY = gridPt.y - comp.start.y;
        const localX = relX * ux + relY * uy;
        const localY = -relX * uy + relY * ux;
        const { bodyWidth, bodyHeight, bodyX, bodyY } = getBipoleBodyMetrics(def, 1, dist);
        if (
          localX >= bodyX &&
          localX <= bodyX + bodyWidth &&
          localY >= bodyY &&
          localY <= bodyY + bodyHeight
        ) {
          d = 0;
        }
      } else if (comp.type === 'monopole' || comp.type === 'node') {
        const def = this.registry.get(comp.defId);
        if (!def) continue;
        const { width, height, leftOffset, topOffset } = getPlacedHitMetrics(comp, def);
        const angle = -(comp.rotation ?? 0) * Math.PI / 180;
        const relX = gridPt.x - comp.position.x;
        const relY = gridPt.y - comp.position.y;
        const localX = relX * Math.cos(angle) - relY * Math.sin(angle);
        const localY = relX * Math.sin(angle) + relY * Math.cos(angle);
        const left = leftOffset;
        const top = topOffset;
        d = distanceToRect(localX, localY, left, top, left + width, top + height);
      }
      if (d < bestDist) { bestDist = d; best = comp.id; }
    }

    for (const wire of this.doc.wires) {
      if (allowedIds && !allowedIds.has(wire.id)) continue;
      for (let i = 0; i < wire.points.length - 1; i++) {
        const a = wire.points[i];
        const b = wire.points[i + 1];
        const d = distPointToSegment(gridPt.x, gridPt.y, a.x, a.y, b.x, b.y);
        if (d < bestDist) { bestDist = d; best = wire.id; }
      }
    }

    for (const dp of this.doc.drawPaths) {
      if (allowedIds && !allowedIds.has(dp.id)) continue;
      for (let i = 0; i < dp.points.length - 1; i++) {
        const a = dp.points[i];
        const b = dp.points[i + 1];
        const d = distPointToSegment(gridPt.x, gridPt.y, a.x, a.y, b.x, b.y);
        if (d < bestDist) { bestDist = d; best = dp.id; }
      }
    }

    for (const drawing of this.doc.drawings) {
      if (allowedIds && !allowedIds.has(drawing.id)) continue;
      const d = distanceToDrawing(drawing, gridPt);
      if (d < bestDist) { bestDist = d; best = drawing.id; }
    }

    return best;
  }

  getElementsInRect(a: GridPoint, b: GridPoint): string[] {
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y, b.y);
    const ids: string[] = [];

    for (const comp of this.doc.components) {
      if (comp.type === 'bipole') {
        const def = this.registry.get(comp.defId);
        if (!def) continue;
        const dx = comp.end.x - comp.start.x;
        const dy = comp.end.y - comp.start.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) continue;
        const ux = dx / dist;
        const uy = dy / dist;
        const { bodyWidth, bodyHeight, bodyX, bodyY } = getBipoleBodyMetrics(def, 1, dist);
        const corners = [
          { x: bodyX, y: bodyY },
          { x: bodyX + bodyWidth, y: bodyY },
          { x: bodyX + bodyWidth, y: bodyY + bodyHeight },
          { x: bodyX, y: bodyY + bodyHeight },
        ].map((p) => ({
          x: comp.start.x + p.x * ux - p.y * uy,
          y: comp.start.y + p.x * uy + p.y * ux,
        }));
        const xs = corners.map((p) => p.x);
        const ys = corners.map((p) => p.y);
        if (!(Math.max(...xs) < left || Math.min(...xs) > right || Math.max(...ys) < top || Math.min(...ys) > bottom)) {
          ids.push(comp.id);
        }
        continue;
      }

      const def = this.registry.get(comp.defId);
      if (!def) continue;
      const { width, height, leftOffset, topOffset } = getPlacedHitMetrics(comp, def);
      const leftLocal = leftOffset;
      const topLocal = topOffset;
      const angle = (comp.rotation ?? 0) * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const corners = [
        { x: leftLocal, y: topLocal },
        { x: leftLocal + width, y: topLocal },
        { x: leftLocal + width, y: topLocal + height },
        { x: leftLocal, y: topLocal + height },
      ].map((p) => ({
        x: comp.position.x + p.x * cos - p.y * sin,
        y: comp.position.y + p.x * sin + p.y * cos,
      }));
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      if (!(Math.max(...xs) < left || Math.min(...xs) > right || Math.max(...ys) < top || Math.min(...ys) > bottom)) {
        ids.push(comp.id);
      }
    }

    for (const wire of this.doc.wires) {
      for (let i = 0; i < wire.points.length - 1; i++) {
        const p1 = wire.points[i];
        const p2 = wire.points[i + 1];
        if (segmentIntersectsRect(p1.x, p1.y, p2.x, p2.y, left, top, right, bottom)) {
          ids.push(wire.id);
          break;
        }
      }
    }

    for (const dp of this.doc.drawPaths) {
      for (let i = 0; i < dp.points.length - 1; i++) {
        const p1 = dp.points[i];
        const p2 = dp.points[i + 1];
        if (segmentIntersectsRect(p1.x, p1.y, p2.x, p2.y, left, top, right, bottom)) {
          ids.push(dp.id);
          break;
        }
      }
    }

    for (const drawing of this.doc.drawings) {
      if (drawingIntersectsRect(drawing, left, top, right, bottom)) ids.push(drawing.id);
    }

    return ids;
  }
}
