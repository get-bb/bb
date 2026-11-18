export function sliceUtf16Head(value: string, maxChars: number): string {
  const end = Math.min(value.length, Math.max(0, maxChars));
  const last = value.charCodeAt(end - 1);
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

export function sliceUtf16Tail(value: string, maxChars: number): string {
  const start = Math.max(0, value.length - Math.max(0, maxChars));
  const first = value.charCodeAt(start);
  return value.slice(first >= 0xdc00 && first <= 0xdfff ? start + 1 : start);
}
