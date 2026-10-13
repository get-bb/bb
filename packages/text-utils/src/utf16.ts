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

export function sliceUtf16Head(value: string, maxChars: number): string {
  let end = Math.min(value.length, Math.max(0, maxChars));
  if (isHighSurrogateAt(value, end - 1) && isLowSurrogateAt(value, end)) {
    end -= 1;
  }
  return value.slice(0, end);
}

export function sliceUtf16Tail(value: string, maxChars: number): string {
  let start = Math.max(0, value.length - Math.max(0, maxChars));
  if (isHighSurrogateAt(value, start - 1) && isLowSurrogateAt(value, start)) {
    start += 1;
  }
  return value.slice(start);
}

export function sliceUtf16HeadAndTail(
  value: string,
  headChars: number,
  tailChars: number,
): Utf16HeadTailSlices {
  return {
    head: sliceUtf16Head(value, headChars),
    tail: sliceUtf16Tail(value, tailChars),
  };
}
