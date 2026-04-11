import type { GridPoint, ScreenPoint } from '../types';
import { MIN_ZOOM, MAX_ZOOM } from '../constants';
import { scaleState } from './ScaleState';

export class ViewTransform {
  private _panX = 0;
  private _panY = 0;
  private _zoom = 2.0;

  get panX(): number { return this._panX; }
  get panY(): number { return this._panY; }
  get zoom(): number { return this._zoom; }

  private get gs(): number { return scaleState.effectiveGridSize; }

  screenToWorld(screen: ScreenPoint): { x: number; y: number } {
    return {
      x: (screen.x - this._panX) / this._zoom,
      y: (screen.y - this._panY) / this._zoom,
    };
  }

  worldToGrid(world: { x: number; y: number }): GridPoint {
    return { x: world.x / this.gs, y: world.y / this.gs };
  }

  screenToGrid(screen: ScreenPoint): GridPoint {
    const world = this.screenToWorld(screen);
    const raw = this.worldToGrid(world);
    return {
      x: Math.round(raw.x / scaleState.gridPitch) * scaleState.gridPitch,
      y: Math.round(raw.y / scaleState.gridPitch) * scaleState.gridPitch,
    };
  }

  gridToScreen(grid: GridPoint): ScreenPoint {
    return {
      x: grid.x * this.gs * this._zoom + this._panX,
      y: grid.y * this.gs * this._zoom + this._panY,
    };
  }

  gridToWorld(grid: GridPoint): { x: number; y: number } {
    return { x: grid.x * this.gs, y: grid.y * this.gs };
  }

  pan(dx: number, dy: number): void {
    this._panX += dx;
    this._panY += dy;
  }

  reset(zoom = 2.0): void {
    this._panX = 0;
    this._panY = 0;
    this._zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  }

  zoomAt(screenPt: ScreenPoint, factor: number): void {
    const oldZoom = this._zoom;
    this._zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this._zoom * factor));
    const ratio = this._zoom / oldZoom;
    this._panX = screenPt.x - ratio * (screenPt.x - this._panX);
    this._panY = screenPt.y - ratio * (screenPt.y - this._panY);
  }

  setZoomAt(screenPt: ScreenPoint, zoom: number): void {
    const target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    const factor = target / this._zoom;
    this.zoomAt(screenPt, factor);
  }

  toSvgTransform(): string {
    return `translate(${this._panX}, ${this._panY}) scale(${this._zoom})`;
  }

  get zoomPercent(): number {
    return Math.round(this._zoom * 100);
  }
}
