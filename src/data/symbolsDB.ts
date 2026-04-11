/**
 * symbolsDB.ts
 *
 * Parses symbols.svg from CircuiTikZ-Designer and exposes
 * a typed index of all available components with their
 * SVG symbol IDs, pin coordinates, viewBox, and tikz names.
 */

export type ComponentType = 'path' | 'node';

export interface PinDef {
  name: string;
  /** Offset from variant reference point (x, y). Missing axis = 0. */
  x: number;
  y: number;
}

export interface VariantDef {
  /** SVG <symbol> id, e.g. "path_european-resistor" */
  symbolId: string;
  /** ViewBox string, e.g. "0 0 43.39 16.93" */
  viewBox: string;
  viewBoxWidth: number;
  viewBoxHeight: number;
  /** Reference point — the "center" or anchor point of the symbol */
  refX: number;
  refY: number;
  /** Named pins with coordinates relative to refX/refY */
  pins: PinDef[];
  /** Real rendered geometry bounds inside the symbol coordinate system */
  bboxX: number;
  bboxY: number;
  bboxWidth: number;
  bboxHeight: number;
}

export interface ComponentEntry {
  /** type="path" = bipole placed between two points */
  /** type="node" = node placed at a single point */
  type: ComponentType;
  /** Human-readable name */
  display: string;
  /** CircuiTikZ tikz key */
  tikz: string;
  /** Palette group */
  group: string;
  /** Sub-class (e.g. "resistors", "capacitors") */
  class: string;
  /** Whether the component body can be filled */
  fillable: boolean;
  /** All style/option variants */
  variants: VariantDef[];
  /** Convenience: first variant */
  defaultVariant: VariantDef;
}

export class SymbolsDB {
  private components = new Map<string, ComponentEntry>();
  private loaded = false;

  async load(svgUrl: string): Promise<void> {
    const response = await fetch(svgUrl);
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'image/svg+xml');

    const rootSvg = doc.querySelector('svg');
    if (!rootSvg) throw new Error('symbols.svg: no root <svg>');

    // Inject the entire <defs> into a hidden SVG in the current document
    // so that <use href="#..."> references work
    const hiddenSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    hiddenSvg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    hiddenSvg.setAttribute('aria-hidden', 'true');

    const defs = doc.querySelector('defs');
    if (defs) {
      // Clone and append all <symbol> elements
      hiddenSvg.appendChild(document.adoptNode(defs.cloneNode(true) as Element));
    }
    document.body.appendChild(hiddenSvg);
    const measureSymbolBounds = (symbolId: string) => {
      const measureSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      measureSvg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
      const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      useEl.setAttribute('href', `#${symbolId}`);
      measureSvg.appendChild(useEl);
      document.body.appendChild(measureSvg);
      try {
        const bbox = useEl.getBBox();
        return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
      } finally {
        measureSvg.remove();
      }
    };

    // Parse <metadata> for component definitions
    const metadata = doc.querySelector('metadata');
    if (!metadata) throw new Error('symbols.svg: no <metadata>');

    const componentEls = metadata.querySelectorAll('component');
    for (const compEl of componentEls) {
      const type = (compEl.getAttribute('type') || 'node') as ComponentType;
      const display = compEl.getAttribute('display') || '';
      const tikz = compEl.getAttribute('tikz') || '';
      const group = compEl.getAttribute('group') || '';
      const cls = compEl.getAttribute('class') || '';
      const fillable = compEl.getAttribute('fillable') === 'True';

      const variants: VariantDef[] = [];
      const variantEls = compEl.querySelectorAll('variant');
      for (const varEl of variantEls) {
        const symbolId = varEl.getAttribute('for') || '';
        const viewBox = varEl.getAttribute('viewBox') || '0 0 0 0';
        const [, , vbW, vbH] = viewBox.split(' ').map(Number);
        const refX = parseFloat(varEl.getAttribute('x') || '0');
        const refY = parseFloat(varEl.getAttribute('y') || '0');

        const pins: PinDef[] = [];
        const pinEls = varEl.querySelectorAll('pin');
        for (const pinEl of pinEls) {
          pins.push({
            name: pinEl.getAttribute('name') || '',
            x: parseFloat(pinEl.getAttribute('x') || '0'),
            y: parseFloat(pinEl.getAttribute('y') || '0'),
          });
        }

        const bounds = measureSymbolBounds(symbolId);
        variants.push({
          symbolId,
          viewBox,
          viewBoxWidth: vbW,
          viewBoxHeight: vbH,
          refX,
          refY,
          pins,
          bboxX: bounds.x,
          bboxY: bounds.y,
          bboxWidth: bounds.width,
          bboxHeight: bounds.height,
        });
      }

      if (variants.length === 0) continue;

      const entry: ComponentEntry = {
        type, display, tikz, group, class: cls, fillable,
        variants,
        defaultVariant: variants[0],
      };

      // Key by tikz name (primary) and by symbolId (secondary)
      this.components.set(tikz, entry);
      for (const v of variants) {
        this.components.set(v.symbolId, entry);
      }
    }

    this.loaded = true;
  }

  get isLoaded(): boolean { return this.loaded; }

  getByTikz(tikz: string): ComponentEntry | undefined {
    return this.components.get(tikz);
  }

  getBySymbolId(id: string): ComponentEntry | undefined {
    return this.components.get(id);
  }

  /** All unique entries (deduped by tikz name) */
  getAllComponents(): ComponentEntry[] {
    const seen = new Set<string>();
    const result: ComponentEntry[] = [];
    for (const entry of this.components.values()) {
      if (!seen.has(entry.tikz)) {
        seen.add(entry.tikz);
        result.push(entry);
      }
    }
    return result;
  }

  getByGroup(group: string): ComponentEntry[] {
    return this.getAllComponents().filter(c => c.group === group);
  }

  getGroups(): string[] {
    return [...new Set(this.getAllComponents().map(c => c.group))];
  }

  getByType(type: ComponentType): ComponentEntry[] {
    return this.getAllComponents().filter(c => c.type === type);
  }
}

export const symbolsDB = new SymbolsDB();
