const MARKETPLACE_PATH_PREFIX = "/marketplace/v1/";

const MANIFEST_CACHE_CONTROL = "public, max-age=300, must-revalidate";
const ICON_CACHE_CONTROL = "public, max-age=31536000, immutable";

const CONTENT_TYPES: Record<string, string> = {
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
};

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
  headers.set(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  );
  headers.set("access-control-allow-origin", "*");

  if (!("body" in object)) return new Response(null, { status: 304, headers });
  if (args.request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(object.body, { status: 200, headers });
}
