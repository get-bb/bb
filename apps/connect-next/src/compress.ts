import { constants, createBrotliCompress, createGzip } from "node:zlib";
import type { Transform } from "node:stream";
import { getHeader, type HeaderPairs } from "./headers.js";

export type Encoding = "br" | "gzip" | "identity";

const MIN_COMPRESS_BYTES = 1024;
const COMPRESSIBLE_TYPE =
  /^(text\/(?!event-stream)|application\/(json|javascript|ecmascript|xml|wasm|manifest\+json|ld\+json|x-ndjson|[a-z.+-]+\+(json|xml))|image\/svg\+xml|font\/(ttf|otf))/iu;

export function preferredEncoding(
  acceptEncoding: string | undefined,
): Encoding {
  const weights = new Map<string, number>();
  for (const part of (acceptEncoding ?? "").split(",")) {
    const [rawName = "", ...params] = part.split(";");
    const name = rawName.trim().toLowerCase();
    if (name === "") continue;
    let weight = 1;
    for (const param of params) {
      const [key = "", value = ""] = param.split("=");
      if (key.trim().toLowerCase() === "q") weight = Number(value.trim());
    }
    weights.set(name, Number.isFinite(weight) ? weight : 0);
  }
  const accepts = (name: Encoding) =>
    (weights.get(name) ?? weights.get("*") ?? 0) > 0;
  if (accepts("br")) return "br";
  if (accepts("gzip")) return "gzip";
  return "identity";
}

export function shouldCompress(
  method: string,
  status: number,
  headers: HeaderPairs,
): boolean {
  if (method === "HEAD" || status < 200 || status === 204 || status === 304) {
    return false;
  }
  const encoding = getHeader(headers, "content-encoding");
  if (encoding !== null && encoding.trim().toLowerCase() !== "identity") {
    return false;
  }
  if (/\bno-transform\b/iu.test(getHeader(headers, "cache-control") ?? "")) {
    return false;
  }
  if (!COMPRESSIBLE_TYPE.test(getHeader(headers, "content-type") ?? "")) {
    return false;
  }
  const length = getHeader(headers, "content-length");
  return length === null || Number(length) >= MIN_COMPRESS_BYTES;
}

export interface CompressedBody {
  length: number | null;
  stored: boolean;
}

export const LARGE_DYNAMIC_BYTES = 16 * 1024;
export const STORED_BROTLI_QUALITY = 5;
export const SMALL_BROTLI_QUALITY = 5;
export const LARGE_BROTLI_QUALITY = 4;

export function brotliQuality(body: CompressedBody): number {
  if (body.stored) return STORED_BROTLI_QUALITY;
  return body.length !== null && body.length < LARGE_DYNAMIC_BYTES
    ? SMALL_BROTLI_QUALITY
    : LARGE_BROTLI_QUALITY;
}

export function compressor(
  encoding: "br" | "gzip",
  body: CompressedBody,
): Transform {
  const { length } = body;
  const streaming = length === null;
  if (encoding === "gzip") {
    return createGzip({
      level: 6,
      ...(streaming ? { flush: constants.Z_SYNC_FLUSH } : {}),
    });
  }
  return createBrotliCompress({
    ...(streaming ? { flush: constants.BROTLI_OPERATION_FLUSH } : {}),
    params: {
      [constants.BROTLI_PARAM_QUALITY]: brotliQuality(body),
      ...(length === null
        ? {}
        : { [constants.BROTLI_PARAM_SIZE_HINT]: length }),
    },
  });
}
