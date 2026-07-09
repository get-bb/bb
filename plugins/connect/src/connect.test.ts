import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket as NodeWebSocket, WebSocketServer } from "ws";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@bb/plugin-sdk/testing";
import {
  decodeFrame,
  encodeFrame,
  type Frame,
} from "@bb/tunnel-contract";
import { deriveConnectBaseUrl, serverUrlForHandle } from "./redeem.js";
import {
  headersForLoopbackRequest,
  isBareBbRealtimeWs,
  TunnelSession,
} from "./tunnel.js";
import {
  parseSharePort,
  SharePortError,
  ShareRegistry,
  sharePublicUrl,
  SHARES_KV_KEY,
  serverOwnPort,
} from "./shares.js";
import { CREDENTIAL_KV_KEY } from "./credential.js";
import plugin from "./server.js";
import type { ConnectStatus } from "./types.js";

describe("deriveConnectBaseUrl", () => {
  it("drops the handle label to reach the apex", () => {
    expect(deriveConnectBaseUrl("https://sawyer.getbb.app")).toBe(
      "https://getbb.app",
    );
    expect(deriveConnectBaseUrl("https://my-box.vibecodethis.site/")).toBe(
      "https://vibecodethis.site",
    );
  });
});

describe("serverUrlForHandle", () => {
  it("prepends the handle label to the apex", () => {
    expect(serverUrlForHandle("https://getbb.app", "sawyer")).toBe(
      "https://sawyer.getbb.app",
    );
  });
});

describe("headersForLoopbackRequest", () => {
  it("rewrites the paired connect origin to the loopback app origin only", () => {
    expect(
      headersForLoopbackRequest(
        [
          ["Origin", "https://sawyer.getbb.app"],
          ["Content-Type", "application/json"],
          ["Host", "sawyer.getbb.app"],
        ],
        {
          publicOrigin: "https://sawyer.getbb.app",
          loopbackOrigin: "http://127.0.0.1:38886",
        },
      ),
    ).toEqual({
      Origin: "http://127.0.0.1:38886",
      "Content-Type": "application/json",
    });

    expect(
      headersForLoopbackRequest(
        [["Origin", "https://evil.example"]],
        {
          publicOrigin: "https://sawyer.getbb.app",
          loopbackOrigin: "http://127.0.0.1:38886",
        },
      ),
    ).toEqual({ Origin: "https://evil.example" });
  });

  it("injects Host and rewrites share Origin for share streams", () => {
    expect(
      headersForLoopbackRequest(
        [
          ["Origin", "https://sawyer--8000.getbb.app"],
          ["Content-Type", "text/plain"],
          ["Host", "sawyer--8000.getbb.app"],
        ],
        {
          publicOrigin: "https://sawyer--8000.getbb.app",
          loopbackOrigin: "http://127.0.0.1:8000",
          host: "127.0.0.1:8000",
        },
      ),
    ).toEqual({
      Origin: "http://127.0.0.1:8000",
      "Content-Type": "text/plain",
      Host: "127.0.0.1:8000",
    });
  });
});

describe("sharePublicUrl", () => {
  it("builds https://handle--port.base from the credential serverUrl", () => {
    expect(
      sharePublicUrl(
        { serverUrl: "https://sawyer.getbb.app", handle: "sawyer" },
        8000,
      ),
    ).toBe("https://sawyer--8000.getbb.app");
  });

  it("uses a non-primary routing label when multi-server pairing stored one", () => {
    expect(
      sharePublicUrl(
        {
          serverUrl: "https://sawyer-desktop.getbb.app",
          handle: "sawyer-desktop",
        },
        8000,
      ),
    ).toBe("https://sawyer-desktop--8000.getbb.app");
  });
});

describe("parseSharePort / serverOwnPort", () => {
  it("accepts integers 1–65535 and rejects the rest", () => {
    expect(parseSharePort(80)).toBe(80);
    expect(parseSharePort("5173")).toBe(5173);
    expect(() => parseSharePort(0)).toThrow(SharePortError);
    expect(() => parseSharePort(65536)).toThrow(SharePortError);
    expect(() => parseSharePort(3.5)).toThrow(SharePortError);
    expect(() => parseSharePort("nope")).toThrow(SharePortError);
  });

  it("reads the bb server port from the loopback base URL", () => {
    expect(serverOwnPort("http://127.0.0.1:38886")).toBe(38886);
    expect(serverOwnPort("http://127.0.0.1")).toBe(80);
  });
});

describe("ShareRegistry", () => {
  it("persists shares in kv and refuses the server's own port", async () => {
    const kv = new Map<string, unknown>();
    const store = {
      async get<T>(key: string) {
        return kv.get(key) as T | undefined;
      },
      async set(key: string, value: unknown) {
        kv.set(key, value);
      },
      async delete(key: string) {
        kv.delete(key);
      },
    };
    const credential = {
      serverUrl: "https://sawyer.getbb.app",
      handle: "sawyer",
      credential: "bbcred_x",
    };
    const registry = new ShareRegistry({
      kv: store,
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      getCredential: () => credential,
    });
    await registry.load();

    await expect(registry.add(38886)).rejects.toThrow(/own port/);

    const added = await registry.add(8000);
    expect(added.url).toBe("https://sawyer--8000.getbb.app");
    expect(registry.has(8000)).toBe(true);
    expect(kv.get(SHARES_KV_KEY)).toMatchObject({
      "8000": { port: 8000 },
    });

    const reloaded = new ShareRegistry({
      kv: store,
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      getCredential: () => credential,
    });
    await reloaded.load();
    expect(reloaded.list()).toEqual([
      {
        port: 8000,
        url: "https://sawyer--8000.getbb.app",
        createdAt: expect.any(Number),
      },
    ]);

    expect(await reloaded.remove(8000)).toBe(true);
    expect(await reloaded.remove(8000)).toBe(false);
    expect(kv.has(SHARES_KV_KEY)).toBe(false);
  });
});

describe("isBareBbRealtimeWs", () => {
  it("matches bare-handle /ws paths only", () => {
    expect(isBareBbRealtimeWs("/ws", undefined)).toBe(true);
    expect(isBareBbRealtimeWs("/ws?x=1", undefined)).toBe(true);
    expect(isBareBbRealtimeWs("/ws/nested", undefined)).toBe(true);
    expect(isBareBbRealtimeWs("/ws", "8000")).toBe(false);
    expect(isBareBbRealtimeWs("/api", undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TunnelSession routing against two ephemeral local origins
// ---------------------------------------------------------------------------

async function listen(
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
): Promise<{ server: Server; origin: string; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("expected TCP address");
  }
  return {
    server,
    origin: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
  };
}

async function waitForOpen(ws: NodeWebSocket): Promise<void> {
  if (ws.readyState === NodeWebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function collectFrames(ws: NodeWebSocket): Frame[] {
  const frames: Frame[] = [];
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) frames.push(decodeFrame(data));
  });
  return frames;
}

async function waitFor(
  pred: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("TunnelSession routing", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("routes no-target to primary origin, target to a shared port, unregistered → 404", async () => {
    const primaryHits: string[] = [];
    const shareHits: string[] = [];
    const primary = await listen((req, res) => {
      primaryHits.push(`${req.method} ${req.url}`);
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("primary");
    });
    const share = await listen((req, res) => {
      shareHits.push(
        `${req.method} ${req.url} host=${req.headers.host} origin=${req.headers.origin ?? ""}`,
      );
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("shared");
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => primary.server.close(() => resolve())),
      () =>
        new Promise<void>((resolve) => share.server.close(() => resolve())),
    );

    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
    const wssAddr = wss.address();
    if (wssAddr === null || typeof wssAddr === "string") {
      throw new Error("expected TCP address");
    }
    const relayReady = new Promise<NodeWebSocket>((resolve) => {
      wss.on("connection", (socket) => resolve(socket));
    });
    const client = new NodeWebSocket(`ws://127.0.0.1:${wssAddr.port}`);
    cleanups.push(async () => {
      client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    });
    await waitForOpen(client);
    const relay = await relayReady;
    // Session replies travel client → relay; collect on the relay side.
    const frames = collectFrames(relay);

    const sharedPorts = new Set([share.port]);
    const session = new TunnelSession({
      tunnel: client,
      log: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      resolveOrigin: (target) => {
        if (target === undefined) {
          return {
            kind: "ok",
            resolved: {
              origin: primary.origin,
              publicOrigin: "https://sawyer.getbb.app",
            },
          };
        }
        const port = Number(target);
        if (!sharedPorts.has(port)) return { kind: "unregistered" };
        return {
          kind: "ok",
          resolved: {
            origin: `http://127.0.0.1:${port}`,
            publicOrigin: `https://sawyer--${port}.getbb.app`,
            host: `127.0.0.1:${port}`,
          },
        };
      },
    });
    session.start();
    cleanups.push(() => session.dispose());

    const inject = (frame: Frame) => {
      // Relay → client: TunnelSession handles inbound frames on `client`.
      relay.send(Buffer.from(encodeFrame(frame)));
    };

    // Primary (no target)
    inject({
      type: "open-http",
      streamId: 1,
      method: "GET",
      path: "/hello",
      headers: [["Origin", "https://sawyer.getbb.app"]],
      hasBody: false,
    });
    await waitFor(() => frames.some((f) => f.type === "body-end" && f.streamId === 1));
    expect(primaryHits).toEqual(["GET /hello"]);
    expect(shareHits).toEqual([]);

    // Shared target
    frames.length = 0;
    inject({
      type: "open-http",
      streamId: 2,
      method: "GET",
      path: "/app",
      headers: [
        ["Origin", `https://sawyer--${share.port}.getbb.app`],
        ["Host", `sawyer--${share.port}.getbb.app`],
      ],
      hasBody: false,
      target: String(share.port),
    });
    await waitFor(() => frames.some((f) => f.type === "body-end" && f.streamId === 2));
    expect(shareHits).toHaveLength(1);
    expect(shareHits[0]).toContain("GET /app");
    expect(shareHits[0]).toContain(`host=127.0.0.1:${share.port}`);
    expect(shareHits[0]).toContain(`origin=http://127.0.0.1:${share.port}`);
    expect(primaryHits).toEqual(["GET /hello"]);

    // Unregistered target → 404
    frames.length = 0;
    inject({
      type: "open-http",
      streamId: 3,
      method: "GET",
      path: "/nope",
      headers: [],
      hasBody: false,
      target: "59999",
    });
    await waitFor(() => frames.some((f) => f.type === "resp-head" && f.streamId === 3));
    const head = frames.find((f) => f.type === "resp-head" && f.streamId === 3);
    expect(head).toMatchObject({ type: "resp-head", status: 404 });
    const bodyChunks = frames.filter(
      (f) => f.type === "body-chunk" && f.streamId === 3,
    );
    const body = Buffer.concat(
      bodyChunks.map((f) =>
        f.type === "body-chunk" ? Buffer.from(f.data) : Buffer.alloc(0),
      ),
    ).toString();
    expect(body).toBe("this port is not shared");
    expect(frames.some((f) => f.type === "body-end" && f.streamId === 3)).toBe(
      true,
    );
  });

  it("tracks remoteClients for bare-handle /ws streams", async () => {
    // Origin WS server that accepts upgrades so the tunnel can open.
    const origin = await listen((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    // Attach a WS server to the same HTTP server.
    const originWss = new WebSocketServer({ server: origin.server });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          originWss.close(() => origin.server.close(() => resolve()));
        }),
    );

    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
    const wssAddr = wss.address();
    if (wssAddr === null || typeof wssAddr === "string") {
      throw new Error("expected TCP address");
    }
    const relayReady = new Promise<NodeWebSocket>((resolve) => {
      wss.on("connection", (socket) => resolve(socket));
    });
    const client = new NodeWebSocket(`ws://127.0.0.1:${wssAddr.port}`);
    cleanups.push(async () => {
      client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    });
    await waitForOpen(client);
    const relay = await relayReady;
    const frames = collectFrames(relay);

    const remoteClientsSeen: number[] = [];
    const session = new TunnelSession({
      tunnel: client,
      log: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      resolveOrigin: () => ({
        kind: "ok",
        resolved: {
          origin: origin.origin,
          publicOrigin: "https://sawyer.getbb.app",
        },
      }),
      onRemoteClientsChange: (n) => {
        remoteClientsSeen.push(n);
      },
    });
    session.start();
    cleanups.push(() => session.dispose());

    expect(session.remoteClients).toBe(0);

    const inject = (frame: Frame) => {
      relay.send(Buffer.from(encodeFrame(frame)));
    };

    inject({
      type: "open-ws",
      streamId: 10,
      path: "/ws",
      headers: [],
      protocols: [],
    });
    await waitFor(() =>
      frames.some((f) => f.type === "ws-open-ack" && f.streamId === 10),
    );
    expect(session.remoteClients).toBe(1);
    expect(remoteClientsSeen).toContain(1);

    // Close the stream from the relay side.
    inject({
      type: "close-stream",
      streamId: 10,
      code: 1000,
      reason: "bye",
    });
    await waitFor(() => session.remoteClients === 0);
    expect(remoteClientsSeen).toContain(0);
  });
});

describe("connect plugin", () => {
  let host: FakePluginHost | undefined;

  async function loadPlugin(): Promise<FakePluginHost> {
    host = createFakePluginHost({ pluginId: "connect" });
    // The fake host is typed from src; the plugin compiles against the
    // bundled dts — same contract, nominally different modules.
    await plugin(host.bb as unknown as Parameters<typeof plugin>[0]);
    return host;
  }

  /** Stop the tunnel (reconnect timers, pending sockets) before dispose. */
  async function stopTunnel(current: FakePluginHost): Promise<void> {
    const { controller, done } = current.harness.runService("tunnel");
    controller.abort();
    await done;
  }

  afterEach(async () => {
    if (host) {
      await stopTunnel(host);
      await host.harness.dispose();
      host = undefined;
    }
    vi.unstubAllGlobals();
  });

  it("starts unpaired — a healthy state, not needs-configuration", async () => {
    const { harness } = await loadPlugin();
    const status = (await harness.callRpc("status")) as ConnectStatus;
    expect(status).toMatchObject({
      state: "disconnected",
      paired: false,
      handle: null,
      url: null,
      lastError: null,
      remoteClients: 0,
      lastRemoteActivityAt: null,
      shares: [],
    });
    // Dashboard URL is sourced from the status payload (the apex when
    // unpaired), never a frontend literal.
    expect(status.dashboardUrl).toBe("https://getbb.app/dashboard");
    expect(status.nextRetryAt).toBeNull();
    expect(harness.needsConfigurationMessages).toEqual([]);
  });

  it("registers contributeInstructions", async () => {
    const { harness } = await loadPlugin();
    expect(harness.registrations.instructionProvider).not.toBeNull();
    expect(
      harness.registrations.instructionProvider?.({
        threadId: "th_1",
        projectId: "proj_1",
      }),
    ).toBeNull();
  });

  it("pair redeems, persists the credential to kv, and reports paired", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ credential: "bbcred_live", handle: "sawyer" }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { bb, harness } = await loadPlugin();

    // Loopback serverUrl so the post-pair tunnel dial refuses instantly (no
    // real gate contacted); explicit baseUrl drives the redeem endpoint.
    const status = (await harness.callRpc("pair", {
      code: "ABCD",
      server: "http://127.0.0.1:59321",
      baseUrl: "https://getbb.app",
    })) as ConnectStatus;

    expect(fetchMock).toHaveBeenCalledWith(
      "https://getbb.app/api/connect/redeem",
      expect.objectContaining({ method: "POST" }),
    );
    expect(status.paired).toBe(true);
    expect(status.handle).toBe("sawyer");
    expect(status.url).toBe("http://127.0.0.1:59321");
    // Persisted for reconnect-on-restart.
    const stored = (await bb.storage.kv.get(CREDENTIAL_KV_KEY)) as {
      credential: string;
    };
    expect(stored.credential).toBe("bbcred_live");
    // Status transitions rode the realtime channel (pairing → reconnecting).
    const states = harness.realtimeSignals
      .filter((signal) => signal.channel === "connect")
      .map((signal) => (signal.payload as ConnectStatus).state);
    expect(states).toContain("pairing");
  });

  it("pair without --server derives the URL from the redeemed handle", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ credential: "bbcred_live", handle: "sawyer" }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { harness } = await loadPlugin();

    // Loopback baseUrl keeps this hermetic (the derived host resolves to
    // nothing, so the post-pair dial fails instantly); the panel's real
    // paste-a-code path omits baseUrl too and falls back to the getbb.app
    // apex the same way.
    const status = (await harness.callRpc("pair", {
      code: "ABCD",
      baseUrl: "http://localhost:59329",
    })) as ConnectStatus;

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:59329/api/connect/redeem",
      expect.objectContaining({ method: "POST" }),
    );
    expect(status.url).toBe("http://sawyer.localhost:59329");
    expect(status.paired).toBe(true);
  });

  it("pair stores a non-primary routing label from redeem (multi-server)", async () => {
    // Cloud returns the redeemed server's subdomain, not the account handle.
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            credential: "bbcred_second",
            handle: "sawyer-desktop",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { bb, harness } = await loadPlugin();

    const status = (await harness.callRpc("pair", {
      code: "ABCD",
      baseUrl: "http://localhost:59332",
    })) as ConnectStatus;

    expect(status.paired).toBe(true);
    expect(status.handle).toBe("sawyer-desktop");
    expect(status.url).toBe("http://sawyer-desktop.localhost:59332");

    const stored = (await bb.storage.kv.get(CREDENTIAL_KV_KEY)) as {
      serverUrl: string;
      handle: string;
      credential: string;
    };
    expect(stored).toEqual({
      serverUrl: "http://sawyer-desktop.localhost:59332",
      handle: "sawyer-desktop",
      credential: "bbcred_second",
    });

    // Share URLs follow the stored label, not the account primary handle.
    const exposed = (await harness.callRpc("expose", { port: 8000 })) as {
      port: number;
      url: string;
    };
    expect(exposed.url).toBe("http://sawyer-desktop--8000.localhost:59332");
  });

  it("disconnect clears the stored credential", async () => {
    const { bb, harness } = await loadPlugin();
    // Seed a stored credential (as if paired before this load).
    await bb.storage.kv.set(CREDENTIAL_KV_KEY, {
      serverUrl: "http://127.0.0.1:59322",
      handle: "sawyer",
      credential: "bbcred_x",
    });

    const after = (await harness.callRpc("disconnect")) as ConnectStatus;
    expect(after.paired).toBe(false);
    expect(after.state).toBe("disconnected");
    expect(await bb.storage.kv.get(CREDENTIAL_KV_KEY)).toBeUndefined();
  });

  it("maps a redeem failure to a typed code (no wire text) and does not persist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "expired" }), { status: 410 }),
      ),
    );
    const { bb, harness } = await loadPlugin();

    // The panel maps codes to human copy; the raw "Redeem failed (410)…"
    // detail must never reach the caller — only the stable code does.
    await expect(
      harness.callRpc("pair", {
        code: "OLD",
        server: "https://sawyer.getbb.app",
      }),
    ).rejects.toThrow("expired_code");
    expect(await bb.storage.kv.get(CREDENTIAL_KV_KEY)).toBeUndefined();
    const status = (await harness.callRpc("status")) as ConnectStatus;
    expect(status.state).toBe("disconnected");
  });

  it("maps redeem status/detail to invalid_code / already_used / network codes", async () => {
    const cases: Array<{ status: number; error: string; code: string }> = [
      { status: 404, error: "invalid-code", code: "invalid_code" },
      { status: 409, error: "already-used", code: "already_used" },
      { status: 500, error: "boom", code: "network" },
    ];
    for (const testCase of cases) {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: testCase.error }), {
              status: testCase.status,
            }),
        ),
      );
      const { harness } = await loadPlugin();
      await expect(
        harness.callRpc("pair", {
          code: "X",
          server: "https://sawyer.getbb.app",
        }),
      ).rejects.toThrow(testCase.code);
      await stopTunnel(host!);
      await host!.harness.dispose();
      host = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("the tunnel service reconnects from a stored credential", async () => {
    const { bb, harness } = await loadPlugin();
    await bb.storage.kv.set(CREDENTIAL_KV_KEY, {
      serverUrl: "http://127.0.0.1:59323",
      handle: "sawyer",
      credential: "bbcred_x",
    });

    const { controller, done } = harness.runService("tunnel");
    // The service read the credential and reports paired (dial refused →
    // reconnecting, never "not paired").
    await vi.waitFor(async () => {
      const status = (await harness.callRpc("status")) as ConnectStatus;
      expect(status.paired).toBe(true);
      expect(status.state).toBe("reconnecting");
    });
    controller.abort();
    await done;
  });

  it("expose / listShares / unexpose rpc round-trip when paired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ credential: "bbcred_live", handle: "sawyer" }),
            { status: 200 },
          ),
      ),
    );
    const { harness } = await loadPlugin();
    // Handle-shaped serverUrl so share URLs look real; loopback port so the
    // post-pair tunnel dial fails instantly (no external network).
    await harness.callRpc("pair", {
      code: "ABCD",
      server: "http://sawyer.localhost:59330",
      baseUrl: "https://getbb.app",
    });

    const shareUrl = "http://sawyer--8000.localhost:59330";
    const exposed = (await harness.callRpc("expose", { port: 8000 })) as {
      port: number;
      url: string;
    };
    expect(exposed).toEqual({ port: 8000, url: shareUrl });

    const listed = (await harness.callRpc("listShares")) as Array<{
      port: number;
      url: string;
    }>;
    expect(listed).toEqual([{ port: 8000, url: shareUrl }]);

    const status = (await harness.callRpc("status")) as ConnectStatus;
    expect(status.shares).toEqual([{ port: 8000, url: shareUrl }]);

    const removed = (await harness.callRpc("unexpose", { port: 8000 })) as {
      removed: boolean;
      port: number;
    };
    expect(removed).toEqual({ removed: true, port: 8000 });
    expect(await harness.callRpc("listShares")).toEqual([]);
  });
});

describe("connect CLI", () => {
  let host: FakePluginHost | undefined;

  afterEach(async () => {
    if (host) {
      const { controller, done } = host.harness.runService("tunnel");
      controller.abort();
      await done;
      await host.harness.dispose();
      host = undefined;
    }
    vi.unstubAllGlobals();
  });

  async function loadCli(): Promise<FakePluginHost> {
    host = createFakePluginHost({ pluginId: "connect" });
    await plugin(host.bb as unknown as Parameters<typeof plugin>[0]);
    return host;
  }

  it("bare `bb connect` prints a how-to, not an argument error", async () => {
    const { harness } = await loadCli();
    const result = await harness.runCli([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("getbb.app");
    expect(result.stdout).toContain("bb connect status");
    expect(result.stdout).toContain("bb connect expose");
  });

  it("`bb connect --code --server` pairs verbatim (the dashboard command)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ credential: "bbcred_live", handle: "sawyer" }),
            { status: 200 },
          ),
      ),
    );
    const { harness } = await loadCli();
    const result = await harness.runCli([
      "--code",
      "ABCD",
      "--server",
      "http://127.0.0.1:59324",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Paired as sawyer — reachable at http://127.0.0.1:59324",
    );
  });

  it("`bb connect status` and `bb connect off` round-trip", async () => {
    const { harness } = await loadCli();
    const before = await harness.runCli(["status"]);
    expect(before.exitCode).toBe(0);
    expect(before.stdout).toContain("Not paired");

    const off = await harness.runCli(["off"]);
    expect(off.exitCode).toBe(0);
    expect(off.stdout).toContain("Disconnected");
  });

  it("unknown subcommands fail with help", async () => {
    const { harness } = await loadCli();
    const result = await harness.runCli(["bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown connect command 'bogus'");
  });

  it("a failed pair surfaces the redeem error on stderr", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "expired" }), { status: 410 }),
      ),
    );
    const { harness } = await loadCli();
    const result = await harness.runCli([
      "--code",
      "OLD",
      "--server",
      "https://sawyer.getbb.app",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Redeem failed (410): expired");
  });

  it("expose when unpaired errors clearly", async () => {
    const { harness } = await loadCli();
    const result = await harness.runCli(["expose", "8000"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not connected to getbb.app");
  });

  it("expose / shares / unexpose happy path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ credential: "bbcred_live", handle: "sawyer" }),
            { status: 200 },
          ),
      ),
    );
    const { harness } = await loadCli();
    await harness.runCli([
      "--code",
      "ABCD",
      "--server",
      "http://sawyer.localhost:59331",
    ]);

    const shareUrl = "http://sawyer--8000.localhost:59331";
    const exposed = await harness.runCli(["expose", "8000"]);
    expect(exposed.exitCode).toBe(0);
    expect(exposed.stdout).toContain(shareUrl);

    const shares = await harness.runCli(["shares"]);
    expect(shares.exitCode).toBe(0);
    expect(shares.stdout).toContain("8000");
    expect(shares.stdout).toContain(shareUrl);

    const status = await harness.runCli(["status"]);
    expect(status.stdout).toContain("shares:");
    expect(status.stdout).toContain("8000");

    const unexpose = await harness.runCli(["unexpose", "8000"]);
    expect(unexpose.exitCode).toBe(0);
    expect(unexpose.stdout).toContain("Stopped sharing port 8000");

    const again = await harness.runCli(["unexpose", "8000"]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("was not shared");

    const empty = await harness.runCli(["shares"]);
    expect(empty.stdout).toContain("No shared ports");
  });
});
