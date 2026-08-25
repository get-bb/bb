// Edge-cache layer for the tunnel gate. Immutable, content-hashed assets from a
// production bb build are cached at the Cloudflare edge so repeat requests skip
// the tunnel round-trip entirely — turning a page's hundreds of asset requests
// into a handful of dynamic API calls plus edge hits.
//
// Only called AFTER the gate has verified the requester owns the label. Server
// cache namespaces remain the bare/full host label exactly as on main; new
// machine labels include their ownership generation. Caching is opt-in via the
// ORIGIN's Cache-Control, so a dev server is proxied uncached while a bundled
// immutable build is cached.

import { rebuiltResponse } from "./response-encoding.js";

const CACHE_HOST = "https://bb-connect-asset-cache.internal";
const MIN_CACHEABLE_MAX_AGE = 300;

/** Build the edge-cache Request key for a namespace label + visitor URL. */
export function cacheKey(namespace: string, url: URL): Request {
  return new Request(`${CACHE_HOST}/${namespace}${url.pathname}${url.search}`, {
    method: "GET",
  });
}

function isCacheable(resp: Response): boolean {
  if (!resp.ok) return false;
  if (resp.headers.has("set-cookie")) return false;
  const cc = resp.headers.get("cache-control") ?? "";
  if (/\b(no-store|no-cache|private)\b/i.test(cc)) return false;
  const maxAge = cc.match(/max-age=(\d+)/i);
  return maxAge ? Number(maxAge[1]) >= MIN_CACHEABLE_MAX_AGE : false;
}

export interface CacheResult {
  /** True for both edge-cache hits and cacheable origin misses. */
  cacheable: boolean;
  response: Response;
}

/**
 * Serve `request` from the edge cache when possible, else run `fetchOrigin`
 * (the tunnel) and populate the cache when the response is cacheable.
 *
 * `namespace` is the server label or generation-isolated machine routing key,
 * plus the optional share target.
 */
export async function serveWithCache(
  request: Request,
  namespace: string,
  ctx: ExecutionContext,
  fetchOrigin: () => Promise<Response>,
): Promise<CacheResult> {
  if (request.method !== "GET") {
    return { cacheable: false, response: await fetchOrigin() };
  }

  const url = new URL(request.url);
  const key = cacheKey(namespace, url);
  const cache = caches.default;

  const hit = await cache.match(key);
  if (hit) {
    // The cache stores the origin's bytes still encoded, so `hit.body` is raw
    // gzip/br whenever the origin compressed — it must be rebuilt as
    // pre-encoded (see response-encoding.ts) or the visitor gets raw gzip
    // labelled text/html. This is NOT symmetric with the miss path below.
    const r = rebuiltResponse(hit.body, hit);
    r.headers.set("x-bb-cache", "hit");
    return { cacheable: true, response: r };
  }

  const resp = await fetchOrigin();
  if (isCacheable(resp)) {
    // clone() before the body is consumed by the returned response.
    ctx.waitUntil(cache.put(key, resp.clone()));
    // Subrequest bodies are the opposite case: workerd content-decodes a
    // tunnelled response as it is read here, so `resp.body` is already plain
    // bytes and the default (automatic) encoding is the correct one. Marking
    // this one pre-encoded would advertise a gzip body that isn't gzipped.
    const r = new Response(resp.body, resp);
    r.headers.set("x-bb-cache", "miss");
    return { cacheable: true, response: r };
  }
  return { cacheable: false, response: resp };
}
