export function utf8Prefix(text: string, maximumBytes: number): string {
  if (maximumBytes <= 0) return "";
  let result = "";
  let bytes = 0;
  for (const character of text) {
    const next = Buffer.byteLength(character, "utf8");
    if (bytes + next > maximumBytes) break;
    result += character;
    bytes += next;
  }
  return result;
}
