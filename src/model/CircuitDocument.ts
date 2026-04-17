import type { ComponentInstance, DrawingInstance, WireInstance, DrawPathInstance, DocumentMetadata, GridPoint, PositionSequencePreview } from '../types';
import {
  createTikzGeometryState,
  getStatementGeometry,
  getGeometryStorePoint,
  registerNamedReference,
  setStatementGeometry,
  type TikzGeometryState,
} from '../codegen/TikzGeometryStore';
import { GRID_SIZE, SNAP_GRID, DEFAULT_STYLE } from '../constants';

export class CircuitDocument {
  components: ComponentInstance[] = [];
  drawings: DrawingInstance[] = [];
  wires: WireInstance[] = [];
  drawPaths: DrawPathInstance[] = [];
  geometry: TikzGeometryState = createTikzGeometryState();
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

  setSymbolPoint(nodeName: string, point: GridPoint, anchor?: string): void {
    registerNamedReference(this.geometry, nodeName, point);
    if (anchor && anchor !== 'reference') {
      this.geometry.symbolPoints.set(`${nodeName}.${anchor}`, { ...point });
    }
  }

  getSymbolPoint(nodeName: string, anchor?: string): GridPoint | undefined {
    return getGeometryStorePoint(this.geometry, nodeName, anchor);
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

  clear(): void {
    this.components = [];
    this.drawings = [];
    this.wires = [];
    this.drawPaths = [];
    this.geometry = createTikzGeometryState();
  }
}
