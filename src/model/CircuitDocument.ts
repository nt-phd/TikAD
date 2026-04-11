import type { ComponentInstance, DrawingInstance, WireInstance, DocumentMetadata } from '../types';
import { GRID_SIZE, SNAP_GRID, DEFAULT_STYLE } from '../constants';

export class CircuitDocument {
  components: ComponentInstance[] = [];
  drawings: DrawingInstance[] = [];
  wires: WireInstance[] = [];
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
  }
}
