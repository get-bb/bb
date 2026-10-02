import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame, type Frame } from "@bb/tunnel-contract";

const HTML = `<!doctype html><title>bb</title>${"<p>relayed body</p>".repeat(50)}`;
const GZIP = gzipSync(Buffer.from(HTML));
const IMMUTABLE = "public, max-age=31536000, immutable";

type ClientWebSocket = NonNullable<
  Awaited<ReturnType<Miniflare["dispatchFetch"]>>["webSocket"]
>;

let mf: Miniflare;
let tunnel: ClientWebSocket;

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

function serveOriginOverTunnel(ws: ClientWebSocket): void {
  const send = (frame: Frame) => ws.send(new Uint8Array(encodeFrame(frame)));
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") return;
    const frame = decodeFrame(event.data as ArrayBuffer);
    if (frame.type !== "open-http") return;
    const cacheable =
      new URL(frame.path, "http://origin.local").searchParams.get(
        "cacheable",
      ) === "1";
    const cookieBoundary =
      frame.path === "/cookie-boundary" || frame.path === "/install.sh";
    send({
      type: "resp-head",
      streamId: frame.streamId,
      status: 200,
      headers: [
        ["content-type", "text/html; charset=utf-8"],
        ["content-encoding", "gzip"],
        ["content-length", String(GZIP.byteLength)],
        ["cache-control", cacheable ? IMMUTABLE : "no-store"],
        ...(cookieBoundary
          ? ([
              ["set-cookie", "tenant=kept; Path=/; HttpOnly"],
              [
                "set-cookie",
                "__Secure-better-auth.session_token=stolen; Secure; Path=/",
              ],
              ["set-cookie", "parent=stolen; Domain=.relay.test; Path=/"],
              [
                "x-origin-cookie",
                frame.headers.find(([name]) => name === "cookie")?.[1] ?? "",
              ],
            ] satisfies [string, string][])
          : []),
      ],
    });
    send({
      type: "body-chunk",
      streamId: frame.streamId,
      data: new Uint8Array(GZIP),
    });
    send({ type: "body-end", streamId: frame.streamId });
  });
}

const TRANSPORTS = ["object-held", "worker-held"] as const;
type Transport = (typeof TRANSPORTS)[number];

async function get(
  path: string,
  transport: Transport = "object-held",
): Promise<{ status: number; encoding: string | null; body: Buffer }> {
  const res = await mf.dispatchFetch(`https://relay.test${path}`, {
    headers: { "accept-encoding": "gzip", "x-fixture-transport": transport },
  });
  return {
    status: res.status,
    encoding: res.headers.get("content-encoding"),
    body: Buffer.from(await res.arrayBuffer()),
  };
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
      GZIP_BODY_B64: GZIP.toString("base64"),
    },
  });
  await mf.ready;

  const dial = await mf.dispatchFetch("https://relay.test/__tunnel", {
    headers: { Upgrade: "websocket" },
  });
  if (!dial.webSocket) throw new Error(`tunnel dial failed: ${dial.status}`);
  tunnel = dial.webSocket;
  tunnel.accept();
  serveOriginOverTunnel(tunnel);
}, 60_000);

afterAll(async () => {
  tunnel?.close();
  await mf?.dispose();
});

describe("relaying a gzip-encoded origin response", () => {
  it.each(TRANSPORTS)(
    "hands the visitor a body that decodes back to the origin's HTML (%s response)",
    async (transport) => {
      const res = await get(`/${transport}/index.html`, transport);

      expect(res.status).toBe(200);
      expect(res.body.toString("utf8")).toBe(HTML);
    },
  );

  it("would corrupt the response if it were rebuilt with workerd's default encoding", async () => {
    const res = await get("/legacy-relay");

    expect(res.encoding).toBeNull();
    expect(res.body.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(res.body.toString("utf8")).not.toBe(HTML);
    expect(gunzipSync(res.body).toString("utf8")).toBe(HTML);
  });

  it.each(TRANSPORTS)(
    "preserves compressed bodies when enforcing the cookie boundary (%s response)",
    async (transport) => {
      for (const path of ["/cookie-boundary", "/install.sh"]) {
        const response = await mf.dispatchFetch(`https://relay.test${path}`, {
          headers: {
            "accept-encoding": "gzip",
            "x-fixture-transport": transport,
            cookie:
              "tenant=kept; __Secure-better-auth.session_token=secret; __Secure-bb-connect.desktop_session=secret",
          },
        });
        expect(response.status).toBe(200);
        expect(response.headers.getSetCookie()).toEqual([
          "tenant=kept; Path=/; HttpOnly",
        ]);
        expect(response.headers.get("x-origin-cookie")).toBe("tenant=kept");
        expect(response.headers.get("content-type")).toBe(
          path === "/install.sh"
            ? "text/plain; charset=utf-8"
            : "text/html; charset=utf-8",
        );
        if (path === "/install.sh") {
          expect(response.headers.get("content-security-policy")).toBe(
            "sandbox",
          );
          expect(response.headers.get("x-content-type-options")).toBe(
            "nosniff",
          );
        }
        expect(await response.text()).toBe(HTML);
      }
    },
  );
});

describe("edge cache", () => {
  it.each(TRANSPORTS)(
    "keeps the body decodable on both the miss and the hit (%s response)",
    async (transport) => {
      const path = `/${transport}/asset.js?cacheable=1`;
      const miss = await get(path, transport);
      expect(miss.body.toString("utf8")).toBe(HTML);

      for (const reader of TRANSPORTS) {
        const hit = await get(path, reader);
        expect(hit.status).toBe(200);
        expect(hit.body.toString("utf8")).toBe(HTML);
      }
      const marker = await mf.dispatchFetch(`https://relay.test${path}`, {
        headers: { "x-fixture-transport": transport },
      });
      expect(marker.headers.get("x-bb-cache")).toBe("hit");
      await marker.arrayBuffer();
    },
  );

  it("content-decodes a relayed body as the gate reads it", async () => {
    const res = await mf.dispatchFetch("https://relay.test/subrequest-bytes");

    expect(await res.json()).toEqual({
      byteLength: HTML.length,
      firstBytes: [...Buffer.from(HTML.slice(0, 2))],
      contentEncoding: "gzip",
    });
  });

  it("would serve raw gzip if a hit were rebuilt the pre-fix way", async () => {
    await get("/legacy-asset.js?cacheable=1");

    const res = await get(
      `/legacy-cache-hit?for=${encodeURIComponent("/legacy-asset.js?cacheable=1")}`,
    );

    expect(res.status).toBe(200);
    expect(res.encoding).toBeNull();
    expect(res.body.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(gunzipSync(res.body).toString("utf8")).toBe(HTML);
  });

  it("preserves status and headers when serving from the cache", async () => {
    await get("/headers.js?cacheable=1");
    const res = await mf.dispatchFetch(
      "https://relay.test/headers.js?cacheable=1",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-bb-cache")).toBe("hit");
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
  });
});
