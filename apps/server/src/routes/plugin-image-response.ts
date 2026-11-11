import {
  bytesBody,
  operationBodyResponse,
  type OperationBody,
} from "@bb/operations";
import type { Context } from "hono";

export function hashedAssetCacheControl(
  requestedHash: string | undefined,
  hash: string,
): string {
  return requestedHash === hash
    ? "public, max-age=31536000, immutable"
    : "no-store";
}

export function imageBody(
  asset: { bytes: Uint8Array; contentType: string },
  cacheControl: string,
): OperationBody {
  return bytesBody(new Uint8Array(asset.bytes), {
    contentType: asset.contentType,
    headers: {
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'",
      "cache-control": cacheControl,
    },
  });
}

export function pluginImageResponse(
  _context: Pick<Context, "body">,
  asset: { bytes: Uint8Array; contentType: string },
  cacheControl: string,
): Response {
  return operationBodyResponse(imageBody(asset, cacheControl));
}
