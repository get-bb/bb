// The revalidated shell cache, exercised through the real TunnelDO and the
// real serveWithCache inside workerd (miniflare) — the same harness as
// response-encoding.test.ts, because the cache stores still-encoded bytes and
// `encodeBody` exists only in workerd.
//
// The fake tunnel client plays a bb server that speaks the shell contract:
// `max-age=300, must-revalidate` plus a build-id ETag, 304 for a matching
// If-None-Match. The tests pin the design's three properties: a repeat
// navigation is served from caches.default with only a 304 on the tunnel, a
// build change takes effect on the next navigation, and a visitor's own
// conditional request relays the origin's 304.
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame, type Frame } from "@bb/tunnel-contract";

const SHELL_CACHE_CONTROL = "max-age=300, must-revalidate";

const BUILD_A = {
  etag: 'W/"build-a"',
  html: `<!doctype html><title>bb</title>${"<p>build a</p>".repeat(40)}`,
};
const BUILD_B = {
  etag: 'W/"build-b"',
  html: `<!doctype html><title>bb</title>${"<p>build b — new hashes</p>".repeat(40)}`,
};

type ClientWebSocket = NonNullable<
  Awaited<ReturnType<Miniflare["dispatchFetch"]>>["webSocket"]
>;

let mf: Miniflare;
let tunnel: ClientWebSocket;

/** What the fake bb server serves right now; tests flip it to ship a build. */
let currentBuild = BUILD_A;
/** One entry per relayed request: what the origin saw and had to send. */
const originLog: { ifNoneMatch: string | null; sentBody: boolean }[] = [];

async function bundleFixture(): Promise<string> {
  const result = await build({
    entryPoints: [
      fileURLToPath(new URL("../test/encoding-fixture.ts", import.meta.url)),
    ],
    bundle: true,
    format: "esm",
    target: "esnext",
    conditions: ["workerd", "worker", "browser"],
    write: false,
  });
  return result.outputFiles[0].text;
}

/** A tunnel client whose origin serves the shell contract for every path. */
function serveShellOverTunnel(ws: ClientWebSocket): void {
  const send = (frame: Frame) => ws.send(new Uint8Array(encodeFrame(frame)));
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") return;
    const frame = decodeFrame(event.data as ArrayBuffer);
    if (frame.type !== "open-http") return;
    const ifNoneMatch =
      frame.headers.find(([name]) => name.toLowerCase() === "if-none-match")?.[1] ??
      null;
    if (ifNoneMatch === currentBuild.etag) {
      originLog.push({ ifNoneMatch, sentBody: false });
      send({
        type: "resp-head",
        streamId: frame.streamId,
        status: 304,
        headers: [
          ["etag", currentBuild.etag],
          ["cache-control", SHELL_CACHE_CONTROL],
        ],
      });
      send({ type: "body-end", streamId: frame.streamId });
      return;
    }
    originLog.push({ ifNoneMatch, sentBody: true });
    const gzip = gzipSync(Buffer.from(currentBuild.html));
    send({
      type: "resp-head",
      streamId: frame.streamId,
      status: 200,
      headers: [
        ["content-type", "text/html; charset=utf-8"],
        ["content-encoding", "gzip"],
        ["content-length", String(gzip.byteLength)],
        ["cache-control", SHELL_CACHE_CONTROL],
        ["etag", currentBuild.etag],
      ],
    });
    send({
      type: "body-chunk",
      streamId: frame.streamId,
      data: new Uint8Array(gzip),
    });
    send({ type: "body-end", streamId: frame.streamId });
  });
}

async function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  cacheMarker: string | null;
  etag: string | null;
  body: string;
}> {
  const res = await mf.dispatchFetch(`https://relay.test${path}`, {
    headers: { "accept-encoding": "gzip", ...headers },
  });
  return {
    status: res.status,
    cacheMarker: res.headers.get("x-bb-cache"),
    etag: res.headers.get("etag"),
    body: Buffer.from(await res.arrayBuffer()).toString("utf8"),
  };
}

/** Cache writes ride ctx.waitUntil; poll the fixture's probe before relying on them. */
async function waitForShellCached(path: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const res = await mf.dispatchFetch(
      `https://relay.test/shell-cached?for=${encodeURIComponent(path)}`,
    );
    if (res.status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`shell copy for ${path} never landed in caches.default`);
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: [
      {
        type: "ESModule",
        path: "/fixture.js",
        contents: await bundleFixture(),
      },
    ],
    modulesRoot: "/",
    scriptPath: "/fixture.js",
    compatibilityDate: "2026-06-11",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { TUNNEL_DO: "TunnelDO" },
    d1Databases: { DB: "fixture-db" },
    bindings: {
      BASE_DOMAIN: "relay.test",
      BETTER_AUTH_SECRET: "fixture-secret",
      GZIP_BODY_B64: gzipSync(Buffer.from("unused")).toString("base64"),
    },
  });
  await mf.ready;

  const dial = await mf.dispatchFetch("https://relay.test/__tunnel", {
    headers: { Upgrade: "websocket" },
  });
  if (!dial.webSocket) throw new Error(`tunnel dial failed: ${dial.status}`);
  tunnel = dial.webSocket;
  tunnel.accept();
  serveShellOverTunnel(tunnel);
}, 60_000);

afterAll(async () => {
  tunnel?.close();
  await mf?.dispose();
});

describe("revalidated shell cache", () => {
  it("serves repeats from caches.default with only a 304 on the tunnel, and ships a new build on the next navigation", async () => {
    // Cold: full document through the tunnel, stored at the edge.
    const cold = await get("/threads/t1");
    expect(cold.status).toBe(200);
    expect(cold.body).toBe(BUILD_A.html);
    expect(cold.cacheMarker).toBe("miss");
    expect(originLog.at(-1)).toEqual({ ifNoneMatch: null, sentBody: true });
    await waitForShellCached("/threads/t1");

    // Repeat: the origin only confirms the ETag; the body comes from the
    // edge cache.
    const repeat = await get("/threads/t1");
    expect(repeat.status).toBe(200);
    expect(repeat.body).toBe(BUILD_A.html);
    expect(repeat.cacheMarker).toBe("revalidated");
    expect(originLog.at(-1)).toEqual({
      ifNoneMatch: BUILD_A.etag,
      sentBody: false,
    });

    // Ship a build: the same conditional request now returns the fresh 200,
    // so the next navigation renders the new shell.
    currentBuild = BUILD_B;
    const upgraded = await get("/threads/t1");
    expect(upgraded.status).toBe(200);
    expect(upgraded.body).toBe(BUILD_B.html);
    expect(upgraded.etag).toBe(BUILD_B.etag);
    expect(upgraded.cacheMarker).toBe("miss");
    expect(originLog.at(-1)).toEqual({
      ifNoneMatch: BUILD_A.etag,
      sentBody: true,
    });
    await waitForShellCached("/threads/t1");

    // And the new build revalidates from the edge like the old one did.
    const settled = await get("/threads/t1");
    expect(settled.body).toBe(BUILD_B.html);
    expect(settled.cacheMarker).toBe("revalidated");
    expect(originLog.at(-1)).toEqual({
      ifNoneMatch: BUILD_B.etag,
      sentBody: false,
    });
  }, 30_000);

  it("relays the origin's 304 when the visitor presents a current validator", async () => {
    currentBuild = BUILD_B;
    const res = await get("/threads/t1", { "if-none-match": BUILD_B.etag });
    expect(res.status).toBe(304);
    expect(res.body).toBe("");
    expect(res.cacheMarker).toBe("revalidated");
    expect(originLog.at(-1)).toEqual({
      ifNoneMatch: BUILD_B.etag,
      sentBody: false,
    });
  }, 30_000);
});
