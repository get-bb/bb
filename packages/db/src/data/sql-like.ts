export function likePrefixPattern(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}
