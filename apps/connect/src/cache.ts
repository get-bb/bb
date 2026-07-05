// Edge-cache layer for the tunnel gate. Immutable, content-hashed assets from a
// production bb build are cached at the Cloudflare edge so repeat requests skip
// the tunnel round-trip entirely — turning a page's hundreds of asset requests
// into a handful of dynamic API calls plus edge hits.
//
// Security: only called AFTER the gate has verified the requester owns `handle`,
// and the cache key is namespaced by handle, so a cached body can never be
// served to another account. Caching is opt-in via the ORIGIN's Cache-Control,
// so a dev server (no-cache module responses) is proxied uncached and correct,
// while a bundled build (max-age=31536000, immutable) is cached.

const CACHE_HOST = "https://bb-connect-asset-cache.internal";
const MIN_CACHEABLE_MAX_AGE = 300;

function cacheKey(handle: string, url: URL): Request {
  return new Request(`${CACHE_HOST}/${handle}${url.pathname}${url.search}`, { method: "GET" });
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
 */
export async function serveWithCache(
  request: Request,
  handle: string,
  ctx: ExecutionContext,
  fetchOrigin: () => Promise<Response>,
): Promise<Response> {
  if (request.method !== "GET") return fetchOrigin();

  const url = new URL(request.url);
  const key = cacheKey(handle, url);
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
