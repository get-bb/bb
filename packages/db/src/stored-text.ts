import { createHash } from "node:crypto";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { sql, type SQLWrapper } from "drizzle-orm";
import { customType } from "drizzle-orm/sqlite-core";
import type Database from "better-sqlite3";

export const STORED_TEXT_MIN_BYTES = 512;
export const STORED_TEXT_MAX_BYTES = 8 * 1024 * 1024;
const MAGIC = Buffer.from("BBTXT001");
const HEADER_BYTES = MAGIC.length + 4;
const CACHE_BYTES = 8 * 1024 * 1024;
const cache = new Map<string, { text: string; bytes: number }>();
let cacheBytes = 0;

export class StoredTextDecodeError extends Error {
  constructor() {
    super("Stored text failed verification");
    this.name = "StoredTextDecodeError";
  }
}

function encodedTextLength(value: Buffer): number {
  if (
    value.length <= HEADER_BYTES ||
    !value.subarray(0, MAGIC.length).equals(MAGIC)
  )
    throw new StoredTextDecodeError();
  const length = value.readUInt32LE(MAGIC.length);
  if (length < STORED_TEXT_MIN_BYTES || length > STORED_TEXT_MAX_BYTES)
    throw new StoredTextDecodeError();
  return length;
}

export function decodeStoredText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Buffer.isBuffer(value)) throw new StoredTextDecodeError();
  const length = encodedTextLength(value);
  const key = createHash("sha256").update(value).digest("hex");
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.text;
  }
  let text: string;
  try {
    const raw = zstdDecompressSync(value.subarray(HEADER_BYTES), {
      maxOutputLength: length,
    });
    if (raw.length !== length) throw new StoredTextDecodeError();
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      raw,
    );
  } catch {
    throw new StoredTextDecodeError();
  }
  const bytes = text.length * 2 + 128;
  if (bytes <= CACHE_BYTES) {
    while (cacheBytes + bytes > CACHE_BYTES) {
      const oldest = cache.entries().next().value;
      if (!oldest) break;
      cache.delete(oldest[0]);
      cacheBytes -= oldest[1].bytes;
    }
    cache.set(key, { text, bytes });
    cacheBytes += bytes;
  }
  return text;
}

export function encodeStoredText(text: string): Buffer | null {
  const raw = Buffer.from(text, "utf8");
  if (raw.length < STORED_TEXT_MIN_BYTES || raw.length > STORED_TEXT_MAX_BYTES)
    return null;
  const payload = zstdCompressSync(raw, {
    params: {
      [constants.ZSTD_c_compressionLevel]: 3,
      [constants.ZSTD_c_checksumFlag]: 1,
    },
  });
  if (payload.length + HEADER_BYTES >= raw.length) return null;
  const encoded = Buffer.alloc(HEADER_BYTES + payload.length);
  MAGIC.copy(encoded);
  encoded.writeUInt32LE(raw.length, MAGIC.length);
  payload.copy(encoded, HEADER_BYTES);
  if (decodeStoredText(encoded) !== text) throw new StoredTextDecodeError();
  return encoded;
}

export const compressedText = customType<{
  data: string;
  driverData: string | Buffer;
}>({
  dataType: () => "text",
  fromDriver: decodeStoredText,
  toDriver: (value) => value,
});

export function storedText(column: SQLWrapper) {
  return sql<string>`bb_text(${column})`;
}

export function storedTextBytes(column: SQLWrapper) {
  return sql<number>`bb_text_bytes(${column})`;
}

export function registerStoredTextSqlFunctions(db: Database.Database): void {
  db.function("bb_text", { deterministic: true }, (value) =>
    value === null ? null : decodeStoredText(value),
  );
  db.function("bb_text_bytes", { deterministic: true }, (value) => {
    if (value === null) return null;
    if (typeof value === "string") return Buffer.byteLength(value, "utf8");
    if (Buffer.isBuffer(value)) return encodedTextLength(value);
    throw new StoredTextDecodeError();
  });
}
