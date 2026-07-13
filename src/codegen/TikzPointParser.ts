export type TikzRelativeMode = 'none' | '+' | '++';

export type TikzPointKind =
  | 'regular'
  | 'node-ref'
  | 'calc'
  | 'options'
  | 'coordinate-system'
  | 'intersection'
  | 'hv'
  | 'vh'
  | 'polar'
  | 'unknown';

export interface TikzPointSpec {
  innerRaw: string;
  kind: TikzPointKind;
  raw: string;
  relativeMode: TikzRelativeMode;
}

export interface TikzPointScanResult {
  end: number;
  point: TikzPointSpec;
  text: string;
}

function isWhitespace(ch: string | undefined): boolean {
  return Boolean(ch && /\s/.test(ch));
}

export function skipTikzWhitespace(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
  return cursor;
}

export function readTikzBalanced(
  source: string,
  index: number,
  open: string,
  close: string,
): { end: number; text: string } | null {
  if (source[index] !== open) return null;
  let depth = 0;
  let inMath = false;
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const ch = source[cursor];
    const prev = cursor > 0 ? source[cursor - 1] : '';
    if (ch === '$' && prev !== '\\') {
      inMath = !inMath;
      continue;
    }
    if (inMath) continue;
    if (ch === open) {
      depth += 1;
      continue;
    }
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return { end: cursor + 1, text: source.slice(index, cursor + 1) };
    }
  }
  return null;
}

function findTopLevelToken(source: string, token: string): number {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let inMath = false;
  for (let index = 0; index <= source.length - token.length; index += 1) {
    const ch = source[index];
    const prev = index > 0 ? source[index - 1] : '';
    if (ch === '$' && prev !== '\\') {
      inMath = !inMath;
      continue;
    }
    if (inMath) continue;
    if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    if (paren === 0 && bracket === 0 && brace === 0 && source.startsWith(token, index)) return index;
  }
  return -1;
}

function classifyTikzPointInner(innerRaw: string): TikzPointKind {
  const trimmed = innerRaw.trim();
  if (!trimmed) return 'unknown';
  if (trimmed.startsWith('[')) return 'options';
  if (trimmed.startsWith('$') && trimmed.endsWith('$')) return 'calc';
  if (trimmed.includes('cs:')) return 'coordinate-system';
  if (trimmed.includes('intersection ')) return 'intersection';
  if (findTopLevelToken(trimmed, '-|') >= 0) return 'hv';
  if (findTopLevelToken(trimmed, '|-') >= 0) return 'vh';
  if (findTopLevelToken(trimmed, ',') >= 0) return 'regular';
  if (findTopLevelToken(trimmed, ':') >= 0) return 'polar';
  return 'node-ref';
}

export function scanTikzPoint(source: string, index: number): TikzPointScanResult | null {
  let cursor = skipTikzWhitespace(source, index);
  let relativeMode: TikzRelativeMode = 'none';
  if (source.startsWith('++', cursor)) {
    relativeMode = '++';
    cursor += 2;
  } else if (source[cursor] === '+') {
    relativeMode = '+';
    cursor += 1;
  }
  cursor = skipTikzWhitespace(source, cursor);
  const balanced = readTikzBalanced(source, cursor, '(', ')');
  if (!balanced) return null;
  const raw = source.slice(skipTikzWhitespace(source, index), balanced.end);
  const innerRaw = balanced.text.slice(1, -1);
  return {
    end: balanced.end,
    text: raw.trim(),
    point: {
      innerRaw,
      kind: classifyTikzPointInner(innerRaw),
      raw: raw.trim(),
      relativeMode,
    },
  };
}

export function scanTikzPointSequence(source: string, index: number): { end: number; points: TikzPointSpec[]; text: string } | null {
  let cursor = index;
  const points: TikzPointSpec[] = [];
  const texts: string[] = [];
  while (true) {
    const point = scanTikzPoint(source, cursor);
    if (!point) break;
    points.push(point.point);
    texts.push(point.text);
    cursor = skipTikzWhitespace(source, point.end);
    if (cursor >= source.length) break;
    const nextChar = source[cursor];
    if (!(nextChar === '(' || nextChar === '+' || source.startsWith('++', cursor))) break;
  }
  if (points.length === 0) return null;
  return {
    end: cursor,
    points,
    text: texts.join(' '),
  };
}
