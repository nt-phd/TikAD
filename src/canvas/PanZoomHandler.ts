import { ZOOM_STEP } from '../constants';
import type { ViewTransform } from './ViewTransform';

export class PanZoomHandler {
  private isPanning = false;
  private lastX = 0;
  private lastY = 0;
  private spaceHeld = false;

  constructor(
    private svgRoot: SVGSVGElement,
    private view: ViewTransform,
    private onUpdate: () => void,
  ) {
    this.attachListeners();
  }

  private attachListeners(): void {
    this.svgRoot.addEventListener('wheel', this.onWheel, { passive: false });
    this.svgRoot.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.svgRoot.getBoundingClientRect();
    const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    this.view.zoomAt(screenPt, factor);
    this.onUpdate();
  };

  private onMouseDown = (e: MouseEvent): void => {
    // Middle button or space+left button
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      e.preventDefault();
      this.isPanning = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.svgRoot.style.cursor = 'grabbing';
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.isPanning) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.view.pan(dx, dy);
    this.onUpdate();
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (this.isPanning && (e.button === 1 || e.button === 0)) {
      this.isPanning = false;
      this.svgRoot.style.cursor = '';
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.spaceHeld = true;
      this.svgRoot.style.cursor = 'grab';
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.spaceHeld = false;
      if (!this.isPanning) {
        this.svgRoot.style.cursor = '';
      }
    }
  };

  get isCurrentlyPanning(): boolean {
    return this.isPanning || this.spaceHeld;
  }
}
