/**
 * The reserved bb-community plugin marketplace, served from R2.
 *
 * The registry repository (get-bb/marketplace) builds `marketplace.json` and
 * its icons and uploads them to the `bb-marketplace` bucket; this route reads
 * them back so the catalog stays on the getbb.app origin and header policy
 * lives in one place. Publishing a listing is therefore a registry action, not
 * a site deploy.
 */

/** Path prefix this route owns; everything after it is an R2 object key. */
export const MARKETPLACE_PATH_PREFIX = "/marketplace/v1/";

/** Manifest revalidates quickly; icons are immutable per URL. */
const MANIFEST_CACHE_CONTROL = "public, max-age=300, must-revalidate";
const ICON_CACHE_CONTROL = "public, max-age=31536000, immutable";

const CONTENT_TYPES: Record<string, string> = {
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Object key for a request path, or null when the path is outside this route
 * or could escape the prefix. Traversal is refused rather than normalized: R2
 * keys are opaque strings, so a `..` segment would fetch a real, wrong object.
 */
export function marketplaceObjectKey(pathname: string): string | null {
  if (!pathname.startsWith(MARKETPLACE_PATH_PREFIX)) return null;
  let key: string;
  try {
    key = decodeURIComponent(pathname.slice(MARKETPLACE_PATH_PREFIX.length));
  } catch {
    return null;
  }
  if (key.length === 0 || key.length > 512) return null;
  if (key.includes("\\") || key.includes("\0")) return null;
  const segments = key.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "..")) {
    return null;
  }
  return key;
}

function contentTypeFor(key: string): string {
  const extension = key.split(".").at(-1)?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

function notFound(reason: string): Response {
  return Response.json({ error: reason }, { status: 404 });
}

/**
 * Serve one marketplace object. The bucket binding is optional on purpose:
 * the bucket is provisioned separately from this deploy, so an unbound or
 * empty bucket answers 404 instead of failing the worker.
 */
export async function serveMarketplaceObject(args: {
  bucket: R2Bucket | undefined;
  request: Request;
}): Promise<Response> {
  const key = marketplaceObjectKey(new URL(args.request.url).pathname);
  if (key === null) return notFound("not found");
  if (args.bucket === undefined) {
    return notFound("marketplace storage is not configured");
  }

  const object = await args.bucket.get(key, {
    onlyIf: args.request.headers,
  });
  if (object === null) return notFound("not found");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set(
    "content-type",
    object.httpMetadata?.contentType ?? contentTypeFor(key),
  );
  headers.set(
    "cache-control",
    key.endsWith(".json") ? MANIFEST_CACHE_CONTROL : ICON_CACHE_CONTROL,
  );
  headers.set("x-content-type-options", "nosniff");
  // Third-party bytes on BB's own origin: never let one execute or frame.
  headers.set(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  );
  // The catalog is a public contract; BB clients read it cross-origin.
  headers.set("access-control-allow-origin", "*");

  // A conditional hit returns metadata without a body (R2Object, not
  // R2ObjectBody): answer 304 rather than an empty 200.
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  if (args.request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(object.body, { status: 200, headers });
}
