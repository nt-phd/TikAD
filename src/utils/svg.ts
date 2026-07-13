const SVG_NS = 'http://www.w3.org/2000/svg';

export function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) setAttrs(el, attrs);
  return el;
}

export function setAttrs(el: SVGElement, attrs: Record<string, string | number>): void {
  for (const [key, val] of Object.entries(attrs)) {
    el.setAttribute(key, String(val));
  }
}

export function createGroup(className?: string): SVGGElement {
  const g = createSvgElement('g');
  if (className) g.setAttribute('class', className);
  return g;
}

export function createPath(d: string, attrs?: Record<string, string | number>): SVGPathElement {
  return createSvgElement('path', { d, fill: 'none', ...attrs });
}

export function createLine(
  x1: number, y1: number, x2: number, y2: number,
  attrs?: Record<string, string | number>,
): SVGLineElement {
  return createSvgElement('line', { x1, y1, x2, y2, ...attrs });
}

export function createCircle(cx: number, cy: number, r: number, attrs?: Record<string, string | number>): SVGCircleElement {
  return createSvgElement('circle', { cx, cy, r, ...attrs });
}

export function createText(x: number, y: number, text: string, attrs?: Record<string, string | number>): SVGTextElement {
  const el = createSvgElement('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle', ...attrs });
  el.textContent = text;
  return el;
}

export function createRect(x: number, y: number, w: number, h: number, attrs?: Record<string, string | number>): SVGRectElement {
  return createSvgElement('rect', { x, y, width: w, height: h, ...attrs });
}
