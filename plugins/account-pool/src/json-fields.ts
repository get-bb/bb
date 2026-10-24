const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;
const UTF8_BOM = [0xef, 0xbb, 0xbf];

export interface JsonFieldSpan {
  start: number;
  end: number;
}

const decoder = new TextDecoder();

function isWhitespace(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function skipWhitespace(bytes: Uint8Array, index: number): number {
  let cursor = index;
  while (isWhitespace(bytes[cursor])) cursor += 1;
  return cursor;
}

function skipString(bytes: Uint8Array, index: number): number {
  let cursor = index + 1;
  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    if (byte === BACKSLASH) cursor += 2;
    else if (byte === QUOTE) return cursor + 1;
    else cursor += 1;
  }
  return -1;
}

function skipValue(bytes: Uint8Array, index: number): number {
  const first = bytes[index];
  if (first === QUOTE) return skipString(bytes, index);
  if (first === OPEN_BRACE || first === OPEN_BRACKET) {
    let depth = 0;
    let cursor = index;
    while (cursor < bytes.length) {
      const byte = bytes[cursor];
      if (byte === QUOTE) {
        cursor = skipString(bytes, cursor);
        if (cursor === -1) return -1;
        continue;
      }
      if (byte === OPEN_BRACE || byte === OPEN_BRACKET) depth += 1;
      else if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
        depth -= 1;
        if (depth === 0) return cursor + 1;
      }
      cursor += 1;
    }
    return -1;
  }
  let cursor = index;
  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    if (
      byte === COMMA ||
      byte === CLOSE_BRACE ||
      byte === CLOSE_BRACKET ||
      isWhitespace(byte)
    )
      break;
    cursor += 1;
  }
  return cursor === index ? -1 : cursor;
}

function readKey(bytes: Uint8Array, start: number, end: number): string | null {
  try {
    const key: unknown = JSON.parse(decoder.decode(bytes.subarray(start, end)));
    return typeof key === "string" ? key : null;
  } catch {
    return null;
  }
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return UTF8_BOM.every((byte, index) => bytes[index] === byte);
}

export function findTopLevelJsonFields(
  bytes: Uint8Array,
  keys: ReadonlySet<string>,
): Map<string, JsonFieldSpan> | null {
  const fields = new Map<string, JsonFieldSpan>();
  let cursor = skipWhitespace(bytes, hasUtf8Bom(bytes) ? UTF8_BOM.length : 0);
  if (bytes[cursor] !== OPEN_BRACE) return null;
  cursor = skipWhitespace(bytes, cursor + 1);
  if (bytes[cursor] === CLOSE_BRACE) {
    return skipWhitespace(bytes, cursor + 1) === bytes.length ? fields : null;
  }
  while (cursor < bytes.length) {
    if (bytes[cursor] !== QUOTE) return null;
    const keyEnd = skipString(bytes, cursor);
    if (keyEnd === -1) return null;
    const key = readKey(bytes, cursor, keyEnd);
    if (key === null) return null;
    cursor = skipWhitespace(bytes, keyEnd);
    if (bytes[cursor] !== COLON) return null;
    const valueStart = skipWhitespace(bytes, cursor + 1);
    const valueEnd = skipValue(bytes, valueStart);
    if (valueEnd === -1) return null;
    if (keys.has(key)) fields.set(key, { start: valueStart, end: valueEnd });
    cursor = skipWhitespace(bytes, valueEnd);
    if (bytes[cursor] === COMMA) {
      cursor = skipWhitespace(bytes, cursor + 1);
      continue;
    }
    if (bytes[cursor] !== CLOSE_BRACE) return null;
    return skipWhitespace(bytes, cursor + 1) === bytes.length ? fields : null;
  }
  return null;
}

export function parseJsonField(
  bytes: Uint8Array,
  span: JsonFieldSpan | undefined,
): unknown {
  return span === undefined
    ? undefined
    : JSON.parse(decoder.decode(bytes.subarray(span.start, span.end)));
}

export function replaceJsonField(
  bytes: Uint8Array,
  span: JsonFieldSpan,
  value: unknown,
): Uint8Array {
  const replacement = new TextEncoder().encode(JSON.stringify(value));
  const result = new Uint8Array(
    bytes.length - (span.end - span.start) + replacement.length,
  );
  result.set(bytes.subarray(0, span.start), 0);
  result.set(replacement, span.start);
  result.set(bytes.subarray(span.end), span.start + replacement.length);
  return result;
}
