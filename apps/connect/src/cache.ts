// Edge-cache layer for the tunnel gate. Immutable, content-hashed assets from a
// production bb build are cached at the Cloudflare edge so repeat requests skip
// the tunnel round-trip entirely — turning a page's hundreds of asset requests
// into a handful of dynamic API calls plus edge hits.
//
// The app shell (index.html on every client route) gets a second, revalidated
// flavor: the origin serves it with `max-age=300, must-revalidate` plus a
// build-id ETag, so the worker keeps the last confirmed document at the edge
// and asks the laptop only "is <etag> still current?" on each navigation. A
// 304 costs the tunnel a handful of header bytes instead of the document, and
// a new build still takes effect on the next navigation because the origin
// answers that conditional request with the fresh 200.
//
// Only called AFTER the gate has verified the requester owns the label. Server
// cache namespaces remain the bare/full host label exactly as on main; new
// machine labels include their ownership generation. Caching is opt-in via the
// ORIGIN's Cache-Control, so a dev server is proxied uncached while a bundled
// immutable build is cached.

import { rebuiltResponse } from "./response-encoding.js";

const CACHE_HOST = "https://bb-connect-asset-cache.internal";
// A separate host keeps shell entries from ever colliding with asset entries
// for the same namespace + path.
const SHELL_CACHE_HOST = "https://bb-connect-shell-cache.internal";
const MIN_CACHEABLE_MAX_AGE = 300;

/**
 * The origin fetch for a gated request. `ifNoneMatch` asks the tunnel client
 * to make the request conditional so an unchanged shell answers with a 304.
 */
export type FetchOrigin = (init?: { ifNoneMatch: string }) => Promise<Response>;

/** Build the edge-cache Request key for a namespace label + visitor URL. */
export function cacheKey(namespace: string, url: URL): Request {
  return new Request(`${CACHE_HOST}/${namespace}${url.pathname}${url.search}`, {
    method: "GET",
  });
}

/** Edge-cache key for the revalidated shell copy of a namespace + URL. */
export function shellCacheKey(namespace: string, url: URL): Request {
  return new Request(
    `${SHELL_CACHE_HOST}/${namespace}${url.pathname}${url.search}`,
    { method: "GET" },
  );
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
 * A response the origin wants cached only under revalidation: a build-id ETag
 * plus `must-revalidate` with a short freshness window. The bb server marks
 * exactly one response this way — the app shell — but the check is
 * header-driven, so any origin (including a port share) opting in with the
 * same contract gets the same treatment. Checked before `isCacheable`: the
 * shell's `max-age=300` would otherwise be cached plainly and served without
 * the revalidation its `must-revalidate` demands.
 */
function isRevalidatableShell(resp: Response): boolean {
  if (!resp.ok) return false;
  if (resp.headers.has("set-cookie")) return false;
  if (resp.headers.get("etag") === null) return false;
  const cc = resp.headers.get("cache-control") ?? "";
  if (/\b(no-store|no-cache|private)\b/i.test(cc)) return false;
  if (!/\bmust-revalidate\b/i.test(cc)) return false;
  const maxAge = cc.match(/max-age=(\d+)/i);
  return maxAge !== null && Number(maxAge[1]) >= 1;
}

/**
 * Store the shell response and build the visitor's copy. The clone is stored
 * with its origin headers intact — including the ETag the entry is keyed to
 * in spirit: a stored shell is only ever served after the origin confirms
 * that exact ETag with a 304 — and its `max-age=300` bounds the storage, so
 * nothing stale outlives the origin's own freshness window.
 */
function storeShellAndServe(
  resp: Response,
  namespace: string,
  url: URL,
  ctx: ExecutionContext,
): CacheResult {
  ctx.waitUntil(caches.default.put(shellCacheKey(namespace, url), resp.clone()));
  // Same encoding rule as the asset miss below: a body read out of a
  // subrequest is already plain bytes, so automatic encoding is correct.
  const r = new Response(resp.body, resp);
  r.headers.set("x-bb-cache", "miss");
  return { cacheable: true, response: r };
}

/**
 * A shell copy exists at the edge: revalidate it against the origin before
 * serving. The visitor's own If-None-Match wins when present (the origin
 * validates it and a relayed 304 is the cheapest possible answer); otherwise
 * the stored copy's ETag makes the round trip a 304 whenever the build is
 * unchanged.
 */
async function serveRevalidatedShell(
  request: Request,
  shellHit: Response,
  namespace: string,
  url: URL,
  ctx: ExecutionContext,
  fetchOrigin: FetchOrigin,
): Promise<CacheResult> {
  const storedEtag = shellHit.headers.get("etag");
  const visitorEtag = request.headers.get("if-none-match");
  const conditionalEtag = visitorEtag ?? storedEtag;
  const resp = await fetchOrigin(
    conditionalEtag === null ? undefined : { ifNoneMatch: conditionalEtag },
  );
  if (resp.status === 304) {
    if (visitorEtag !== null) {
      // The origin confirmed the visitor's own copy — relay the 304.
      const r = rebuiltResponse(null, resp);
      r.headers.set("x-bb-cache", "revalidated");
      return { cacheable: true, response: r };
    }
    // The stored bytes are still encoded exactly like an asset hit's (the
    // cache keeps the origin's encoding), so rebuild as pre-encoded.
    // `cacheable: true` is load-bearing beyond refresh semantics: the
    // session-refresh path rebuilds non-cacheable responses to append
    // Set-Cookie, and that rebuild would strip this body's pre-encoded flag.
    const r = rebuiltResponse(shellHit.body, shellHit);
    r.headers.set("x-bb-cache", "revalidated");
    return { cacheable: true, response: r };
  }
  if (isRevalidatableShell(resp)) {
    return storeShellAndServe(resp, namespace, url, ctx);
  }
  if (resp.ok) {
    // The origin stopped speaking the shell contract (say a dev server took
    // over the label) — drop the stored copy so requests stop revalidating.
    ctx.waitUntil(caches.default.delete(shellCacheKey(namespace, url)));
  }
  return { cacheable: false, response: resp };
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
  fetchOrigin: FetchOrigin,
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

  // Not an immutable asset — maybe a previously stored shell document.
  const shellHit = await cache.match(shellCacheKey(namespace, url));
  if (shellHit) {
    return serveRevalidatedShell(
      request,
      shellHit,
      namespace,
      url,
      ctx,
      fetchOrigin,
    );
  }

  const resp = await fetchOrigin();
  if (isRevalidatableShell(resp)) {
    return storeShellAndServe(resp, namespace, url, ctx);
  }
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
