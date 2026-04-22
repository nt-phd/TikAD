import { GRID_SIZE, RENDER_SERVER_URL, TIKZ_PT_PER_UNIT } from '../constants';
import type { BipoleInstance, ComponentDef } from '../types';

const PT_TO_PX = GRID_SIZE / TIKZ_PT_PER_UNIT;
const MARKER_PALETTE = ['#ff006e', '#00c853', '#2962ff', '#ffab00', '#aa00ff', '#00b8d4', '#ff5722', '#8bc34a'];

type LatexSourceGetter = () => { body: string; preamble: string };

interface ProbeMarkerSpec {
  color: string;
  latexColorName: string;
  name: string;
  target: string;
}

interface ProbeRequest {
  cacheKey: string;
  displayLatex?: string;
  latex: string;
  markers: ProbeMarkerSpec[];
  persist?: boolean;
}

export interface ComponentRenderProbe {
  bboxHeight: number;
  bboxLeft: number;
  bboxTop: number;
  bboxWidth: number;
  pinOffsets: Array<{ name: string; x: number; y: number }>;
  svgMarkup: string;
  tx: number;
  ty: number;
}

const PROBE_STORAGE_PREFIX = 'circuitikz:probe:v1:';

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function getStorageKey(cacheKey: string): string {
  return `${PROBE_STORAGE_PREFIX}${hashString(cacheKey)}`;
}

function readPersistedProbe(cacheKey: string): ComponentRenderProbe | null {
  try {
    const raw = window.localStorage.getItem(getStorageKey(cacheKey));
    if (!raw) return null;
    return JSON.parse(raw) as ComponentRenderProbe;
  } catch {
    return null;
  }
}

function writePersistedProbe(cacheKey: string, probe: ComponentRenderProbe | null): void {
  try {
    if (!probe) return;
    window.localStorage.setItem(getStorageKey(cacheKey), JSON.stringify(probe));
  } catch {
    // Ignore quota/storage errors.
  }
}

export function pickPrimaryPin<T extends { name: string; x: number; y: number }>(pins: T[]): T | null {
  if (pins.length === 0) return null;
  const preferredNames = ['IN+', '+', 'in+', 'in', 'west', 'left', 'reference', 'center', 'START'];
  for (const name of preferredNames) {
    const match = pins.find((pin) => pin.name === name);
    if (match) return match;
  }
  return [...pins].sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x;
    if (a.y !== b.y) return a.y - b.y;
    return a.name.localeCompare(b.name);
  })[0] ?? null;
}

function extractTikzPictureOptions(body: string): string {
  const match = body.match(/\\begin\{(?:tikzpicture|circuitikz)\}\s*(\[[^\]]*\])?/);
  return match?.[1] ?? '';
}

function normalizeColor(value: string | null): string {
  const input = (value ?? '').trim().toLowerCase();
  if (!input) return '';
  const hex3 = input.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    const [r, g, b] = hex3[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const hex6 = input.match(/^#([0-9a-f]{6})$/i);
  if (hex6) return `#${hex6[1]}`;
  const rgb = input.match(/^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    const toHex = (n: string) => Math.max(0, Math.min(255, Number.parseInt(n, 10))).toString(16).padStart(2, '0');
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
  }
  const rgbPercent = input.match(/^rgba?\(([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
  if (rgbPercent) {
    const toHex = (n: string) => {
      const value = Math.max(0, Math.min(255, Math.round((Number.parseFloat(n) / 100) * 255)));
      return value.toString(16).padStart(2, '0');
    };
    return `#${toHex(rgbPercent[1])}${toHex(rgbPercent[2])}${toHex(rgbPercent[3])}`;
  }
  return input.replace(/\s+/g, '');
}


function assignMarkerColors(pinNames: string[]): ProbeMarkerSpec[] {
  return pinNames.map((name, index) => ({
    name,
    target: name,
    color: MARKER_PALETTE[index % MARKER_PALETTE.length],
    latexColorName: `probeMarker${index}`,
  }));
}

function buildMarkerLines(nodeName: string, markers: ProbeMarkerSpec[]): string[] {
  return markers.map((marker) =>
    marker.target
      ? `\\fill[${marker.latexColorName}] (${nodeName}.${marker.target}) circle[radius=0.08];`
      : `\\fill[${marker.latexColorName}] (0,0) circle[radius=0.08];`);
}

function buildMarkerColorDefs(markers: ProbeMarkerSpec[]): string[] {
  return markers.map((marker) =>
    `\\definecolor{${marker.latexColorName}}{HTML}{${marker.color.slice(1).toUpperCase()}}`);
}


function measureProbeSvg(
  svgText: string,
  markers: ProbeMarkerSpec[],
): ComponentRenderProbe | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) return null;

  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  host.appendChild(document.importNode(svg, true));
  document.body.appendChild(host);

  try {
    const liveSvg = host.querySelector('svg')!;
    const markerColorMap = new Map(markers.map((m) => [normalizeColor(m.color), m]));

    // Identify marker elements by color, measure their centers, then remove them.
    const pinCenters = new Map<string, { x: number; y: number }>();
    for (const el of liveSvg.querySelectorAll<SVGGraphicsElement>('circle, path, ellipse, rect')) {
      const fill = normalizeColor(el.getAttribute('fill'));
      const marker = markerColorMap.get(fill);
      if (!marker) continue;
      const b = el.getBBox();
      pinCenters.set(marker.name, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
      el.remove();
    }

    // Measure the body bbox from the SVG root — all transforms already applied.
    const bodyBbox = liveSvg.getBBox();
    if (!bodyBbox.width && !bodyBbox.height) return null;

    const anchor = pinCenters.get('__REFERENCE__');
    if (!anchor) return null;

    const pinOffsets = markers
      .filter((m) => m.name !== '__REFERENCE__')
      .flatMap((m) => {
        const pin = pinCenters.get(m.name);
        if (!pin) return [];
        return [{ name: m.name, x: (pin.x - anchor.x) * PT_TO_PX, y: (pin.y - anchor.y) * PT_TO_PX }];
      });

    return {
      bboxLeft: (bodyBbox.x - anchor.x) * PT_TO_PX,
      bboxTop: (bodyBbox.y - anchor.y) * PT_TO_PX,
      bboxWidth: bodyBbox.width * PT_TO_PX,
      bboxHeight: bodyBbox.height * PT_TO_PX,
      pinOffsets,
      svgMarkup: liveSvg.outerHTML,
      tx: 0,
      ty: 0,
    };
  } finally {
    host.remove();
  }
}


function buildPlacedGhostProbe(source: { body: string; preamble: string }, def: ComponentDef, rotation: number): ProbeRequest {
  const tikzOptions = extractTikzPictureOptions(source.body);
  const nodeName = 'probe';
  const rotationOpt = rotation ? `, rotate=${rotation}` : '';
  const probeLine = def.placementType === 'node'
    ? `\\node[${def.tikzName}${rotationOpt}](${nodeName}) at (0,0) {};`
    : `\\draw (0,0) node[${def.tikzName}${rotationOpt}](${nodeName}) {};`;
  const pinNames = (def.symbolPins ?? [])
    .map((pin) => pin.name)
    .filter((name) => !['START', 'END', 'reference', 'center'].includes(name));
  if (def.scaleFamily === 'amplifiers' && !pinNames.includes('out')) pinNames.push('out');
  const markers = assignMarkerColors(['__REFERENCE__', ...(pinNames.length > 0 ? pinNames : ['reference'])]);
  markers[0].target = '';
  const markerLines = buildMarkerLines(nodeName, markers);
  if (pinNames.length === 0) {
    markerLines.splice(1, markerLines.length - 1, `\\fill[${markers[1].latexColorName}] (0,0) circle[radius=0.08];`);
  }
  const displayLatex = [
    '\\documentclass[tikz,border=2pt]{standalone}',
    source.preamble,
    '\\begin{document}',
    `\\begin{tikzpicture}${tikzOptions}`,
    probeLine,
    '\\end{tikzpicture}',
    '\\end{document}',
  ].join('\n');

  return {
    cacheKey: `ghost-placed:${source.preamble}\n@@\n${tikzOptions}\n@@\n${def.id}\n@@\n${rotation}`,
    displayLatex,
    markers,
    latex: [
      '\\documentclass[tikz,border=2pt]{standalone}',
      source.preamble,
      ...buildMarkerColorDefs(markers),
      '\\begin{document}',
      `\\begin{tikzpicture}${tikzOptions}`,
      probeLine,
      ...markerLines,
      '\\end{tikzpicture}',
      '\\end{document}',
    ].join('\n'),
  };
}


function buildBipoleGhostProbe(source: { body: string; preamble: string }, def: ComponentDef, comp: BipoleInstance): ProbeRequest {
  const tikzOptions = extractTikzPictureOptions(source.body);
  const dist = Math.hypot(comp.end.x - comp.start.x, comp.end.y - comp.start.y);
  const markers: ProbeMarkerSpec[] = [
    { name: 'START', target: '', color: MARKER_PALETTE[0], latexColorName: 'probeMarker0' },
    { name: 'END', target: '', color: MARKER_PALETTE[1], latexColorName: 'probeMarker1' },
  ];
  const cleanDraw = `\\draw (0,0) to[${def.tikzName}] (${dist},0);`;
  const displayLatex = [
    '\\documentclass[tikz,border=2pt]{standalone}',
    source.preamble,
    '\\begin{document}',
    `\\begin{tikzpicture}${tikzOptions}`,
    cleanDraw,
    '\\end{tikzpicture}',
    '\\end{document}',
  ].join('\n');

  return {
    cacheKey: `ghost-bipole:${source.preamble}\n@@\n${tikzOptions}\n@@\n${def.id}\n@@\n${dist}`,
    displayLatex,
    markers,
    latex: [
      '\\documentclass[tikz,border=2pt]{standalone}',
      source.preamble,
      ...buildMarkerColorDefs(markers),
      '\\begin{document}',
      `\\begin{tikzpicture}${tikzOptions}`,
      cleanDraw,
      `\\fill[${markers[0].latexColorName}] (0,0) circle[radius=0.08];`,
      `\\fill[${markers[1].latexColorName}] (${dist},0) circle[radius=0.08];`,
      '\\end{tikzpicture}',
      '\\end{document}',
    ].join('\n'),
  };
}

export class ComponentProbeService {
  private getLatexSource: LatexSourceGetter | null = null;
  private cache = new Map<string, ComponentRenderProbe | null>();
  private inflight = new Map<string, Promise<ComponentRenderProbe | null>>();
  private inflightCallbacks = new Map<string, Set<() => void>>();

  configure(getLatexSource: LatexSourceGetter): void {
    this.getLatexSource = getLatexSource;
  }

  invalidate(): void {
    this.cache.clear();
    this.inflight.clear();
    this.inflightCallbacks.clear();
  }

getBipoleGhostProbe(def: ComponentDef, comp: BipoleInstance, onResolved: () => void, persist = false): ComponentRenderProbe | null {
    if (!this.getLatexSource) return null;
    const source = this.getLatexSource();
    const request = buildBipoleGhostProbe(source, def, comp);
    request.persist = persist;
    return this.getOrQueueProbe(request, onResolved);
  }

  getPlacedGhostProbe(def: ComponentDef, rotation: number, onResolved: () => void, persist = false): ComponentRenderProbe | null {
    if (!this.getLatexSource) return null;
    const source = this.getLatexSource();
    const request = buildPlacedGhostProbe(source, def, rotation);
    request.persist = persist;
    return this.getOrQueueProbe(request, onResolved);
  }

  primeLibraryProbe(def: ComponentDef, onResolved: () => void): void {
    if (!this.getLatexSource) return;
    const source = this.getLatexSource();
    const request = def.placementType === 'bipole'
      ? buildBipoleGhostProbe(source, def, {
        id: '__library_probe__',
        defId: def.id,
        type: 'bipole',
        start: { x: 0, y: 0 },
        end: { x: 2, y: 0 },
        props: {},
      })
      : buildPlacedGhostProbe(source, def, 0);
    request.persist = true;
    this.getOrQueueProbe(request, onResolved);
  }

  private getOrQueueProbe(request: ProbeRequest, onResolved: () => void): ComponentRenderProbe | null {
    if (this.cache.has(request.cacheKey)) return this.cache.get(request.cacheKey) ?? null;
    if (request.persist) {
      const persisted = readPersistedProbe(request.cacheKey);
      if (persisted) {
        this.cache.set(request.cacheKey, persisted);
        return persisted;
      }
    }
    // Register the callback — deduplicated per cacheKey so repeated calls during
    // the same in-flight request don't accumulate O(N*M) .finally() chains.
    if (!this.inflightCallbacks.has(request.cacheKey)) {
      this.inflightCallbacks.set(request.cacheKey, new Set());
    }
    this.inflightCallbacks.get(request.cacheKey)!.add(onResolved);

    if (this.inflight.has(request.cacheKey)) return null;

    const notify = () => {
      const callbacks = this.inflightCallbacks.get(request.cacheKey);
      this.inflightCallbacks.delete(request.cacheKey);
      if (callbacks) for (const cb of callbacks) cb();
    };

    const task = this.fetchProbe(request)
      .then((probe) => {
        this.cache.set(request.cacheKey, probe);
        if (request.persist) writePersistedProbe(request.cacheKey, probe);
        this.inflight.delete(request.cacheKey);
        notify();
        return probe;
      })
      .catch(() => {
        this.cache.set(request.cacheKey, null);
        this.inflight.delete(request.cacheKey);
        notify();
        return null;
      });
    this.inflight.set(request.cacheKey, task);
    return null;
  }

  private async fetchProbe(request: ProbeRequest): Promise<ComponentRenderProbe | null> {
    const [markerResponse, displayResponse] = await Promise.all([
      fetch(`${RENDER_SERVER_URL}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex: request.latex }),
        signal: AbortSignal.timeout(30000),
      }),
      request.displayLatex ? fetch(`${RENDER_SERVER_URL}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex: request.displayLatex }),
        signal: AbortSignal.timeout(30000),
      }) : Promise.resolve(null),
    ]);

    const markerData = await markerResponse.json() as { svg?: string };
    if (!markerData.svg) return null;

    const measured = measureProbeSvg(markerData.svg, request.markers);
    if (!measured) return null;

    if (displayResponse) {
      const displayData = await displayResponse.json() as { svg?: string; tx?: number; ty?: number };
      if (displayData.svg) {
        measured.svgMarkup = displayData.svg;
        measured.tx = displayData.tx ?? measured.tx;
        measured.ty = displayData.ty ?? measured.ty;
      }
    }

    return measured;
  }
}

export const componentProbeService = new ComponentProbeService();
