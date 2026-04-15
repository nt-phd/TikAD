import { GRID_SIZE, RENDER_SERVER_URL, TIKZ_PT_PER_UNIT } from '../constants';
import type { BipoleInstance, ComponentDef, ComponentInstance } from '../types';
import { lineIndexFromId } from '../codegen/CircuiTikZParser';

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

function unionBounds(bounds: DOMRect[]): DOMRect | null {
  if (bounds.length === 0) return null;
  let left = bounds[0].x;
  let top = bounds[0].y;
  let right = bounds[0].x + bounds[0].width;
  let bottom = bounds[0].y + bounds[0].height;
  for (const bbox of bounds.slice(1)) {
    left = Math.min(left, bbox.x);
    top = Math.min(top, bbox.y);
    right = Math.max(right, bbox.x + bbox.width);
    bottom = Math.max(bottom, bbox.y + bbox.height);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

function parseCoordPair(s: string): { x: number; y: number } | null {
  const m = s.match(/\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (!m) return null;
  return { x: Number.parseFloat(m[1]), y: Number.parseFloat(m[2]) };
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

function stripMarkerElements(svg: SVGSVGElement, markerColors: Set<string>): SVGSVGElement {
  const cleaned = svg.cloneNode(true) as SVGSVGElement;
  const elements = [...cleaned.querySelectorAll<SVGGraphicsElement>('path, circle, ellipse, rect, line, polygon, polyline, use')];
  for (const element of elements) {
    const fill = normalizeColor(element.getAttribute('fill'));
    const stroke = normalizeColor(element.getAttribute('stroke'));
    const style = normalizeColor(element.getAttribute('style'));
    if (
      markerColors.has(fill) ||
      markerColors.has(stroke) ||
      [...markerColors].some((color) => style.includes(color))
    ) {
      element.remove();
    }
  }
  return cleaned;
}

function measureProbeSvg(
  svgText: string,
  tx: number,
  ty: number,
  markers: ProbeMarkerSpec[],
): ComponentRenderProbe | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) return null;

  const host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.width = '0';
  host.style.height = '0';
  host.style.overflow = 'hidden';
  host.style.pointerEvents = 'none';
  host.appendChild(document.importNode(svg, true));
  document.body.appendChild(host);

  try {
    const liveSvg = host.querySelector('svg');
    if (!liveSvg) return null;
    const markerColorMap = new Map(markers.map((marker) => [normalizeColor(marker.color), marker.name]));
    const markerColors = new Set(markerColorMap.keys());
    const elements = [...liveSvg.querySelectorAll<SVGGraphicsElement>('path, circle, ellipse, rect, line, polygon, polyline, use')];
    const pinBounds = new Map<string, DOMRect>();
    const bodyBounds: DOMRect[] = [];

    for (const element of elements) {
      let bbox: DOMRect;
      try {
        bbox = element.getBBox();
      } catch {
        continue;
      }
      if (!bbox.width && !bbox.height) continue;

      const fill = normalizeColor(element.getAttribute('fill'));
      const stroke = normalizeColor(element.getAttribute('stroke'));
      const style = normalizeColor(element.getAttribute('style'));
      const markerName =
        markerColorMap.get(fill) ??
        markerColorMap.get(stroke) ??
        [...markerColorMap.entries()].find(([color]) => style.includes(color))?.[1];

      if (markerName) {
        pinBounds.set(markerName, bbox);
        continue;
      }
      bodyBounds.push(bbox);
    }

    const referenceBounds = pinBounds.get('__REFERENCE__');
    const anchorX = referenceBounds ? referenceBounds.x + referenceBounds.width / 2 : tx;
    const anchorY = referenceBounds ? referenceBounds.y + referenceBounds.height / 2 : ty;
    const bboxNorthWest = pinBounds.get('__BBOX_NW__');
    const bboxSouthEast = pinBounds.get('__BBOX_SE__');

    const bbox = (() => {
      if (bboxNorthWest && bboxSouthEast) {
        const nwX = bboxNorthWest.x + bboxNorthWest.width / 2;
        const nwY = bboxNorthWest.y + bboxNorthWest.height / 2;
        const seX = bboxSouthEast.x + bboxSouthEast.width / 2;
        const seY = bboxSouthEast.y + bboxSouthEast.height / 2;
        const left = Math.min(nwX, seX);
        const top = Math.min(nwY, seY);
        const right = Math.max(nwX, seX);
        const bottom = Math.max(nwY, seY);
        return new DOMRect(left, top, right - left, bottom - top);
      }
      return unionBounds(bodyBounds);
    })();
    if (!bbox) return null;

    const pinOffsets = markers.map((marker) => {
      if (marker.name === '__REFERENCE__' || marker.name === '__BBOX_NW__' || marker.name === '__BBOX_SE__') return null;
      const pin = pinBounds.get(marker.name);
      if (!pin) return null;
      return {
        name: marker.name,
        x: (pin.x + pin.width / 2 - anchorX) * PT_TO_PX,
        y: (pin.y + pin.height / 2 - anchorY) * PT_TO_PX,
      };
    }).filter(Boolean) as Array<{ name: string; x: number; y: number }>;

    return {
      bboxLeft: (bbox.x - anchorX) * PT_TO_PX,
      bboxTop: (bbox.y - anchorY) * PT_TO_PX,
      bboxWidth: bbox.width * PT_TO_PX,
      bboxHeight: bbox.height * PT_TO_PX,
      pinOffsets,
      svgMarkup: stripMarkerElements(liveSvg, markerColors).outerHTML,
      tx,
      ty,
    };
  } finally {
    host.remove();
  }
}

function buildPlacedProbeFromSource(source: { body: string; preamble: string }, sourceLine: string, def: ComponentDef): ProbeRequest | null {
  const tikzOptions = extractTikzPictureOptions(source.body);
  let probeLine: string | null = null;
  const nodeName = 'probe';

  const nodeStmt = sourceLine.match(/^(\s*\\node\s*)\[([^\]]+)\]\s*(?:\(([^)]+)\))?\s+at\s+\([^)]+\)([\s\S]*)$/);
  if (nodeStmt) {
    probeLine = `${nodeStmt[1]}[${nodeStmt[2]}](${nodeName}) at (0,0) {};`;
  } else {
    const pathNodeStmt = sourceLine.match(/^(\s*\\(?:draw|path)\s*)\([^)]+\)\s+node\[([^\]]+)\](\s*\{[\s\S]*?\}\s*);?$/);
    if (pathNodeStmt) probeLine = `${pathNodeStmt[1]}(0,0) node[${pathNodeStmt[2]}](${nodeName})${pathNodeStmt[3]};`;
  }
  if (!probeLine) return null;

  const pinNames = (def.symbolPins ?? [])
    .map((pin) => pin.name)
    .filter((name) => !['START', 'END', 'reference', 'center'].includes(name));
  if (def.scaleFamily === 'amplifiers' && !pinNames.includes('out')) pinNames.push('out');
  const markers = assignMarkerColors(['__REFERENCE__', '__BBOX_NW__', '__BBOX_SE__', ...(pinNames.length > 0 ? pinNames : ['reference'])]);
  markers[0].target = '';
  markers[1].target = 'north west';
  markers[2].target = 'south east';
  const markerLines = buildMarkerLines(nodeName, markers);
  if (pinNames.length === 0) {
    markerLines.splice(3, markerLines.length - 3, `\\fill[${markers[3].latexColorName}] (0,0) circle[radius=0.08];`);
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
    cacheKey: `placed:${source.preamble}\n@@\n${tikzOptions}\n@@\n${probeLine}\n@@\n${def.id}`,
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

function findEnclosingPathCommand(body: string, lineIndex: number): 'draw' | 'path' | null {
  const lines = body.split('\n');
  for (let i = lineIndex - 1; i >= 0; i--) {
    const trimmed = lines[i]?.replace(/%.*$/, '').trim();
    if (!trimmed) continue;
    if (trimmed === ';') break;
    const match = trimmed.match(/^\\(draw|path)(?:\[[^\]]*\])?\s*$/);
    if (match) return match[1] as 'draw' | 'path';
    if (trimmed.startsWith('\\')) break;
  }
  return null;
}

function buildPlacedProbeRequest(
  source: { body: string; preamble: string },
  sourceLine: string,
  lineIndex: number,
  def: ComponentDef,
): ProbeRequest | null {
  const direct = buildPlacedProbeFromSource(source, sourceLine, def);
  if (direct) return direct;
  const bareNodeLine = sourceLine.match(/^(\s*\([^)]+\)\s+)node\[([^\]]+)\](?:\s*\(([^)]+)\))?(\s*\{[\s\S]*\}\s*;?)$/);
  if (!bareNodeLine) return null;
  const command = findEnclosingPathCommand(source.body, lineIndex) ?? 'path';
  return buildPlacedProbeFromSource(
    source,
    `\\${command} ${bareNodeLine[1]}node[${bareNodeLine[2]}]${bareNodeLine[3] ? `(${bareNodeLine[3]})` : ''}${bareNodeLine[4]}`,
    def,
  );
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
  const markers = assignMarkerColors(['__REFERENCE__', '__BBOX_NW__', '__BBOX_SE__', ...(pinNames.length > 0 ? pinNames : ['reference'])]);
  markers[0].target = '';
  markers[1].target = 'north west';
  markers[2].target = 'south east';
  const markerLines = buildMarkerLines(nodeName, markers);
  if (pinNames.length === 0) {
    markerLines.splice(3, markerLines.length - 3, `\\fill[${markers[3].latexColorName}] (0,0) circle[radius=0.08];`);
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

function buildBipoleProbeLatex(source: { body: string; preamble: string }, sourceLine: string): ProbeRequest | null {
  const tikzOptions = extractTikzPictureOptions(source.body);
  const bipoleStmt = sourceLine.match(/^(\s*\\draw\s*)(\([^)]+\))\s+to\[([^\]]+)\]\s+(\([^)]+\))\s*;?\s*$/);
  if (!bipoleStmt) return null;
  const start = parseCoordPair(bipoleStmt[2]);
  const end = parseCoordPair(bipoleStmt[4]);
  if (!start || !end) return null;
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const markers: ProbeMarkerSpec[] = [
    { name: 'START', target: '', color: MARKER_PALETTE[0], latexColorName: 'probeMarker0' },
    { name: 'END', target: '', color: MARKER_PALETTE[1], latexColorName: 'probeMarker1' },
  ];
  const cleanDraw = `${bipoleStmt[1]}(0,0) to[${bipoleStmt[3]}] (${dist},0);`;
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
    cacheKey: `bipole:${source.preamble}\n@@\n${tikzOptions}\n@@\n${bipoleStmt[3]}\n@@\n${dist}`,
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

  getSelectionProbe(id: string, comp: ComponentInstance, def: ComponentDef, onResolved: () => void): ComponentRenderProbe | null {
    if (!this.getLatexSource) return null;
    const source = this.getLatexSource();
    const lineIndex = lineIndexFromId(id);
    if (lineIndex < 0) return null;
    const sourceLine = source.body.split('\n')[lineIndex]?.trim();
    if (!sourceLine) return null;
    const request = comp.type === 'bipole'
      ? buildBipoleProbeLatex(source, sourceLine)
      : buildPlacedProbeRequest(source, sourceLine, lineIndex, def);
    if (!request) return null;
    request.persist = true;
    return this.getOrQueueProbe(request, onResolved);
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
    const response = await fetch(`${RENDER_SERVER_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex: request.latex }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json() as { svg?: string; tx?: number; ty?: number };
    if (!data.svg) return null;
    const measured = measureProbeSvg(data.svg, data.tx ?? 0, data.ty ?? 0, request.markers);
    if (!measured) return null;
    if (!request.displayLatex) return measured;

    try {
      const displayResponse = await fetch(`${RENDER_SERVER_URL}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex: request.displayLatex }),
        signal: AbortSignal.timeout(30000),
      });
      const displayData = await displayResponse.json() as { svg?: string; tx?: number; ty?: number };
      if (displayData.svg) {
        const displayTx = displayData.tx ?? measured.tx;
        const displayTy = displayData.ty ?? measured.ty;
        const isReferenceAnchored = request.markers.some((marker) => marker.name === '__REFERENCE__');
        if (!isReferenceAnchored) {
          const dx = (measured.tx - displayTx) * PT_TO_PX;
          const dy = (measured.ty - displayTy) * PT_TO_PX;
          measured.pinOffsets = measured.pinOffsets.map((pin) => ({
            ...pin,
            x: pin.x + dx,
            y: pin.y + dy,
          }));
          measured.bboxLeft += dx;
          measured.bboxTop += dy;
        }
        measured.tx = displayTx;
        measured.ty = displayTy;
        measured.svgMarkup = displayData.svg;
      }
    } catch {
      // Keep the measured+stripped SVG as fallback.
    }
    return measured;
  }
}

export const componentProbeService = new ComponentProbeService();
