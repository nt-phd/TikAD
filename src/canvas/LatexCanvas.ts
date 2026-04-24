/**
 * LatexCanvas — renders a LatexDocument by compiling it with pdflatex+pdf2svg.
 *
 * DOM structure inside `container`:
 *   div.world-transform          ← CSS transform: translate(panX,panY) scale(zoom)
 *     svg.grid-layer             ← grid dots, pointer-events:none
 *     div.latex-layer            ← injected SVG from pdflatex+pdf2svg, pointer-events:none
 *     svg.overlay-layer          ← grid, ghost, selection — receives mouse events
 *
 * Coordinate alignment:
 *   pdf2svg SVG uses pt units with transform="matrix(1,0,0,-1,tx,ty)" on all paths.
 *   The TikZ origin (0,0) corresponds to SVG point (tx, ty).
 *   We position the latex-layer so its SVG origin aligns with the world origin.
 *   Scale factor: GRID_SIZE px = TIKZ_PT_PER_UNIT pt  (20px per TikZ unit = 1cm)
 */

import type { GridPoint, RenderComponentBounds, RenderSymbolPoint, ScreenPoint } from '../types';
import type { LatexDocument } from '../model/LatexDocument';
import type { CircuitDocument } from '../model/CircuitDocument';
import type { ComponentRegistry } from '../definitions/ComponentRegistry';
import type { SelectionState } from '../model/SelectionState';
import { ViewTransform } from './ViewTransform';
import { SnapEngine } from './SnapEngine';
import { GhostRenderer, type GhostLatexPreview } from './GhostRenderer';
import { HitTester } from './HitTester';
import {
  GRID_SIZE, TIKZ_PT_PER_UNIT, RENDER_SERVER_URL,
  GRID_COLOR_MINOR, GRID_COLOR_MAJOR,
  MIN_ZOOM, MAX_ZOOM, ZOOM_STEP,
} from '../constants';
import { scaleState } from './ScaleState';
import { createSvgElement } from '../utils/svg';

// Base pt-to-px at zoom=1, scale=1: 20px per TikZ unit, 1 TikZ unit = TIKZ_PT_PER_UNIT pt
// The actual conversion must include tikzScale: PT_TO_PX * tikzScale
const BASE_PT_TO_PX = GRID_SIZE / TIKZ_PT_PER_UNIT;
const ZOOM_LEVELS = [1, 2, 3, 4, 5];

interface AnchorRenderRequest {
  anchor: string;
  componentId: string;
  defId: string;
  ghost: boolean;
  kind: 'reference' | 'pin' | 'anchor';
  names: string[];
  nodeName: string;
  role: string;
  snap: boolean;
}

interface RenderResponse {
  anchorError?: string;
  measuredBounds?: RenderComponentBounds[];
  measuredPoints?: RenderSymbolPoint[];
  error?: string;
  svg?: string;
  tx?: number;
  ty?: number;
}

function parseLineIndexFromComponentId(id: string): number | null {
  const match = /^line:(\d+):/.exec(id);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function extractNumberInputsFromOptions(optionsText?: string): number | null {
  if (!optionsText) return null;
  const match = /(?:^|,)\s*(?:\/tikz\/)?number inputs\s*=\s*(\d+)\b/i.exec(optionsText);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function extractScopedNumberInputs(body: string, maxLineIndex: number | null): number | null {
  const lines = body.split('\n');
  const limit = maxLineIndex == null ? lines.length - 1 : Math.min(maxLineIndex, lines.length - 1);
  let current: number | null = null;
  for (let index = 0; index <= limit; index += 1) {
    const line = lines[index];
    const ctikzMatches = line.matchAll(/\\ctikzset\s*\{([^}]*)\}/g);
    for (const match of ctikzMatches) {
      const value = extractNumberInputsFromOptions(match[1]);
      if (value != null) current = value;
    }
  }
  return current;
}

function getNumberedInputIndex(name: string): number | null {
  const match = /^(?:b?in)\s+(\d+)$/i.exec(name.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function normalizeLogicPortInputCount(value: number | null): number {
  if (value == null || value <= 0) return 2;
  return Math.max(2, value);
}

export class LatexCanvas {
  readonly view: ViewTransform;
  readonly snap: SnapEngine;
  readonly ghost: GhostRenderer;
  readonly hitTester: HitTester;

  private worldDiv: HTMLDivElement;
  private gridSvg: SVGSVGElement;
  private latexDiv: HTMLDivElement;
  private ghostLatexDiv: HTMLDivElement;
  private pinTooltipDiv: HTMLDivElement;
  readonly overlaySvg: SVGSVGElement;

  private renderInFlight = false;
  private renderPending = false;
  private errorBanner: HTMLDivElement | null = null;
  private infoBanner: HTMLDivElement | null = null;
  hasPerformedInitialFit = false;
  private renderedContentBounds: { left: number; top: number; width: number; height: number } | null = null;

  // Grid SVG elements
  private patternMinor!: SVGPatternElement;
  private patternMajor!: SVGPatternElement;
  private minorDot!: SVGCircleElement;
  private majorDot!: SVGCircleElement;
  private gridRectMinor!: SVGRectElement;
  private gridRectMajor!: SVGRectElement;
  private axesGroup!: SVGGElement;
  private axisXPath!: SVGPathElement;
  private axisYPath!: SVGPathElement;
  private interactionRect!: SVGRectElement;
  private ghostSvgNonce = 0;
  onAnchorGeometryMeasured: ((points: Map<string, RenderSymbolPoint>, bounds: Map<string, RenderComponentBounds>) => void) | null = null;

  // Pan/zoom
  private spaceHeld = false;
  private isPanning = false;
  private primaryPanEnabled = false;
  private lastPanX = 0;
  private lastPanY = 0;

  constructor(
    private container: HTMLElement,
    private latexDoc: LatexDocument,
    private circuitDoc: CircuitDocument,
    private registry: ComponentRegistry,
    selection: SelectionState,
  ) {
    this.view = new ViewTransform();
    this.snap = new SnapEngine();

    // World transform div — both layers move together
    this.worldDiv = document.createElement('div');
    this.worldDiv.className = 'world-transform';
    container.appendChild(this.worldDiv);

    // Grid layer below LaTeX render and interaction overlay
    this.gridSvg = createSvgElement('svg', {
      class: 'grid-layer',
      width: '100%', height: '100%',
    }) as SVGSVGElement;
    this.worldDiv.appendChild(this.gridSvg);

    // LaTeX layer (pointer-events: none — mouse goes to overlay)
    this.latexDiv = document.createElement('div');
    this.latexDiv.className = 'latex-layer';
    this.worldDiv.appendChild(this.latexDiv);

    this.ghostLatexDiv = document.createElement('div');
    this.ghostLatexDiv.className = 'ghost-latex-layer';
    this.worldDiv.appendChild(this.ghostLatexDiv);

    this.pinTooltipDiv = document.createElement('div');
    this.pinTooltipDiv.className = 'canvas-pin-tooltip';
    this.pinTooltipDiv.style.whiteSpace = 'pre-line';
    this.pinTooltipDiv.hidden = true;
    container.appendChild(this.pinTooltipDiv);

    // Overlay SVG (grid + ghost + selection)
    this.overlaySvg = createSvgElement('svg', {
      class: 'overlay-layer',
      width: '100%', height: '100%',
    }) as SVGSVGElement;
    this.worldDiv.appendChild(this.overlaySvg);

    const BIG = 20000;
    this.interactionRect = createSvgElement('rect', {
      x: -BIG, y: -BIG, width: BIG * 2, height: BIG * 2,
      fill: 'transparent',
      'pointer-events': 'all',
    }) as SVGRectElement;
    this.overlaySvg.appendChild(this.interactionRect);

    this.buildGrid();

    this.hitTester = new HitTester(circuitDoc, registry);
    this.ghost = new GhostRenderer(
      this.overlaySvg,
      circuitDoc,
      registry,
      selection,
      (preview) => this.setGhostLatexPreview(preview),
    );

    this.attachPanZoom();
    this.attachPinTooltip();

    this.refresh();
  }

  // ====== PUBLIC API ======

  eventToGrid(e: MouseEvent): GridPoint {
    const rect = this.container.getBoundingClientRect();
    const screen: ScreenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return this.view.screenToGrid(screen);
  }

  eventToGridRaw(e: MouseEvent): GridPoint {
    const rect = this.container.getBoundingClientRect();
    const screen: ScreenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = this.view.screenToWorld(screen);
    return this.view.worldToGrid(world);
  }

  isEventInsideCanvas(e: MouseEvent): boolean {
    const rect = this.container.getBoundingClientRect();
    return e.clientX >= rect.left
      && e.clientX <= rect.right
      && e.clientY >= rect.top
      && e.clientY <= rect.bottom;
  }

  refresh(): void {
    this.applyTransform();
    this.ghost.renderSelection();
  }

  updateGridScale(): void {
    const gs = scaleState.effectiveGridSize * scaleState.gridPitch;
    const majorSize = gs * scaleState.majorGridEvery;
    this.patternMinor.setAttribute('x', String(-gs / 2));
    this.patternMinor.setAttribute('y', String(-gs / 2));
    this.patternMinor.setAttribute('width', String(gs));
    this.patternMinor.setAttribute('height', String(gs));
    this.minorDot.setAttribute('cx', String(gs / 2));
    this.minorDot.setAttribute('cy', String(gs / 2));

    this.patternMajor.setAttribute('x', String(-majorSize / 2));
    this.patternMajor.setAttribute('y', String(-majorSize / 2));
    this.patternMajor.setAttribute('width', String(majorSize));
    this.patternMajor.setAttribute('height', String(majorSize));
    this.majorDot.setAttribute('cx', String(majorSize / 2));
    this.majorDot.setAttribute('cy', String(majorSize / 2));

    this.updateGridDotScale();
  }

  setGridVisible(visible: boolean): void {
    this.gridSvg.style.display = visible ? '' : 'none';
  }

  zoomIn(): void {
    const rect = this.container.getBoundingClientRect();
    const current = Math.round(this.view.zoom);
    const next = ZOOM_LEVELS.find((level) => level > current) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    this.view.setZoomAt({ x: rect.width / 2, y: rect.height / 2 }, next);
    this.refresh();
  }

  zoomOut(): void {
    const rect = this.container.getBoundingClientRect();
    const current = Math.round(this.view.zoom);
    const reversed = [...ZOOM_LEVELS].reverse();
    const next = reversed.find((level) => level < current) ?? ZOOM_LEVELS[0];
    this.view.setZoomAt({ x: rect.width / 2, y: rect.height / 2 }, next);
    this.refresh();
  }

  fitToScreen(): void {
    const content = this.renderedContentBounds;
    const rect = this.container.getBoundingClientRect();
    if (!content || content.width <= 0 || content.height <= 0 || rect.width <= 0 || rect.height <= 0) return;
    const padding = 24;
    const availableWidth = Math.max(1, rect.width - padding * 2);
    const availableHeight = Math.max(1, rect.height - padding * 2);
    const fitZoom = Math.min(availableWidth / content.width, availableHeight / content.height);
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitZoom));
    this.view.reset(clampedZoom);
    this.view.pan(
      (rect.width - content.width * clampedZoom) / 2 - content.left * clampedZoom,
      (rect.height - content.height * clampedZoom) / 2 - content.top * clampedZoom,
    );
    this.refresh();
  }

  /** Trigger a pdflatex render. Queues if one is already in flight. */
  scheduleRender(): void {
    if (this.renderInFlight) {
      this.renderPending = true;
      return;
    }
    this.doRender();
  }

  get isCurrentlyPanning(): boolean {
    return this.isPanning || this.spaceHeld;
  }

  setPrimaryPanEnabled(enabled: boolean): void {
    this.primaryPanEnabled = enabled;
    if (!enabled && !this.isPanning && !this.spaceHeld) {
      this.overlaySvg.style.cursor = '';
    }
  }

  getRenderedSvg(): string | null {
    const svgEl = this.latexDiv.querySelector('svg');
    return svgEl ? svgEl.outerHTML : null;
  }

  // ====== LATEX RENDER ======

  private async doRender(): Promise<void> {
    this.renderInFlight = true;
    this.renderPending = false;

    const latex = this.latexDoc.toFullSource();

    try {
      const anchorRequests = this.buildAnchorRenderRequests();
      const res = await fetch(`${RENDER_SERVER_URL}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex, anchors: anchorRequests }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json() as RenderResponse;
      if (data.svg) {
        this.injectSvg(data.svg, data.tx ?? 0, data.ty ?? 0);
        if (data.measuredPoints || data.measuredBounds) {
          const points = new Map<string, RenderSymbolPoint>();
          for (const point of data.measuredPoints ?? []) {
            points.set(point.key, {
              ...point,
              names: [...(point.names ?? [point.anchor])],
              point: { ...point.point },
            });
          }
          const bounds = new Map<string, RenderComponentBounds>();
          for (const bound of data.measuredBounds ?? []) {
            bounds.set(bound.componentId, { ...bound });
          }
          this.onAnchorGeometryMeasured?.(points, bounds);
        }
        if (data.anchorError) console.warn('[LatexCanvas] probe warnings:', data.anchorError);
        this.showError(null);
      } else {
        console.warn('[LatexCanvas] render error:', data.error);
        this.showError(data.error ?? 'LaTeX error');
      }
    } catch (e) {
      console.warn('[LatexCanvas] server unreachable:', e);
      this.showError('Render server unreachable. Start it with: npm run dev:render');
    } finally {
      this.renderInFlight = false;
      if (this.renderPending) this.doRender();
    }
  }

  private buildAnchorRenderRequests(): AnchorRenderRequest[] {
    const seen = new Set<string>();
    const requests: AnchorRenderRequest[] = [];
    for (const comp of this.circuitDoc.components) {
      if (comp.type === 'bipole' || !comp.nodeName) continue;
      const def = this.registry.get(comp.defId);
      if (!def) continue;
      const geometry = def.geometry;
      const instanceNumberInputs =
        extractNumberInputsFromOptions(comp.props.options)
        ?? extractScopedNumberInputs(this.latexDoc.body, parseLineIndexFromComponentId(comp.id));
      const effectiveNumberInputs = normalizeLogicPortInputCount(instanceNumberInputs);
      const shouldIncludePoint = (point: { name: string; names: string[] }) => {
        const numberedIndices = [point.name, ...point.names]
          .map((name) => getNumberedInputIndex(name))
          .filter((value): value is number => value != null);
        if (numberedIndices.length === 0) return true;
        return numberedIndices.some((value) => value <= effectiveNumberInputs);
      };
      const referencePoint = geometry?.reference ?? {
        name: 'reference',
        tikz: 'reference',
        role: 'reference',
        required: true,
        snap: false,
        ghost: true,
        sources: [],
      };
      const groupedPinNames = new Set((geometry?.pinGroups ?? []).flatMap((group) => group.names));
      const points = [
        { ...referencePoint, kind: 'reference' as const, names: ['reference'] },
        ...(geometry?.pinGroups ?? []).map((group) => {
          const representative = geometry?.pins.find((point) => point.name === group.names[0]);
          const fallback = geometry?.pins.find((point) => group.names.includes(point.name));
          const point = representative ?? fallback;
          return point ? { ...point, kind: 'pin' as const, names: [...group.names] } : null;
        })
          .filter((point): point is NonNullable<typeof point> => Boolean(point))
          .filter((point) => shouldIncludePoint(point)),
        ...(geometry?.pins ?? [])
          .filter((point) => !groupedPinNames.has(point.name))
          .filter((point) => shouldIncludePoint({ name: point.name, names: [point.name] }))
          .map((point) => ({ ...point, kind: 'pin' as const, names: [point.name] })),
      ];
      for (const point of points) {
        const anchor = point.kind === 'reference' ? 'reference' : (point.tikz || point.name);
        if (!anchor || anchor === 'START' || anchor === 'END') continue;
        const key = point.kind === 'reference' ? comp.nodeName : `${comp.nodeName}.${anchor}`;
        if (seen.has(key)) continue;
        seen.add(key);
        requests.push({
          nodeName: comp.nodeName,
          anchor,
          componentId: comp.id,
          defId: comp.defId,
          kind: point.kind,
          names: [...point.names],
          role: point.role,
          snap: point.snap,
          ghost: point.ghost,
        });
      }
    }
    return requests;
  }

  private injectSvg(svgText: string, tx: number, ty: number): void {
    this.latexDiv.innerHTML = svgText;
    const svgEl = this.latexDiv.querySelector('svg');
    if (!svgEl) return;

    // pt-to-px must account for tikzpicture scale so the SVG aligns with
    // the overlay grid (which uses effectiveGridSize = GRID_SIZE × tikzScale).
    // pdflatex already bakes the scale into the pt coordinates, so we do NOT
    // divide by tikzScale here — we just use the base conversion.
    // The overlay grid tile = GRID_SIZE × tikzScale px, and the SVG pt coords
    // already represent scaled TikZ units, so BASE_PT_TO_PX is correct as-is.
    const ptToPx = BASE_PT_TO_PX;

    // Parse viewBox dimensions (in pt) and convert to px
    const vb = svgEl.getAttribute('viewBox')?.split(/\s+/).map(Number);
    if (vb && vb.length >= 4) {
      const widthPx = vb[2] * ptToPx;
      const heightPx = vb[3] * ptToPx;
      svgEl.style.width  = widthPx + 'px';
      svgEl.style.height = heightPx + 'px';
      this.renderedContentBounds = {
        left: -tx * ptToPx,
        top: -ty * ptToPx,
        width: widthPx,
        height: heightPx,
      };
    }
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.style.overflow = 'visible';

    // Align TikZ(0,0) with world origin
    this.latexDiv.style.left = (-tx * ptToPx) + 'px';
    this.latexDiv.style.top  = (-ty * ptToPx) + 'px';

    if (!this.hasPerformedInitialFit) {
      this.hasPerformedInitialFit = true;
      requestAnimationFrame(() => this.fitToScreen());
    }
  }

  private setGhostLatexPreview(preview: GhostLatexPreview | null): void {
    this.ghostLatexDiv.innerHTML = '';
    if (!preview) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'ghost-latex-probe';
    const ptToPx = BASE_PT_TO_PX;
    const originX = preview.tx * ptToPx;
    const originY = preview.ty * ptToPx;
    wrapper.style.left = `${preview.anchorX - originX}px`;
    wrapper.style.top = `${preview.anchorY - originY}px`;
    wrapper.style.opacity = String(preview.opacity);
    wrapper.style.transformOrigin = `${originX}px ${originY}px`;
    if (preview.angleDeg) wrapper.style.transform = `rotate(${preview.angleDeg}deg)`;

    wrapper.innerHTML = this.namespaceSvgMarkup(preview.svgMarkup);
    const svgEl = wrapper.querySelector('svg');
    if (!svgEl) return;

    const vb = svgEl.getAttribute('viewBox')?.split(/\s+/).map(Number);
    if (vb && vb.length >= 4) {
      svgEl.style.width = `${vb[2] * ptToPx}px`;
      svgEl.style.height = `${vb[3] * ptToPx}px`;
    }
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.style.display = 'block';
    svgEl.style.overflow = 'visible';

    this.ghostLatexDiv.appendChild(wrapper);
  }

  private namespaceSvgMarkup(svgMarkup: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return svgMarkup;

    const prefix = `ghost-${++this.ghostSvgNonce}-`;
    const idMap = new Map<string, string>();
    for (const el of svg.querySelectorAll('[id]')) {
      const oldId = el.getAttribute('id');
      if (!oldId) continue;
      const newId = `${prefix}${oldId}`;
      idMap.set(oldId, newId);
      el.setAttribute('id', newId);
    }

    const rewriteValue = (value: string | null): string | null => {
      if (!value) return value;
      let next = value;
      for (const [oldId, newId] of idMap) {
        next = next.replaceAll(`url(#${oldId})`, `url(#${newId})`);
        next = next.replaceAll(`#${oldId}`, `#${newId}`);
      }
      return next;
    };

    for (const el of svg.querySelectorAll('*')) {
      for (const attr of ['href', 'xlink:href', 'clip-path', 'fill', 'filter', 'mask', 'marker-start', 'marker-mid', 'marker-end']) {
        const value = el.getAttribute(attr);
        const rewritten = rewriteValue(value);
        if (rewritten && rewritten !== value) el.setAttribute(attr, rewritten);
      }
      const style = el.getAttribute('style');
      const rewrittenStyle = rewriteValue(style);
      if (rewrittenStyle && rewrittenStyle !== style) el.setAttribute('style', rewrittenStyle);
    }

    return svg.outerHTML;
  }

  // ====== ERROR BANNER ======

  private showError(message: string | null): void {
    if (!message) {
      if (this.errorBanner) { this.errorBanner.remove(); this.errorBanner = null; }
      return;
    }
    if (!this.errorBanner) {
      this.errorBanner = document.createElement('div');
      this.errorBanner.className = 'latex-error-banner';
      this.container.appendChild(this.errorBanner);
    }
    // Show only the first ! error line for brevity
    const firstError = message.split('\n').find(l => l.startsWith('!')) ?? message;
    this.errorBanner.textContent = firstError.slice(0, 120);
  }

  showInfoBanner(message: string | null): void {
    if (!message) {
      if (this.infoBanner) { this.infoBanner.remove(); this.infoBanner = null; }
      return;
    }
    if (!this.infoBanner) {
      this.infoBanner = document.createElement('div');
      this.infoBanner.className = 'latex-info-banner';
      this.container.appendChild(this.infoBanner);
    }
    this.infoBanner.textContent = message;
  }

  // ====== GRID ======

  private buildGrid(): void {
    const defs = createSvgElement('defs') as SVGDefsElement;
    const gs = scaleState.effectiveGridSize * scaleState.gridPitch;
    const majorSize = gs * scaleState.majorGridEvery;

    this.patternMinor = createSvgElement('pattern', {
      id: 'lc-grid-minor',
      patternUnits: 'userSpaceOnUse',
      x: -gs / 2,
      y: -gs / 2,
      width: gs,
      height: gs,
    }) as SVGPatternElement;
    this.minorDot = createSvgElement('circle', {
      cx: gs / 2,
      cy: gs / 2,
      r: 1,
      fill: GRID_COLOR_MINOR,
    }) as SVGCircleElement;
    this.patternMinor.appendChild(this.minorDot);
    defs.appendChild(this.patternMinor);

    this.patternMajor = createSvgElement('pattern', {
      id: 'lc-grid-major',
      patternUnits: 'userSpaceOnUse',
      x: -majorSize / 2,
      y: -majorSize / 2,
      width: majorSize,
      height: majorSize,
    }) as SVGPatternElement;
    this.majorDot = createSvgElement('circle', {
      cx: majorSize / 2,
      cy: majorSize / 2,
      r: 1.75,
      fill: GRID_COLOR_MAJOR,
    }) as SVGCircleElement;
    this.patternMajor.appendChild(this.majorDot);
    defs.appendChild(this.patternMajor);

    this.gridSvg.appendChild(defs);

    const BIG = 20000;
    this.gridRectMinor = createSvgElement('rect', {
      x: -BIG,
      y: -BIG,
      width: BIG * 2,
      height: BIG * 2,
      fill: 'url(#lc-grid-minor)',
    }) as SVGRectElement;
    this.gridRectMajor = createSvgElement('rect', {
      x: -BIG,
      y: -BIG,
      width: BIG * 2,
      height: BIG * 2,
      fill: 'url(#lc-grid-major)',
    }) as SVGRectElement;
    this.gridSvg.appendChild(this.gridRectMinor);
    this.gridSvg.appendChild(this.gridRectMajor);

    this.axesGroup = createSvgElement('g', {
      class: 'grid-origin-axes',
      transform: 'translate(0,0)',
    }) as SVGGElement;

    this.axisXPath = createSvgElement('path', {
      fill: 'none',
      stroke: '#d32f2f',
      opacity: '0.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }) as SVGPathElement;
    this.axisYPath = createSvgElement('path', {
      fill: 'none',
      stroke: '#1565c0',
      opacity: '0.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }) as SVGPathElement;
    this.axesGroup.appendChild(this.axisXPath);
    this.axesGroup.appendChild(this.axisYPath);
    this.gridSvg.appendChild(this.axesGroup);
    this.updateGridDotScale();
  }

  // ====== PAN/ZOOM ======

  private applyTransform(): void {
    this.worldDiv.style.transform =
      `translate(${this.view.panX}px, ${this.view.panY}px) scale(${this.view.zoom})`;
    this.updateGridDotScale();
  }

  private updateGridDotScale(): void {
    const minorRadius = 1 / this.view.zoom;
    const majorRadius = 1.75 / this.view.zoom;
    this.minorDot?.setAttribute('r', String(minorRadius));
    this.majorDot?.setAttribute('r', String(majorRadius));

    const invZoom = 1 / this.view.zoom;
    const axisLength = 24 * invZoom;
    const arrow = 8 * invZoom;
    const strokeWidth = 1 * invZoom;

    this.axesGroup?.setAttribute('transform', 'translate(0,0)');
    this.axisXPath?.setAttribute('d', `M 0 0 L ${axisLength} 0 M ${axisLength - arrow} ${-arrow * 0.6} L ${axisLength} 0 L ${axisLength - arrow} ${arrow * 0.6}`);
    this.axisYPath?.setAttribute('d', `M 0 0 L 0 ${-axisLength} M ${-arrow * 0.6} ${-axisLength + arrow} L 0 ${-axisLength} L ${arrow * 0.6} ${-axisLength + arrow}`);
    this.axisXPath?.setAttribute('stroke-width', String(strokeWidth));
    this.axisYPath?.setAttribute('stroke-width', String(strokeWidth));
  }

  private attachPanZoom(): void {
    const el = this.overlaySvg;

    el.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const rect = this.container.getBoundingClientRect();
      const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      this.view.zoomAt(screenPt, factor);
      this.refresh();
    }, { passive: false });

    el.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && (this.spaceHeld || this.primaryPanEnabled))) {
        e.preventDefault();
        this.isPanning = true;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
        el.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isPanning) return;
      this.view.pan(e.clientX - this.lastPanX, e.clientY - this.lastPanY);
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.refresh();
    });

    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (this.isPanning && (e.button === 1 || e.button === 0)) {
        this.isPanning = false;
        el.style.cursor = this.spaceHeld || this.primaryPanEnabled ? 'grab' : '';
      }
    });

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Space') { this.spaceHeld = true; el.style.cursor = 'grab'; }
    });
    window.addEventListener('keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        this.spaceHeld = false;
        if (!this.isPanning) el.style.cursor = '';
      }
    });
  }

  private attachPinTooltip(): void {
    const hideTooltip = () => {
      this.pinTooltipDiv.hidden = true;
      this.pinTooltipDiv.textContent = '';
    };

    this.overlaySvg.addEventListener('mousemove', (e: MouseEvent) => {
      const target = e.target as Element | null;
      const marker = target?.closest?.('[data-pin-label]') as SVGElement | null;
      const label = marker?.getAttribute('data-pin-label');
      if (!marker || !label) {
        hideTooltip();
        return;
      }
      const containerRect = this.container.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      const markerCenterX = markerRect.left - containerRect.left + markerRect.width / 2;
      const markerTopY = markerRect.top - containerRect.top;
      this.pinTooltipDiv.hidden = false;
      this.pinTooltipDiv.textContent = label;
      this.pinTooltipDiv.style.left = `${markerCenterX}px`;
      this.pinTooltipDiv.style.top = `${markerTopY - 2}px`;
      this.pinTooltipDiv.style.transform = 'translate(-50%, -100%)';
    });

    this.overlaySvg.addEventListener('mouseleave', hideTooltip);
    this.overlaySvg.addEventListener('mousedown', hideTooltip);
  }
}
