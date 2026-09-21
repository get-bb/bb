export interface Utf16HeadTailSlices {
  head: string;
  tail: string;
}

function isHighSurrogateAt(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogateAt(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

export function sliceUtf16HeadAndTail(
  value: string,
  headChars: number,
  tailChars: number,
): Utf16HeadTailSlices {
  let headEnd = Math.min(value.length, Math.max(0, headChars));
  if (
    isHighSurrogateAt(value, headEnd - 1) &&
    isLowSurrogateAt(value, headEnd)
  ) {
    headEnd -= 1;
  }
  let tailStart = Math.max(0, value.length - Math.max(0, tailChars));
  if (
    isHighSurrogateAt(value, tailStart - 1) &&
    isLowSurrogateAt(value, tailStart)
  ) {
    tailStart += 1;
  }
  return {
    head: value.slice(0, headEnd),
    tail: value.slice(tailStart),
  };
}
