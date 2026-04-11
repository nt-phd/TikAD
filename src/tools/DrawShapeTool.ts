import { SELECTION_COLOR } from '../constants';
import { createCircle, createGroup, createLine, createPath, createRect, createText } from '../utils/svg';
import type { DrawingKind, GridPoint } from '../types';
import { BaseTool } from './BaseTool';
import { formatCoord } from '../codegen/CoordFormatter';
import { pointsEqual } from '../utils/geometry';
import { scaleState } from '../canvas/ScaleState';

const OVERLAY_STROKE_WIDTH = 0.5;
const GHOST_OPACITY = 0.8;
const CROSS_SIZE = 0.15;

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

export class DrawShapeTool extends BaseTool {
  private points: GridPoint[] = [];

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

  onMouseDown(gridPt: GridPoint, e: MouseEvent): void {
    if (e.button !== 0) return;
    this.points.push(gridPt);
    if (this.points.length < this.requiredPoints()) return;

    switch (this.kind) {
      case 'line':
        if (!pointsEqual(this.points[0], this.points[1])) {
          this.ctx.appendLine(`\\draw[thin] ${formatCoord(this.points[0])} -- ${formatCoord(this.points[1])};`);
        }
        break;
      case 'arrow':
        if (!pointsEqual(this.points[0], this.points[1])) {
          this.ctx.appendLine(`\\draw[->] ${formatCoord(this.points[0])} -- ${formatCoord(this.points[1])};`);
        }
        break;
      case 'text':
        this.ctx.appendLine(`\\node at ${formatCoord(this.points[0])} {Text};`);
        break;
      case 'rectangle':
        if (!pointsEqual(this.points[0], this.points[1])) {
          this.ctx.appendLine(`\\draw[thin] ${formatCoord(this.points[0])} rectangle ${formatCoord(this.points[1])};`);
        }
        break;
      case 'circle': {
        const dx = this.points[1].x - this.points[0].x;
        const dy = this.points[1].y - this.points[0].y;
        const radius = Math.hypot(dx, dy);
        if (radius > 0) this.ctx.appendLine(`\\draw[thin] ${formatCoord(this.points[0])} circle (${radius.toFixed(2)});`);
        break;
      }
      case 'bezier':
        this.ctx.appendLine(`\\draw[thin] ${formatCoord(this.points[0])} .. controls ${formatCoord(this.points[1])} and ${formatCoord(this.points[2])} .. ${formatCoord(this.points[3])};`);
        break;
    }

    this.points = [];
    this.ctx.ghost.setGhostElement(null);
  }

  onMouseMove(gridPt: GridPoint, _e: MouseEvent): void {
    if (this.points.length === 0) return;
    const gs = scaleState.effectiveGridSize;
    const g = createGroup('ghost-drawing');
    switch (this.kind) {
      case 'line':
      case 'arrow': {
        const a = this.points[0];
        g.appendChild(createLine(a.x * gs, a.y * gs, gridPt.x * gs, gridPt.y * gs, {
          stroke: SELECTION_COLOR,
          'stroke-width': OVERLAY_STROKE_WIDTH,
          'vector-effect': 'non-scaling-stroke',
          opacity: GHOST_OPACITY,
          'stroke-dasharray': '4 3',
        }));
        g.appendChild(crossAt(a));
        g.appendChild(crossAt(gridPt));
        break;
      }
      case 'text':
        g.appendChild(crossAt(this.points[0]));
        g.appendChild(createText(this.points[0].x * gs, this.points[0].y * gs - 10, 'Text', {
          fill: SELECTION_COLOR,
          'font-size': 12,
          opacity: GHOST_OPACITY,
        }));
        break;
      case 'rectangle': {
        const a = this.points[0];
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
        g.appendChild(crossAt(a));
        g.appendChild(crossAt(gridPt));
        break;
      }
      case 'circle': {
        const a = this.points[0];
        g.appendChild(createCircle(a.x * gs, a.y * gs, Math.hypot(gridPt.x - a.x, gridPt.y - a.y) * gs, {
          fill: 'none',
          stroke: SELECTION_COLOR,
          'stroke-width': OVERLAY_STROKE_WIDTH,
          'vector-effect': 'non-scaling-stroke',
          opacity: GHOST_OPACITY,
          'stroke-dasharray': '4 3',
        }));
        g.appendChild(crossAt(a));
        break;
      }
      case 'bezier': {
        const pts = [...this.points, gridPt];
        for (const p of pts) g.appendChild(crossAt(p));
        if (pts.length >= 2) {
          if (pts.length < 4) {
            for (let i = 0; i < pts.length - 1; i++) {
              g.appendChild(createLine(pts[i].x * gs, pts[i].y * gs, pts[i + 1].x * gs, pts[i + 1].y * gs, {
                stroke: SELECTION_COLOR,
                'stroke-width': OVERLAY_STROKE_WIDTH,
                'vector-effect': 'non-scaling-stroke',
                opacity: GHOST_OPACITY,
                'stroke-dasharray': '4 3',
              }));
            }
          } else {
            g.appendChild(createPath(
              `M ${pts[0].x * gs} ${pts[0].y * gs} C ${pts[1].x * gs} ${pts[1].y * gs}, ${pts[2].x * gs} ${pts[2].y * gs}, ${pts[3].x * gs} ${pts[3].y * gs}`,
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

  onMouseUp(_gridPt: GridPoint, _e: MouseEvent): void {}

  deactivate(): void {
    this.points = [];
    super.deactivate();
  }
}
