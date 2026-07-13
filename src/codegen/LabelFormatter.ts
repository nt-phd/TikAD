/**
 * Formats a label for CircuiTikZ.
 * UI values stay clean (e.g. `$C_2$`), while emitted code is always
 * wrapped in `{...}` for robust TikZ option parsing.
 */
export function formatLabel(raw: string): string {
  if (!raw) return '';
  let value = raw.trim();
  if (value.startsWith('{') && value.endsWith('}')) {
    value = value.slice(1, -1).trim();
  }
  return `{${value}}`;
}
