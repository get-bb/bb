// Worker fixture for response-encoding.test.ts. Bundled with esbuild and run
// inside a real workerd (miniflare), because the bug it guards against — a
// relayed gzip body served to the browser as raw bytes — exists only in
// workerd's Response semantics and cannot be reproduced by Node's Response.
//
// This wires up the production pieces themselves: the real TunnelDO (driven by
// a fake tunnel client over a real WebSocket) behind the real serveWithCache.
import { cacheKey, serveWithCache } from "../src/cache.js";

export { TunnelDO } from "../src/tunnel-do.js";

interface FixtureEnv {
  TUNNEL_DO: DurableObjectNamespace;
  DB: D1Database;
  BASE_DOMAIN: string;
  BETTER_AUTH_SECRET: string;
  /** base64 of gzip bytes, for the pre-fix control route only. */
  GZIP_BODY_B64: string;
}

const NAMESPACE = "fixture-label";

function gzipBytes(env: FixtureEnv): Uint8Array {
  const bin = atob(env.GZIP_BODY_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default {
  async fetch(
    request: Request,
    env: FixtureEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const stub = env.TUNNEL_DO.get(env.TUNNEL_DO.idFromName("fixture"));

    // Tunnel client dial and direct (uncached) relay, as the gate does them.
    if (url.pathname === "/__tunnel" || url.pathname === "/direct") {
      return stub.fetch(request);
    }

    // Control: rebuild a pre-encoded body the way workerd's default encoding
    // does, to pin down the behaviour the fix exists to avoid.
    if (url.pathname === "/legacy-relay") {
      return new Response(gzipBytes(env), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "gzip",
        },
      });
    }

    // Reports how a relayed body looks to the gate when it reads it — the
    // invariant that makes serveWithCache's miss and hit paths asymmetric.
    if (url.pathname === "/subrequest-bytes") {
      const relayed = await stub.fetch(
        new Request(`${url.origin}/asset.js?cacheable=1`, request),
      );
      const raw = new Uint8Array(await relayed.arrayBuffer());
      return Response.json({
        byteLength: raw.byteLength,
        firstBytes: [...raw.subarray(0, 2)],
        contentEncoding: relayed.headers.get("content-encoding"),
      });
    }

    // Control: the pre-fix cache-hit rebuild, over the entry serveWithCache
    // stored for another path.
    if (url.pathname === "/legacy-cache-hit") {
      const target = url.searchParams.get("for") ?? "/";
      const cached = await caches.default.match(
        cacheKey(NAMESPACE, new URL(`${url.origin}${target}`)),
      );
      if (!cached) return new Response("not cached", { status: 404 });
      return new Response(cached.body, cached);
    }

    return serveWithCache(request, NAMESPACE, ctx, () => stub.fetch(request));
  },
};
