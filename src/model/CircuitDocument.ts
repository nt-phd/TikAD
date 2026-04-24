import type {
  ComponentInstance,
  DrawingInstance,
  WireInstance,
  DrawPathInstance,
  DocumentMetadata,
  GridPoint,
  PositionSequencePreview,
  RenderComponentBounds,
  RenderSymbolPoint,
  RenderSymbolPointGroup,
} from '../types';
import {
  createTikzGeometryState,
  getStatementGeometry,
  getGeometryStorePoint,
  registerNamedReference,
  setStatementGeometry,
  type TikzGeometryState,
} from '../codegen/TikzGeometryStore';
import { GRID_SIZE, SNAP_GRID, DEFAULT_STYLE } from '../constants';

const NODE_NAME_RE = /^[A-Za-z][\w-]*$/;
const PIN_COORD_EPSILON = 1e-4;

function roundedPinCoord(value: number): string {
  return (Math.round(value / PIN_COORD_EPSILON) * PIN_COORD_EPSILON).toFixed(4);
}

function normalizePinAlias(name: string, allNames: Set<string>): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const portMatch = trimmed.match(/^port(\d+)$/i);
  if (portMatch && allNames.has(portMatch[1])) return portMatch[1];
  const transistorAliases: Record<string, string> = {
    base: 'B',
    collector: 'C',
    emitter: 'E',
    gate: 'G',
    drain: 'D',
    source: 'S',
  };
  const transistorAlias = transistorAliases[trimmed.toLowerCase()];
  if (transistorAlias && allNames.has(transistorAlias)) return transistorAlias;
  if (/^b.+/.test(trimmed) && allNames.has(trimmed.slice(1))) return trimmed.slice(1);
  if (trimmed.toLowerCase() === 'bout' && allNames.has('out')) return 'out';
  if (allNames.has('+') && allNames.has('-')) {
    if (/^b?in up$/i.test(trimmed)) return '+';
    if (/^b?in down$/i.test(trimmed)) return '-';
  }
  if (trimmed.toLowerCase() === 'nobase' && allNames.has('B')) return 'B';
  return null;
}

function pinNameScore(name: string): number {
  let score = 0;
  if (/\s/.test(name)) score += 40;
  if (/^port\d+$/i.test(name)) score += 20;
  if (/^(collector|emitter|base|gate|drain|source|nobase)$/i.test(name)) score += 30;
  if (/^b.+/.test(name)) score += 15;
  score += Math.max(0, name.length - 1);
  return score;
}

export class CircuitDocument {
  components: ComponentInstance[] = [];
  drawings: DrawingInstance[] = [];
  wires: WireInstance[] = [];
  drawPaths: DrawPathInstance[] = [];
  geometry: TikzGeometryState = createTikzGeometryState();
  measuredComponentBounds: Map<string, RenderComponentBounds> = new Map();
  measuredSymbolPoints: Map<string, RenderSymbolPoint> = new Map();
  metadata: DocumentMetadata;

  constructor(style: 'european' | 'american' = DEFAULT_STYLE) {
    this.metadata = {
      style,
      gridSize: GRID_SIZE,
      snapSize: SNAP_GRID,
      scale: 1,
    };
  }

  addComponent(c: ComponentInstance): void {
    this.components.push(c);
  }

  removeComponent(id: string): void {
    this.components = this.components.filter(c => c.id !== id);
  }

  getComponent(id: string): ComponentInstance | undefined {
    return this.components.find(c => c.id === id);
  }

  getComponentByNodeName(nodeName: string): ComponentInstance | undefined {
    return this.components.find((c) => c.type !== 'bipole' && c.nodeName === nodeName);
  }

  private getCurrentNodeNames(): Set<string> {
    const names = new Set<string>();
    for (const comp of this.components) {
      if (comp.type === 'bipole' || !comp.nodeName || !NODE_NAME_RE.test(comp.nodeName)) continue;
      names.add(comp.nodeName);
    }
    for (const key of this.geometry.symbolPoints.keys()) {
      if (key.includes('.') || !NODE_NAME_RE.test(key)) continue;
      names.add(key);
    }
    return names;
  }

  private symbolPointKey(key: string, requireCurrentNode: boolean): string | null {
    const trimmed = key.trim();
    if (!trimmed || trimmed.startsWith('.') || trimmed.endsWith('.')) return null;
    const dotIndex = trimmed.indexOf('.');
    const nodeName = dotIndex >= 0 ? trimmed.slice(0, dotIndex) : trimmed;
    const anchor = dotIndex >= 0 ? trimmed.slice(dotIndex + 1).trim() : 'reference';
    if (!nodeName || !anchor || !NODE_NAME_RE.test(nodeName)) return null;
    if (requireCurrentNode && !this.getCurrentNodeNames().has(nodeName)) return null;
    return anchor === 'reference' ? nodeName : `${nodeName}.${anchor}`;
  }

  private setCanonicalMeasuredPoint(target: Map<string, RenderSymbolPoint>, entry: RenderSymbolPoint): void {
    const canonicalKey = this.symbolPointKey(entry.key, false);
    if (!canonicalKey) return;
    target.set(canonicalKey, {
      ...entry,
      key: canonicalKey,
      names: [...(entry.names?.length ? entry.names : [entry.anchor])],
      point: { ...entry.point },
    });
  }

  upsertMeasuredSymbolPoint(entry: RenderSymbolPoint): void {
    this.setCanonicalMeasuredPoint(this.measuredSymbolPoints, entry);
  }

  private createMeasuredPoint(key: string, point: GridPoint): RenderSymbolPoint | null {
    const canonicalKey = this.symbolPointKey(key, true);
    if (!canonicalKey) return null;
    const dotIndex = canonicalKey.indexOf('.');
    const nodeName = dotIndex >= 0 ? canonicalKey.slice(0, dotIndex) : canonicalKey;
    const anchor = dotIndex >= 0 ? canonicalKey.slice(dotIndex + 1) : 'reference';
    return {
      key: canonicalKey,
      nodeName,
      anchor,
      names: [anchor],
      point: { ...point },
      kind: anchor === 'reference' ? 'reference' : 'anchor',
      role: anchor === 'reference' ? 'reference' : 'geometry',
      snap: anchor === 'reference',
      ghost: true,
      componentId: '',
      defId: '',
    };
  }

  setSymbolPoint(nodeName: string, point: GridPoint, anchor?: string): void {
    if (!NODE_NAME_RE.test(nodeName)) return;
    registerNamedReference(this.geometry, nodeName, point);
    if (anchor && anchor !== 'reference') {
      const measured = this.createMeasuredPoint(`${nodeName}.${anchor}`, point);
      if (measured) this.geometry.symbolPoints.set(measured.key, measured.point);
    }
  }

  getMeasuredSymbolPoint(nodeName: string, anchor?: string): RenderSymbolPoint | undefined {
    if (!NODE_NAME_RE.test(nodeName)) return undefined;
    return this.measuredSymbolPoints.get(anchor && anchor !== 'reference' ? `${nodeName}.${anchor}` : nodeName)
      ?? (anchor === 'reference' ? this.measuredSymbolPoints.get(nodeName) : undefined);
  }

  getMeasuredNodePoints(nodeName: string): RenderSymbolPoint[] {
    if (!NODE_NAME_RE.test(nodeName)) return [];
    const points: RenderSymbolPoint[] = [];
    for (const point of this.measuredSymbolPoints.values()) {
      if (point.nodeName !== nodeName) continue;
      points.push({
        ...point,
        point: { ...point.point },
      });
    }
    return points;
  }

  getMeasuredNodePointGroups(
    nodeName: string,
    role?: 'reference' | 'terminal' | 'geometry' | 'internal' | 'text' | string,
  ): RenderSymbolPointGroup[] {
    if (!NODE_NAME_RE.test(nodeName)) return [];
    const groups = new Map<string, RenderSymbolPointGroup>();
    for (const point of this.measuredSymbolPoints.values()) {
      if (point.nodeName !== nodeName) continue;
      if (role && point.role !== role) continue;
      const names = [...(point.names?.length ? point.names : [point.anchor])];
      const key = `${point.kind}|${point.role}|${names.join('\u0000')}`;
      if (groups.has(key)) continue;
      groups.set(key, {
        componentId: point.componentId,
        defId: point.defId,
        ghost: point.ghost,
        kind: point.kind,
        names,
        nodeName: point.nodeName,
        point: { ...point.point },
        role: point.role,
        snap: point.snap,
      });
    }
    return [...groups.values()];
  }

  getSymbolPoint(nodeName: string, anchor?: string): GridPoint | undefined {
    if (!NODE_NAME_RE.test(nodeName)) return undefined;
    return this.getMeasuredSymbolPoint(nodeName, anchor)?.point
      ?? getGeometryStorePoint(this.geometry, nodeName, anchor);
  }

  setMeasuredSymbolPoints(points: Map<string, RenderSymbolPoint>): void {
    this.measuredSymbolPoints = new Map();
    for (const point of points.values()) {
      this.setCanonicalMeasuredPoint(this.measuredSymbolPoints, point);
    }
  }

  setMeasuredComponentBounds(bounds: Map<string, RenderComponentBounds>): void {
    this.measuredComponentBounds = new Map();
    for (const bound of bounds.values()) {
      if (!bound.componentId) continue;
      this.measuredComponentBounds.set(bound.componentId, { ...bound });
    }
  }

  getMeasuredComponentBounds(componentId: string): RenderComponentBounds | undefined {
    const bounds = this.measuredComponentBounds.get(componentId);
    return bounds ? { ...bounds } : undefined;
  }

  clearMeasuredSymbolPoints(): void {
    this.measuredSymbolPoints.clear();
    this.measuredComponentBounds.clear();
  }

  getSnappableSymbolPoints(): Map<string, GridPoint> {
    const points = new Map<string, GridPoint>();
    for (const [key, point] of this.measuredSymbolPoints) {
      if (!point.snap) continue;
      points.set(key, { ...point.point });
    }
    return points;
  }

  setResolvedStatementPositions(id: string, positions: Array<PositionSequencePreview | null>): void {
    setStatementGeometry(this.geometry, id, positions);
  }

  getResolvedStatementPositions(id: string): Array<PositionSequencePreview | null> | undefined {
    return getStatementGeometry(this.geometry, id);
  }

  nextNodeName(prefix = 'N'): string {
    let max = 0;
    for (const comp of this.components) {
      if (comp.type === 'bipole' || !comp.nodeName) continue;
      const m = comp.nodeName.match(new RegExp(`^${prefix}(\\d+)$`));
      if (!m) continue;
      max = Math.max(max, Number.parseInt(m[1], 10));
    }
    return `${prefix}${max + 1}`;
  }

  addWire(w: WireInstance): void {
    this.wires.push(w);
  }

  removeWire(id: string): void {
    this.wires = this.wires.filter(w => w.id !== id);
  }

  getWire(id: string): WireInstance | undefined {
    return this.wires.find(w => w.id === id);
  }

  addDrawPath(d: DrawPathInstance): void {
    this.drawPaths.push(d);
  }

  removeDrawPath(id: string): void {
    this.drawPaths = this.drawPaths.filter((d) => d.id !== id);
  }

  getDrawPath(id: string): DrawPathInstance | undefined {
    return this.drawPaths.find((d) => d.id === id);
  }

  addDrawing(d: DrawingInstance): void {
    this.drawings.push(d);
  }

  removeDrawing(id: string): void {
    this.drawings = this.drawings.filter((d) => d.id !== id);
  }

  getDrawing(id: string): DrawingInstance | undefined {
    return this.drawings.find((d) => d.id === id);
  }

  clear(options: { preserveMeasuredComponentBounds?: boolean; preserveMeasuredSymbolPoints?: boolean } = {}): void {
    this.components = [];
    this.drawings = [];
    this.wires = [];
    this.drawPaths = [];
    this.geometry = createTikzGeometryState();
    if (!options.preserveMeasuredSymbolPoints) this.measuredSymbolPoints.clear();
    if (!options.preserveMeasuredComponentBounds) this.measuredComponentBounds.clear();
  }
}
