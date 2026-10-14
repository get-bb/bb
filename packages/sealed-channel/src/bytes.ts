const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_LOOKUP = new Map<string, number>(
  [...BASE64URL_ALPHABET].map((char, index) => [char, index]),
);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8Encode(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function utf8Decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = index + 1 < bytes.length ? bytes[index + 1]! : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64URL_ALPHABET[(triple >> 18) & 63];
    out += BASE64URL_ALPHABET[(triple >> 12) & 63];
    if (index + 1 < bytes.length) out += BASE64URL_ALPHABET[(triple >> 6) & 63];
    if (index + 2 < bytes.length) out += BASE64URL_ALPHABET[triple & 63];
  }
  return out;
}

export function base64UrlDecode(value: string): Uint8Array {
  const clean = value.replace(/=+$/u, "");
  if (!/^[A-Za-z0-9_-]*$/u.test(clean)) {
    throw new Error("sealed-channel: invalid base64url input");
  }
  const remainder = clean.length % 4;
  if (remainder === 1) {
    throw new Error("sealed-channel: invalid base64url length");
  }
  const outLength = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(outLength);
  let bits = 0;
  let accumulator = 0;
  let cursor = 0;
  for (const char of clean) {
    accumulator = (accumulator << 6) | BASE64URL_LOOKUP.get(char)!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[cursor++] = (accumulator >> bits) & 0xff;
    }
  }
  return out;
}

export function hexEncode(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index]! ^ b[index]!;
  }
  return diff === 0;
}

export function toUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

export function writeUint64BE(
  value: number,
  target: Uint8Array,
  offset: number,
): void {
  const view = new DataView(
    target.buffer,
    target.byteOffset,
    target.byteLength,
  );
  view.setUint32(offset, Math.floor(value / 0x1_0000_0000));
  view.setUint32(offset + 4, value >>> 0);
}

export function readUint64BE(source: Uint8Array, offset: number): number {
  const view = new DataView(
    source.buffer,
    source.byteOffset,
    source.byteLength,
  );
  return view.getUint32(offset) * 0x1_0000_0000 + view.getUint32(offset + 4);
}
