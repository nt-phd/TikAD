import type { BipoleInstance, MonopoleInstance, NodeInstance, WireInstance, TerminalMark, DrawingInstance, DrawPathInstance } from '../types';
import type { CircuitDocument } from '../model/CircuitDocument';
import type { ComponentRegistry } from '../definitions/ComponentRegistry';
import { formatCoord } from './CoordFormatter';
import { formatLabel } from './LabelFormatter';
import { emitWirePath } from './WirePathEmitter';
import { emitPlacedNodeLine } from './NodeEmitter';

function formatEndpoint(point: { x: number; y: number }, ref?: { nodeName: string; anchor: string }): string {
  if (!ref) return formatCoord(point);
  return ref.anchor === 'reference' ? `(${ref.nodeName})` : `(${ref.nodeName}.${ref.anchor})`;
}

/**
 * Emits the tikzpicture body (without \begin/\end) from a CircuitDocument.
 * Used by tools to regenerate the LatexDocument body after model changes.
 */
export class CircuiTikZEmitter {
  constructor(private registry: ComponentRegistry) {}

  /** Emit a full \begin{tikzpicture}…\end{tikzpicture} block. */
  emit(doc: CircuitDocument): string {
    const lines: string[] = [];
    lines.push(`\\begin{tikzpicture}`);
    for (const l of this.emitLines(doc)) lines.push(`  ${l}`);
    lines.push(`\\end{tikzpicture}`);
    return lines.join('\n');
  }

  /** Emit only the inner \draw lines (no begin/end wrapper). */
  emitLines(doc: CircuitDocument): string[] {
    const lines: string[] = [];

    for (const dp of doc.drawPaths) {
      const l = this.emitDrawPath(dp);
      if (l) lines.push(l);
    }

    for (const w of doc.wires) {
      const l = this.emitWire(w);
      if (l) lines.push(l);
    }

    for (const drawing of doc.drawings) {
      const l = this.emitDrawing(drawing);
      if (l) lines.push(l);
    }

    for (const comp of doc.components) {
      if (comp.type === 'bipole') {
        const def = this.registry.get(comp.defId);
        if (def) lines.push(this.emitBipole(comp, def.tikzName));
      } else if (comp.type === 'monopole') {
        const def = this.registry.get(comp.defId);
        if (def) lines.push(this.emitPlacedNode(comp, def.tikzName));
      } else if (comp.type === 'node') {
        const def = this.registry.get(comp.defId);
        if (def) lines.push(this.emitPlacedNode(comp, def.tikzName));
      }
    }

    return lines;
  }

  private emitBipole(comp: BipoleInstance, tikzName: string): string {
    const start = formatEndpoint(comp.start, comp.startRef);
    const end = formatEndpoint(comp.end, comp.endRef);
    const options: string[] = [tikzName];

    const termStr = this.terminalString(comp.props.startTerminal, comp.props.endTerminal);
    if (termStr !== '-') options.push(termStr);
    if (comp.props.annotation) options.push(`a=${formatLabel(comp.props.annotation)}`);
    if (comp.props.label)   options.push(`l=${formatLabel(comp.props.label)}`);
    if (comp.props.voltage) options.push(`v=${formatLabel(comp.props.voltage)}`);
    if (comp.props.current) options.push(`i=${formatLabel(comp.props.current)}`);
    if (comp.props.flow) options.push(`f=${formatLabel(comp.props.flow)}`);

    return `\\draw ${start} to[${options.join(', ')}] ${end};`;
  }

  private terminalString(start?: TerminalMark, end?: TerminalMark): string {
    const left =
      start === 'circ' ? '*' :
        start === 'ocirc' ? 'o' :
        start === 'diamondpole' ? 'd' :
        start === 'rectjoinfill' ? '.' :
        '';
    const right =
      end === 'circ' ? '*' :
        end === 'ocirc' ? 'o' :
        end === 'diamondpole' ? 'd' :
        end === 'rectjoinfill' ? '.' :
        '';
    return `${left}-${right}`;
  }

  private emitWire(wire: WireInstance): string {
    if (wire.points.length < 2) return '';
    return `\\draw ${emitWirePath(wire)};`;
  }

  private emitPlacedNode(comp: MonopoleInstance | NodeInstance, tikzName: string): string {
    return emitPlacedNodeLine(comp, tikzName) ?? '';
  }

  private emitDrawing(drawing: DrawingInstance): string {
    switch (drawing.kind) {
      case 'line':
        return `\\draw[${drawing.props.options || 'thin'}] ${formatCoord(drawing.start)} -- ${formatCoord(drawing.end)};`;
      case 'arrow':
        return `\\draw[${drawing.props.options || '->'}] ${formatCoord(drawing.start)} -- ${formatCoord(drawing.end)};`;
      case 'text':
        return this.emitTextNode(drawing);
      case 'rectangle':
        return `\\draw[${drawing.props.options || 'thin'}] ${formatCoord(drawing.start)} rectangle ${formatCoord(drawing.end)};`;
      case 'circle':
        return `\\draw[${drawing.props.options || 'thin'}] ${formatCoord(drawing.center)} circle (${drawing.radius});`;
      case 'bezier':
        return `\\draw[${drawing.props.options || 'thin'}] ${formatCoord(drawing.start)} .. controls ${formatCoord(drawing.control1)} and ${formatCoord(drawing.control2)} .. ${formatCoord(drawing.end)};`;
    }
  }

  private emitDrawPath(path: DrawPathInstance): string {
    if (path.positionSequences.length < 2) return '';
    const parts: string[] = [];
    const firstSeq = path.positionSequences[0];
    parts.push(formatEndpoint(firstSeq.point, firstSeq.ref));
    for (let i = 0; i < path.segments.length; i++) {
      const seg = path.segments[i];
      const nextSeq = path.positionSequences[i + 1];
      if (!nextSeq) break;
      const endPos = formatEndpoint(nextSeq.point, nextSeq.ref);
      if (seg.kind === 'connection') {
        parts.push(`${seg.operator ?? '--'} ${endPos}`);
      } else {
        const def = seg.defId ? this.registry.get(seg.defId) : undefined;
        const tikzName = def?.tikzName ?? seg.defId ?? 'R';
        const options: string[] = [tikzName];
        const props = seg.props;
        if (props) {
          const termStr = this.terminalString(props.startTerminal, props.endTerminal);
          if (termStr !== '-') options.push(termStr);
          if (props.annotation) options.push(`a=${formatLabel(props.annotation)}`);
          if (props.label) options.push(`l=${formatLabel(props.label)}`);
          if (props.voltage) options.push(`v=${formatLabel(props.voltage)}`);
          if (props.current) options.push(`i=${formatLabel(props.current)}`);
          if (props.flow) options.push(`f=${formatLabel(props.flow)}`);
        }
        parts.push(`to[${options.join(', ')}] ${endPos}`);
      }
    }
    return `\\draw ${parts.join(' ')};`;
  }

  private emitTextNode(drawing: DrawingInstance): string {
    const optionParts: string[] = [];
    if (drawing.kind !== 'text') return '';
    if (drawing.props.anchor) optionParts.push(`anchor=${drawing.props.anchor}`);
    if (drawing.props.rotation) optionParts.push(`rotate=${drawing.props.rotation}`);
    if (drawing.props.scale) optionParts.push(`scale=${drawing.props.scale}`);
    if (drawing.props.options) optionParts.push(drawing.props.options);
    const options = optionParts.length > 0 ? `[${optionParts.join(', ')}]` : '';
    return `\\node${options} at ${formatCoord(drawing.position)} {${drawing.props.text ?? 'Text'}};`;
  }
}
