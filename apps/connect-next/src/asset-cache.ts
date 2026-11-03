import type { Encoding } from "./compress.js";
import { getHeader, hasHeader, type HeaderPairs } from "./headers.js";
import { Lru } from "./lru.js";

export const MIN_CACHEABLE_MAX_AGE = 300;
const SHELL_TTL_MS = 300_000;
const ENTRY_OVERHEAD_BYTES = 512;

export interface StoredResponse {
  status: number;
  headers: HeaderPairs;
  body: Buffer;
}

export interface AssetCacheOptions {
  maxBytes: number;
  maxEntryBytes: number;
  maxEntries?: number;
  now?: () => number;
}

function sizeOf(entry: StoredResponse): number {
  let size = entry.body.length + ENTRY_OVERHEAD_BYTES;
  for (const [name, value] of entry.headers) size += name.length + value.length;
  return size;
}

function cacheControl(headers: HeaderPairs): string {
  return getHeader(headers, "cache-control") ?? "";
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

export function cacheableMaxAge(
  status: number,
  headers: HeaderPairs,
): number | null {
  if (!isOk(status) || hasHeader(headers, "set-cookie")) return null;
  const cc = cacheControl(headers);
  if (/\b(no-store|no-cache|private)\b/iu.test(cc)) return null;
  const maxAge = /max-age=(\d+)/iu.exec(cc);
  if (maxAge === null) return null;
  const seconds = Number(maxAge[1]);
  return seconds >= MIN_CACHEABLE_MAX_AGE ? seconds : null;
}

export function isRevalidatableShell(
  status: number,
  headers: HeaderPairs,
): boolean {
  if (!isOk(status) || hasHeader(headers, "set-cookie")) return false;
  if (getHeader(headers, "etag") === null) return false;
  const cc = cacheControl(headers);
  if (/\b(no-store|private)\b/iu.test(cc)) return false;
  return /\bno-cache\b/iu.test(cc);
}

export class AssetCache {
  private readonly assets: Lru<StoredResponse>;
  private readonly shells: Lru<StoredResponse>;
  private readonly now: () => number;
  readonly maxEntryBytes: number;

  constructor(options: AssetCacheOptions) {
    const maxEntries = options.maxEntries ?? 50_000;
    const limits = { maxEntries, maxBytes: options.maxBytes / 2, sizeOf };
    this.assets = new Lru(limits);
    this.shells = new Lru(limits);
    this.now = options.now ?? Date.now;
    this.maxEntryBytes = options.maxEntryBytes;
  }

  key(namespace: string, pathAndQuery: string, encoding: Encoding): string {
    return `${namespace}\n${encoding}\n${pathAndQuery}`;
  }

  asset(key: string): StoredResponse | undefined {
    return this.assets.get(key, this.now());
  }

  shell(key: string): StoredResponse | undefined {
    return this.shells.get(key, this.now());
  }

  storeAsset(key: string, entry: StoredResponse, maxAgeSeconds: number): void {
    this.assets.set(key, entry, this.now() + maxAgeSeconds * 1000);
  }

  storeShell(key: string, entry: StoredResponse): void {
    this.shells.set(key, entry, this.now() + SHELL_TTL_MS);
  }

  dropShell(key: string): void {
    this.shells.delete(key);
  }
}
