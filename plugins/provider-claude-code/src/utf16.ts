export function sliceUtf16Head(value: string, maxChars: number): string {
  const end = Math.min(value.length, Math.max(0, maxChars));
  const last = value.charCodeAt(end - 1);
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}
