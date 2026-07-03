import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { createMockHubSocket } from "../../helpers/mock-hub-socket.js";

// The harness config uses serverPort 3334, so this host is on the local-app
// origin allowlist the "local" auth mode enforces.
const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";

const WIRE_SOURCE = `
  export default function plugin(bb: any) {
    bb.http.route("GET", "/hello", (c: any) => c.json({ message: "hello v1" }));
    bb.http.route("POST", "/echo", async (c: any) =>
      c.json({ echoed: await c.req.json() }));
    bb.http.route("GET", "/guarded", (c: any) => c.json({ guarded: true }), {
      auth: "token",
    });
    bb.http.route("GET", "/open", (c: any) => c.json({ open: true }), {
      auth: "none",
    });
    bb.http.route("GET", "/boom", () => {
      throw new Error("route boom");
    });
    bb.rpc.register({
      echo: async (input: any) => ({ echoed: input }),
      boom: async () => {
        throw new Error("rpc boom");
      },
      publish: async (input: any) => {
        bb.realtime.publish(input.channel, input.payload);
        return "published";
      },
      publishBad: async () => {
        bb.realtime.publish("bad", { n: BigInt(1) });
      },
    });
  }
`;

async function writePlugin(
  dir: string,
  options: { name: string; serverSource: string },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: { server: "./server.ts" },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

async function rpc(
  harness: TestAppHarness,
  method: string,
  input: unknown,
  init: { origin?: string; contentType?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  const contentType =
    init.contentType === undefined ? "application/json" : init.contentType;
  if (contentType !== null) headers["content-type"] = contentType;
  if (init.origin !== undefined) headers.origin = init.origin;
  return await harness.app.request(
    `${BASE}/api/v1/plugins/wire/rpc/${method}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    },
  );
}

describe("plugin wire surfaces (http/rpc dispatcher + realtime)", () => {
  let harness: TestAppHarness;
  let rootDir: string;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    setExperiments(harness.db, { ...defaultExperiments, plugins: true });
    rootDir = await writePlugin(join(harness.config.dataDir, "fixtures"), {
      name: "bb-plugin-wire",
      serverSource: WIRE_SOURCE,
    });
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("serves a registered route for local requests (no origin, and app origins)", async () => {
    const bare = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/hello`,
    );
    expect(bare.status).toBe(200);
    expect(await bare.json()).toEqual({ message: "hello v1" });

    const sameOrigin = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/hello`,
      { headers: { origin: BASE } },
    );
    expect(sameOrigin.status).toBe(200);

    // config.appUrl (https://bb.example.test) is part of the allowlist.
    const appOrigin = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/hello`,
      { headers: { origin: "https://bb.example.test" } },
    );
    expect(appOrigin.status).toBe(200);
  });

  it("local auth rejects foreign origins but tolerates LAN/Tailscale serving", async () => {
    const foreignOrigin = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/hello`,
      { headers: { origin: EVIL_ORIGIN } },
    );
    expect(foreignOrigin.status).toBe(403);
    expect(await foreignOrigin.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("not a local BB app origin"),
    });

    // Tailscale/LAN serving (regression): the app reaches the server through
    // the dev proxy, so the browser origin is a non-loopback host on a known
    // BB app port while the request URL origin differs. Must be allowed.
    const tailscaleOrigin = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/hello`,
      { headers: { origin: "http://100.64.158.8:3334" } },
    );
    expect(tailscaleOrigin.status).toBe(200);

    // A foreign origin on a random port stays rejected even with a
    // rebinding-shaped request URL; a same-origin non-loopback URL passes
    // (no Host allowlist — LAN serving is legitimate).
    const sameOriginLan = await harness.app.request(
      "http://100.64.158.8:3334/api/v1/plugins/wire/http/hello",
      { headers: { origin: "http://100.64.158.8:3334" } },
    );
    expect(sameOriginLan.status).toBe(200);
  });

  it("local auth requires application/json on non-GET requests", async () => {
    const noContentType = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/echo`,
      { method: "POST", body: JSON.stringify({ a: 1 }) },
    );
    expect(noContentType.status).toBe(415);

    const json = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/echo`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ a: 1 }),
      },
    );
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ echoed: { a: 1 } });
  });

  it("token auth: 401 without the token, works with header or query, rotate invalidates", async () => {
    const unauthorized = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/guarded`,
    );
    expect(unauthorized.status).toBe(401);

    const issued = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/token`,
      { method: "POST" },
    );
    expect(issued.status).toBe(200);
    const { token } = (await issued.json()) as { token: string };
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const viaHeader = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/guarded`,
      // Token routes are for webhooks: a foreign origin is fine.
      { headers: { "x-bb-plugin-token": token, origin: EVIL_ORIGIN } },
    );
    expect(viaHeader.status).toBe(200);
    expect(await viaHeader.json()).toEqual({ guarded: true });

    const viaQuery = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/guarded?token=${token}`,
    );
    expect(viaQuery.status).toBe(200);

    const rotated = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/token`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rotate: true }),
      },
    );
    const { token: nextToken } = (await rotated.json()) as { token: string };
    expect(nextToken).not.toBe(token);

    const staleToken = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/guarded`,
      { headers: { "x-bb-plugin-token": token } },
    );
    expect(staleToken.status).toBe(401);

    const freshToken = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/guarded`,
      { headers: { "x-bb-plugin-token": nextToken } },
    );
    expect(freshToken.status).toBe(200);

    const unknownPlugin = await harness.app.request(
      `${BASE}/api/v1/plugins/ghost/token`,
      { method: "POST" },
    );
    expect(unknownPlugin.status).toBe(404);
  });

  it('auth "none" passes foreign origins through', async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/open`,
      { headers: { origin: EVIL_ORIGIN } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ open: true });
  });

  it("maps unknown route → 404, unknown plugin → 404, disabled plugin → 503", async () => {
    const unknownRoute = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/nope`,
    );
    expect(unknownRoute.status).toBe(404);

    const unknownPlugin = await harness.app.request(
      `${BASE}/api/v1/plugins/ghost/http/hello`,
    );
    expect(unknownPlugin.status).toBe(404);
    expect(await unknownPlugin.json()).toMatchObject({
      error: 'unknown plugin "ghost"',
    });

    await harness.pluginService.setEnabled("wire", false);
    const notRunning = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/hello`,
    );
    expect(notRunning.status).toBe(503);
    expect(await notRunning.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("not running"),
    });
  });

  it("maps a throwing route handler to a 500 and counts it in handlerStats", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/boom`,
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("route boom"),
    });
    const entry = harness.pluginService.list().find((p) => p.id === "wire");
    expect(entry?.handlerStats.errorCount).toBe(1);
    expect(entry?.statusDetail).toContain("http GET /boom failed");
  });

  it("reload swaps the live route and rpc tables without re-registering Hono routes", async () => {
    await writeFile(
      join(rootDir, "server.ts"),
      `
        export default function plugin(bb: any) {
          bb.http.route("GET", "/hello", (c: any) => c.json({ message: "hello v2" }));
        }
      `,
    );
    await harness.pluginService.reload("wire");

    const swapped = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/hello`,
    );
    expect(await swapped.json()).toEqual({ message: "hello v2" });

    // v2 registers no rpc handlers: the old method is gone.
    const staleRpc = await rpc(harness, "echo", { x: 1 });
    expect(staleRpc.status).toBe(404);
  });

  it("rpc: happy path, handler error → 500 envelope, unknown method → 404", async () => {
    const ok = await rpc(harness, "echo", { x: 1 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, result: { echoed: { x: 1 } } });

    const boom = await rpc(harness, "boom", {});
    expect(boom.status).toBe(500);
    expect(await boom.json()).toEqual({ ok: false, error: "rpc boom" });

    const missing = await rpc(harness, "missing", {});
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      ok: false,
      error: 'plugin "wire" has no rpc method "missing"',
    });
  });

  it("rpc enforces local semantics: JSON-only body, origin check, parseable input", async () => {
    const foreign = await rpc(harness, "echo", { x: 1 }, { origin: EVIL_ORIGIN });
    expect(foreign.status).toBe(403);

    const notJson = await rpc(harness, "echo", { x: 1 }, { contentType: null });
    expect(notJson.status).toBe(415);

    const badBody = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/rpc/echo`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      },
    );
    expect(badBody.status).toBe(400);
  });

  it("returns the structured disabled error when the experiment is off", async () => {
    setExperiments(harness.db, { ...defaultExperiments, plugins: false });
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/wire/http/hello`,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("Plugins are disabled"),
    });
  });

  it("bb.realtime.publish broadcasts a plugin-signal WS frame to connected clients", async () => {
    const socket = createMockHubSocket();
    harness.hub.subscribe(socket, { kind: "system" });

    const response = await rpc(harness, "publish", {
      channel: "issues-updated",
      payload: { count: 42 },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: "published" });

    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0])).toEqual({
      type: "plugin-signal",
      pluginId: "wire",
      channel: "issues-updated",
      payload: { count: 42 },
    });
  });

  it("bb.realtime.publish rejects payloads that do not survive JSON", async () => {
    const response = await rpc(harness, "publishBad", {});
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("not JSON-serializable"),
    });
  });

  it("rpc resolves the handler after the body arrives, so a reload during the body read never runs a stale handler", async () => {
    // The handler closes over its load generation: a binding resolved
    // before the body read (and invalidated by the mid-read reload) would
    // answer with the disposed instance's generation.
    const genDir = await writePlugin(join(harness.config.dataDir, "fixtures"), {
      name: "bb-plugin-gen",
      serverSource: `
        export default function plugin(bb: any) {
          const g = globalThis as any;
          g.__wireGen = (g.__wireGen ?? 0) + 1;
          const gen = g.__wireGen;
          bb.rpc.register({ gen: async () => ({ gen }) });
        }
      `,
    });
    const installed = await harness.pluginService.installPath(genDir);
    expect(installed.status).toBe("running");
    const firstGen = (globalThis as Record<string, unknown>)
      .__wireGen as number;

    let releaseBody!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      releaseBody = resolveGate;
    });
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        await gate;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const responsePromise = harness.app.request(
      `${BASE}/api/v1/plugins/gen/rpc/gen`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        // Node fetch requires half-duplex for streamed request bodies.
        duplex: "half",
      } as RequestInit,
    );
    // Let the dispatcher reach its body read, then swap the handler.
    await new Promise((resolveTick) => setTimeout(resolveTick, 25));
    await harness.pluginService.reload("gen");
    releaseBody();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: { gen: firstGen + 1 },
    });
  });
});
