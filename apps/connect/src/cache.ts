// Edge-cache layer for the tunnel gate. Immutable, content-hashed assets from a
// production bb build are cached at the Cloudflare edge so repeat requests skip
// the tunnel round-trip entirely — turning a page's hundreds of asset requests
// into a handful of dynamic API calls plus edge hits.
//
// Security: only called AFTER the gate has verified the requester owns the
// handle, and the cache key is namespaced by host label (bare handle or
// `handle--port` share label), so a cached body can never be served across
// namespaces or accounts. Caching is opt-in via the ORIGIN's Cache-Control,
// so a dev server (no-cache module responses) is proxied uncached and correct,
// while a bundled build (max-age=31536000, immutable) is cached.

const CACHE_HOST = "https://bb-connect-asset-cache.internal";
const MIN_CACHEABLE_MAX_AGE = 300;

/** Build the edge-cache Request key for a namespace label + visitor URL. */
export function cacheKey(namespace: string, url: URL): Request {
  return new Request(`${CACHE_HOST}/${namespace}${url.pathname}${url.search}`, { method: "GET" });
}

function isCacheable(resp: Response): boolean {
  if (!resp.ok) return false;
  if (resp.headers.has("set-cookie")) return false;
  const cc = resp.headers.get("cache-control") ?? "";
  if (/\b(no-store|no-cache|private)\b/i.test(cc)) return false;
  const maxAge = cc.match(/max-age=(\d+)/i);
  return maxAge ? Number(maxAge[1]) >= MIN_CACHEABLE_MAX_AGE : false;
}

/**
 * Serve `request` from the edge cache when possible, else run `fetchOrigin`
 * (the tunnel) and populate the cache when the response is cacheable.
 *
 * `namespace` is the full host label used for key isolation — the bare handle
 * (`sawyer`) or a share label (`sawyer--8000`) — so share responses never
 * collide with app-asset cache entries.
 */
export async function serveWithCache(
  request: Request,
  namespace: string,
  ctx: ExecutionContext,
  fetchOrigin: () => Promise<Response>,
): Promise<Response> {
  if (request.method !== "GET") return fetchOrigin();

  const url = new URL(request.url);
  const key = cacheKey(namespace, url);
  const cache = caches.default;

  const hit = await cache.match(key);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set("x-bb-cache", "hit");
    return r;
  }

  const resp = await fetchOrigin();
  if (isCacheable(resp)) {
    // clone() before the body is consumed by the returned response.
    ctx.waitUntil(cache.put(key, resp.clone()));
    const r = new Response(resp.body, resp);
    r.headers.set("x-bb-cache", "miss");
    return r;
  }
  return resp;
}
