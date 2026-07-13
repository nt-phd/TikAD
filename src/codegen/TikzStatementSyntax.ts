import { skipTikzWhitespace } from './TikzPointParser';

export function splitOptions(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function extractKV(opts: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const opt of opts) {
    const match = opt.trim().match(/^([a-zA-Z_]+)\s*=\s*(.+)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('{') && value.endsWith('}')) value = value.slice(1, -1).trim();
    result[match[1]] = value;
  }
  return result;
}

export function readKeyword(source: string, index: number, keyword: string): number | null {
  const cursor = skipTikzWhitespace(source, index);
  if (!source.startsWith(keyword, cursor)) return null;
  const after = cursor + keyword.length;
  if (/[A-Za-z]/.test(source[after] ?? '')) return null;
  return after;
}
