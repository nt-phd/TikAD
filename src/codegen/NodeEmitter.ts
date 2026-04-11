import { formatCoord } from './CoordFormatter';
import type { ComponentInstance } from '../types';

export function emitPlacedNodeLine(comp: ComponentInstance, tikzName: string): string | null {
  if (comp.type !== 'node' && comp.type !== 'monopole') return null;
  const optionParts = [tikzName];
  const extraOptions = (comp.props.options ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith('rotate='));
  if (comp.rotation) extraOptions.push(`rotate=${comp.rotation}`);
  if (extraOptions.length > 0) optionParts.push(extraOptions.join(', '));
  const nodeName = comp.nodeName ? `(${comp.nodeName})` : '';
  const inlineText = comp.props.textAnchor ? '' : (comp.props.text ?? '');
  const base = `\\node[${optionParts.join(', ')}]${nodeName} at ${formatCoord(comp.position)}{${inlineText}}`;
  if (comp.nodeName && comp.props.text && comp.props.textAnchor) {
    return `${base} node[anchor=${comp.props.textAnchor}] at (${comp.nodeName}.text){${comp.props.text}};`;
  }
  return `${base};`;
}
