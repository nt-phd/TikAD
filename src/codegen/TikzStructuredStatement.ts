import type {
  ComponentProps,
  EditableBipoleSegment,
  EditableConnectionOperator,
  EditableConnectionSegment,
  EditableNodeSegment,
  EditableSegment,
} from '../types';
import {
  findBipoleVariantByCodePrefix,
  getDefaultBipoleVariantToken,
  type BipoleValuePropertyId,
} from '../data/statementPropertySchema';
import { readTikzBalanced, scanTikzPointSequence, skipTikzWhitespace } from './TikzPointParser';
import { readKeyword, splitOptions } from './TikzStatementSyntax';

export interface StructuredStatementBody {
  positionTexts: string[];
  segments: EditableSegment[];
}

interface ParsedNodePlacement {
  nodeName?: string;
  positionText: string;
  text: string;
}

function extractTerminalMarks(opts: string[]): Pick<ComponentProps, 'startTerminal' | 'endTerminal'> {
  for (const opt of opts) {
    const match = opt.trim().replace(/\/$/, '').match(/^([*od.]?)-([*od.]?)$/);
    if (!match) continue;
    const toMark = (value: string): ComponentProps['startTerminal'] =>
      value === '*' ? 'circ' :
        value === 'o' ? 'ocirc' :
        value === 'd' ? 'diamondpole' :
        value === '.' ? 'rectjoinfill' :
        'none';
    return {
      startTerminal: toMark(match[1]),
      endTerminal: toMark(match[2]),
    };
  }
  return {};
}

function isTerminalMarkOption(opt: string): boolean {
  return /^([*od.]?)-([*od.]?)\/?$/.test(opt.trim());
}

function serializeTerminalMarks(start?: ComponentProps['startTerminal'], end?: ComponentProps['endTerminal']): string | null {
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
  if (!left && !right) return null;
  return `${left}-${right}`;
}

function unwrapTikzOptionValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed.slice(1, -1).trim();
  return trimmed;
}

function parseBipoleOptions(text: string): EditableBipoleSegment {
  const options = splitOptions(text);
  const firstOption = options[0]?.trim();
  const eqIndex = firstOption ? firstOption.indexOf('=') : -1;
  const hasInlineValue = eqIndex >= 0;
  const tikzName = hasInlineValue ? firstOption.slice(0, eqIndex).trim() : (firstOption || 'R');
  const tikzValue = hasInlineValue ? firstOption.slice(eqIndex + 1).trim() : undefined;
  const rest = options.slice(1);
  const terminals = extractTerminalMarks(rest);
  const props: EditableBipoleSegment['props'] = {
    endTerminal: terminals.endTerminal,
    startTerminal: terminals.startTerminal,
  };
  const variantTokens: EditableBipoleSegment['variantTokens'] = {};
  const unparsedOptions = rest.filter((opt) => {
    const trimmed = opt.trim();
    if (isTerminalMarkOption(trimmed)) return false;
    const match = trimmed.match(/^([^=]+?)\s*=\s*(.+)$/);
    if (match) {
      const codePrefix = match[1].trim();
      const propertyIds: BipoleValuePropertyId[] = ['annotation', 'current', 'flow', 'label', 'voltage'];
      for (const propertyId of propertyIds) {
        const variant = findBipoleVariantByCodePrefix(propertyId, codePrefix);
        if (!variant) continue;
        props[propertyId] = unwrapTikzOptionValue(match[2]);
        variantTokens[propertyId] = variant.token;
        return false;
      }
    }
    return true;
  });
  return {
    kind: 'bipole',
    endPositionText: '',
    optionsText: unparsedOptions.join(', ').trim() || undefined,
    tikzName,
    tikzValue,
    props,
    variantTokens,
  };
}

function parseNodeSegment(source: string, index: number, allowImplicitPosition = false): { end: number; segment: EditableNodeSegment } | null {
  const position = scanTikzPointSequence(source, index);
  const nodeStart = readKeyword(source, position?.end ?? index, 'node');
  if (nodeStart == null && allowImplicitPosition) {
    const implicitNodeStart = readKeyword(source, index, 'node');
    if (implicitNodeStart == null) return null;
    return parseNodeSegmentFromKeyword(source, implicitNodeStart, '');
  }
  if (nodeStart == null) return null;
  return parseNodeSegmentFromKeyword(source, nodeStart, position?.text ?? '');
}

function parseNodeSegmentFromKeyword(source: string, nodeStart: number, positionText: string): { end: number; segment: EditableNodeSegment } | null {
  let cursor = skipTikzWhitespace(source, nodeStart);
  let optionsText = '';
  if (source[cursor] === '[') {
    const options = readTikzBalanced(source, cursor, '[', ']');
    if (!options) return null;
    optionsText = options.text.slice(1, -1).trim();
    cursor = options.end;
  }
  cursor = skipTikzWhitespace(source, cursor);
  let nodeName: string | undefined;
  if (source[cursor] === '(') {
    const nameGroup = readTikzBalanced(source, cursor, '(', ')');
    if (!nameGroup) return null;
    nodeName = nameGroup.text.slice(1, -1).trim() || undefined;
    cursor = nameGroup.end;
  }
  cursor = skipTikzWhitespace(source, cursor);
  const textGroup = readTikzBalanced(source, cursor, '{', '}');
  if (!textGroup) return null;
  const optionParts = optionsText ? splitOptions(optionsText) : [];
  const firstOption = optionParts[0]?.trim();
  const hasComponentName = Boolean(firstOption && !firstOption.includes('='));
  return {
    end: textGroup.end,
    segment: {
      kind: 'node',
      nodeName,
      optionsText: hasComponentName ? optionParts.slice(1).join(', ').trim() || undefined : optionsText || undefined,
      positionText,
      text: textGroup.text.slice(1, -1).trim() || undefined,
      tikzName: hasComponentName ? firstOption : undefined,
    },
  };
}

function parseConnectionSegment(source: string, index: number): { end: number; segment: EditableConnectionSegment } | null {
  const cursor = skipTikzWhitespace(source, index);
  const opMatch = /^(--|\|-|-\|)/.exec(source.slice(cursor));
  if (!opMatch) return null;
  const position = scanTikzPointSequence(source, cursor + opMatch[1].length);
  if (!position) return null;
  return {
    end: position.end,
    segment: {
      kind: 'connection',
      operator: opMatch[1] as EditableConnectionOperator,
      endPositionText: position.text,
    },
  };
}

function parseBipoleSegment(source: string, index: number): { end: number; segment: EditableBipoleSegment } | null {
  const keywordEnd = readKeyword(source, index, 'to');
  if (keywordEnd == null) return null;
  let cursor = skipTikzWhitespace(source, keywordEnd);
  if (source[cursor] !== '[') return null;
  const options = readTikzBalanced(source, cursor, '[', ']');
  if (!options) return null;
  const position = scanTikzPointSequence(source, options.end);
  if (!position) return null;
  const segment = parseBipoleOptions(options.text.slice(1, -1).trim());
  segment.endPositionText = position.text;
  return { end: position.end, segment };
}

function serializeBipoleSegment(segment: EditableBipoleSegment): string {
  const options = [segment.tikzValue !== undefined ? `${segment.tikzName}=${segment.tikzValue}` : segment.tikzName];
  const terminalMarks = serializeTerminalMarks(segment.props.startTerminal, segment.props.endTerminal);
  if (terminalMarks) options.push(terminalMarks);
  if (segment.props.annotation) options.push(`${segment.variantTokens?.annotation ?? getDefaultBipoleVariantToken('annotation')}=${segment.props.annotation}`);
  if (segment.props.label) options.push(`${segment.variantTokens?.label ?? getDefaultBipoleVariantToken('label')}=${segment.props.label}`);
  if (segment.props.voltage) options.push(`${segment.variantTokens?.voltage ?? getDefaultBipoleVariantToken('voltage')}=${segment.props.voltage}`);
  if (segment.props.current) options.push(`${segment.variantTokens?.current ?? getDefaultBipoleVariantToken('current')}=${segment.props.current}`);
  if (segment.props.flow) options.push(`${segment.variantTokens?.flow ?? getDefaultBipoleVariantToken('flow')}=${segment.props.flow}`);
  if (segment.optionsText) options.push(segment.optionsText);
  return `to[${options.join(', ')}] ${segment.endPositionText}`;
}

function serializeNodeSegment(segment: EditableNodeSegment): string {
  const options: string[] = [];
  if (segment.tikzName) options.push(segment.tikzName);
  if (segment.optionsText) options.push(segment.optionsText);
  return `${segment.positionText ? `${segment.positionText} ` : ''}node${options.length > 0 ? `[${options.join(', ')}]` : ''}${segment.nodeName ? ` (${segment.nodeName})` : ''} {${segment.text ?? ''}}`;
}

function buildNodePlacementText(nodeName: string | undefined, positionText: string): string {
  return nodeName ? `(${nodeName}) at ${positionText}` : positionText;
}

export function parseNodePlacementText(source: string, index = 0): { end: number; placement: ParsedNodePlacement } | null {
  let cursor = skipTikzWhitespace(source, index);
  let nodeName: string | undefined;
  if (source[cursor] === '(') {
    const nameGroup = readTikzBalanced(source, cursor, '(', ')');
    if (!nameGroup) return null;
    nodeName = nameGroup.text.slice(1, -1).trim() || undefined;
    cursor = nameGroup.end;
    const atEnd = readKeyword(source, cursor, 'at');
    if (atEnd == null) return null;
    cursor = atEnd;
  }
  const bareAtEnd = readKeyword(source, cursor, 'at');
  if (bareAtEnd != null) cursor = bareAtEnd;
  const position = scanTikzPointSequence(source, cursor);
  if (!position) return null;
  return {
    end: position.end,
    placement: {
      nodeName,
      positionText: position.text,
      text: buildNodePlacementText(nodeName, position.text),
    },
  };
}

export function splitNodePlacementText(text: string): ParsedNodePlacement {
  const parsed = parseNodePlacementText(text);
  if (parsed && skipTikzWhitespace(text, parsed.end) === text.length) return parsed.placement;
  return {
    nodeName: undefined,
    positionText: text.trim(),
    text: text.trim(),
  };
}

export function emitStructuredStatementBody(structured: StructuredStatementBody): string {
  const parts: string[] = [];
  let positionIndex = 0;
  if (structured.positionTexts[0]) parts.push(structured.positionTexts[0]);
  for (const segment of structured.segments) {
    if (segment.kind === 'connection') {
      const endPos = structured.positionTexts[positionIndex + 1] ?? segment.endPositionText;
      parts.push(`${segment.operator} ${endPos}`.trim());
      positionIndex += 1;
      continue;
    }
    if (segment.kind === 'bipole') {
      const endPos = structured.positionTexts[positionIndex + 1] ?? segment.endPositionText;
      const patched: EditableBipoleSegment = endPos !== segment.endPositionText
        ? { ...segment, endPositionText: endPos }
        : segment;
      parts.push(serializeBipoleSegment(patched));
      positionIndex += 1;
      continue;
    }
    if (segment.kind === 'node') {
      parts.push(serializeNodeSegment(segment));
      continue;
    }
    if (segment.kind === 'raw') {
      parts.push(segment.rawText);
      continue;
    }
    continue;
  }
  for (let i = Math.max(1, positionIndex + 1); i < structured.positionTexts.length; i++) {
    parts.push(structured.positionTexts[i]);
  }
  return parts.join(' ').trim();
}

export function emitStructuredNodeStatement(structured: StructuredStatementBody): string | null {
  if (structured.segments.length !== 1 || structured.segments[0].kind !== 'node' || !structured.positionTexts[0]) return null;
  const segment = structured.segments[0];
  const options: string[] = [];
  if (segment.tikzName) options.push(segment.tikzName);
  if (segment.optionsText) options.push(segment.optionsText);
  const placement = splitNodePlacementText(structured.positionTexts[0]);
  const nodeName = segment.nodeName ?? placement.nodeName;
  return `node${options.length > 0 ? `[${options.join(', ')}]` : ''} ${buildNodePlacementText(nodeName, placement.positionText)} {${segment.text ?? ''}}`;
}

export function parseStructuredStatementBody(body: string): StructuredStatementBody | null {
  const start = scanTikzPointSequence(body, 0);
  if (!start) return null;
  let cursor = start.end;
  const positionTexts = [start.text];
  const segments: EditableSegment[] = [];
  while (true) {
    cursor = skipTikzWhitespace(body, cursor);
    if (cursor >= body.length) break;
    const node = parseNodeSegment(body, cursor, true);
    if (node) {
      segments.push(node.segment);
      cursor = node.end;
      continue;
    }
    const bipole = parseBipoleSegment(body, cursor);
    if (bipole) {
      segments.push(bipole.segment);
      positionTexts.push(bipole.segment.endPositionText);
      cursor = bipole.end;
      continue;
    }
    const connection = parseConnectionSegment(body, cursor);
    if (connection) {
      segments.push(connection.segment);
      positionTexts.push(connection.segment.endPositionText);
      cursor = connection.end;
      continue;
    }
    const point = scanTikzPointSequence(body, cursor);
    if (point) {
      positionTexts.push(point.text);
      cursor = point.end;
      continue;
    }
    return null;
  }
  return { positionTexts, segments };
}

export function parseStructuredNodeStatement(source: string): StructuredStatementBody | null {
  const nodeStart = readKeyword(source, 0, 'node');
  if (nodeStart == null) return null;
  let cursor = skipTikzWhitespace(source, nodeStart);
  let optionsText = '';
  if (source[cursor] === '[') {
    const options = readTikzBalanced(source, cursor, '[', ']');
    if (!options) return null;
    optionsText = options.text.slice(1, -1).trim();
    cursor = options.end;
  }
  const placement = parseNodePlacementText(source, cursor);
  if (!placement) return null;
  cursor = skipTikzWhitespace(source, placement.end);
  const textGroup = readTikzBalanced(source, cursor, '{', '}');
  if (!textGroup) return null;
  if (skipTikzWhitespace(source, textGroup.end) !== source.length) return null;
  const optionParts = optionsText ? splitOptions(optionsText) : [];
  const firstOption = optionParts[0]?.trim();
  const hasComponentName = Boolean(firstOption && !firstOption.includes('='));
  return {
    positionTexts: [placement.placement.text],
    segments: [{
      kind: 'node',
      nodeName: placement.placement.nodeName,
      optionsText: hasComponentName ? optionParts.slice(1).join(', ').trim() || undefined : optionsText || undefined,
      positionText: placement.placement.text,
      text: textGroup.text.slice(1, -1).trim() || undefined,
      tikzName: hasComponentName ? firstOption : undefined,
    }],
  };
}
