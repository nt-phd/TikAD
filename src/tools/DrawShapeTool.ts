import { SELECTION_COLOR } from '../constants';
import { createCircle, createGroup, createLine, createPath, createRect, createText } from '../utils/svg';
import type { ConnectionRef, DrawingKind, GridPoint } from '../types';
import { BaseTool, type SnapResult } from './BaseTool';
import { formatConnectionRef, formatEndpoint } from '../codegen/TikzEndpointFormatter';
import { pointsEqual } from '../utils/geometry';
import { scaleState } from '../canvas/ScaleState';

const OVERLAY_STROKE_WIDTH = 0.5;
const GHOST_OPACITY = 0.8;
const CROSS_SIZE = 0.15;

interface DrawHandle {
  point: GridPoint;
  ref?: ConnectionRef;
}

function crossAt(point: GridPoint) {
  const gs = scaleState.effectiveGridSize;
  const cx = point.x * gs;
  const cy = point.y * gs;
  const half = gs * CROSS_SIZE;
  const g = createGroup('ghost-cross');
  g.appendChild(createLine(cx - half, cy - half, cx + half, cy + half, {
    stroke: SELECTION_COLOR,
    'stroke-width': OVERLAY_STROKE_WIDTH,
    'vector-effect': 'non-scaling-stroke',
    opacity: GHOST_OPACITY,
  }));
  g.appendChild(createLine(cx - half, cy + half, cx + half, cy - half, {
    stroke: SELECTION_COLOR,
    'stroke-width': OVERLAY_STROKE_WIDTH,
    'vector-effect': 'non-scaling-stroke',
    opacity: GHOST_OPACITY,
  }));
  return g;
}

function ringAt(point: GridPoint, ref: ConnectionRef) {
  const gs = scaleState.effectiveGridSize;
  const g = createGroup('ghost-ring');
  g.setAttribute('data-pin-label', formatConnectionRef(ref));
  g.appendChild(createCircle(point.x * gs, point.y * gs, gs * CROSS_SIZE, {
    fill: 'none',
    stroke: SELECTION_COLOR,
    'stroke-width': OVERLAY_STROKE_WIDTH,
    'vector-effect': 'non-scaling-stroke',
    opacity: GHOST_OPACITY,
  }));
  return g;
}

function markerAt(handle: DrawHandle) {
  return handle.ref ? ringAt(handle.point, handle.ref) : crossAt(handle.point);
}

export class DrawShapeTool extends BaseTool {
  private points: DrawHandle[] = [];

  constructor(ctx: import('./BaseTool').ToolContext, private kind: DrawingKind) {
    super(ctx);
  }

  private requiredPoints(): number {
    switch (this.kind) {
      case 'text':
        return 1;
      case 'bezier':
        return 4;
      default:
        return 2;
    }
  }

  onMouseDown({ point: gridPt, ref }: SnapResult, e: MouseEvent): void {
    if (e.button !== 0) return;
    this.points.push({ point: gridPt, ref });
    if (this.points.length < this.requiredPoints()) return;

    switch (this.kind) {
      case 'line':
        if (!pointsEqual(this.points[0].point, this.points[1].point)) {
          this.ctx.appendLine(`\\draw ${formatEndpoint(this.points[0].point, this.points[0].ref)} -- ${formatEndpoint(this.points[1].point, this.points[1].ref)};`);
        }
        break;
      case 'arrow':
        if (!pointsEqual(this.points[0].point, this.points[1].point)) {
          this.ctx.appendLine(`\\draw[->] ${formatEndpoint(this.points[0].point, this.points[0].ref)} -- ${formatEndpoint(this.points[1].point, this.points[1].ref)};`);
        }
        break;
      case 'text':
        this.ctx.appendLine(`\\node at ${formatEndpoint(this.points[0].point, this.points[0].ref)} {Text};`);
        break;
      case 'rectangle':
        if (!pointsEqual(this.points[0].point, this.points[1].point)) {
          this.ctx.appendLine(`\\draw ${formatEndpoint(this.points[0].point, this.points[0].ref)} rectangle ${formatEndpoint(this.points[1].point, this.points[1].ref)};`);
        }
        break;
      case 'circle': {
        const dx = this.points[1].point.x - this.points[0].point.x;
        const dy = this.points[1].point.y - this.points[0].point.y;
        const radius = Math.hypot(dx, dy);
        if (radius > 0) this.ctx.appendLine(`\\draw ${formatEndpoint(this.points[0].point, this.points[0].ref)} circle (${radius.toFixed(2)});`);
        break;
      }
      case 'bezier':
        this.ctx.appendLine(`\\draw ${formatEndpoint(this.points[0].point, this.points[0].ref)} .. controls ${formatEndpoint(this.points[1].point, this.points[1].ref)} and ${formatEndpoint(this.points[2].point, this.points[2].ref)} .. ${formatEndpoint(this.points[3].point, this.points[3].ref)};`);
        break;
    }

    this.points = [];
    this.ctx.ghost.setGhostElement(null);
  }

  onMouseMove({ point: gridPt, ref }: SnapResult, _e: MouseEvent): void {
    if (this.points.length === 0) return;
    const gs = scaleState.effectiveGridSize;
    const g = createGroup('ghost-drawing');
    const hover: DrawHandle = { point: gridPt, ref };
    switch (this.kind) {
      case 'line':
      case 'arrow': {
        const a = this.points[0].point;
        g.appendChild(createLine(a.x * gs, a.y * gs, gridPt.x * gs, gridPt.y * gs, {
          stroke: SELECTION_COLOR,
          'stroke-width': OVERLAY_STROKE_WIDTH,
          'vector-effect': 'non-scaling-stroke',
          opacity: GHOST_OPACITY,
          'stroke-dasharray': '4 3',
        }));
        g.appendChild(markerAt(this.points[0]));
        g.appendChild(markerAt(hover));
        break;
      }
      case 'text':
        g.appendChild(markerAt(this.points[0]));
        g.appendChild(createText(this.points[0].point.x * gs, this.points[0].point.y * gs - 10, 'Text', {
          fill: SELECTION_COLOR,
          'font-size': 12,
          opacity: GHOST_OPACITY,
        }));
        break;
      case 'rectangle': {
        const a = this.points[0].point;
        g.appendChild(createRect(
          Math.min(a.x, gridPt.x) * gs,
          Math.min(a.y, gridPt.y) * gs,
          Math.abs(gridPt.x - a.x) * gs,
          Math.abs(gridPt.y - a.y) * gs,
          {
            fill: 'none',
            stroke: SELECTION_COLOR,
            'stroke-width': OVERLAY_STROKE_WIDTH,
            'vector-effect': 'non-scaling-stroke',
            opacity: GHOST_OPACITY,
            'stroke-dasharray': '4 3',
          },
        ));
        g.appendChild(markerAt(this.points[0]));
        g.appendChild(markerAt(hover));
        break;
      }
      case 'circle': {
        const a = this.points[0].point;
        g.appendChild(createCircle(a.x * gs, a.y * gs, Math.hypot(gridPt.x - a.x, gridPt.y - a.y) * gs, {
          fill: 'none',
          stroke: SELECTION_COLOR,
          'stroke-width': OVERLAY_STROKE_WIDTH,
          'vector-effect': 'non-scaling-stroke',
          opacity: GHOST_OPACITY,
          'stroke-dasharray': '4 3',
        }));
        g.appendChild(markerAt(this.points[0]));
        break;
      }
      case 'bezier': {
        const pts = [...this.points, hover];
        for (const p of pts) g.appendChild(markerAt(p));
        if (pts.length >= 2) {
          if (pts.length < 4) {
            for (let i = 0; i < pts.length - 1; i++) {
              g.appendChild(createLine(pts[i].point.x * gs, pts[i].point.y * gs, pts[i + 1].point.x * gs, pts[i + 1].point.y * gs, {
                stroke: SELECTION_COLOR,
                'stroke-width': OVERLAY_STROKE_WIDTH,
                'vector-effect': 'non-scaling-stroke',
                opacity: GHOST_OPACITY,
                'stroke-dasharray': '4 3',
              }));
            }
          } else {
            g.appendChild(createPath(
              `M ${pts[0].point.x * gs} ${pts[0].point.y * gs} C ${pts[1].point.x * gs} ${pts[1].point.y * gs}, ${pts[2].point.x * gs} ${pts[2].point.y * gs}, ${pts[3].point.x * gs} ${pts[3].point.y * gs}`,
              {
                stroke: SELECTION_COLOR,
                'stroke-width': OVERLAY_STROKE_WIDTH,
                'vector-effect': 'non-scaling-stroke',
                opacity: GHOST_OPACITY,
                'stroke-dasharray': '4 3',
              },
            ));
          }
        }
        break;
      }
    }
    this.ctx.ghost.setGhostElement(g);
  }

  onMouseUp(_snap: SnapResult, _e: MouseEvent): void {}

  deactivate(): void {
    this.points = [];
    super.deactivate();
  }
}
