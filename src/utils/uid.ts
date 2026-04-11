let counter = 0;

export function uid(prefix: string = 'el'): string {
  return `${prefix}_${++counter}`;
}
