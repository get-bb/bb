import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFrame } from "@bb/tunnel-contract";

import { cacheKey } from "./cache";
import { parseClientProtocolVersion } from "./tunnel-do";
import {
  TUNNEL_TARGET_HEADER,
  cacheNamespace,
  dashboardSignInUrl,
  requestForTunnelDo,
} from "./worker";

// ── pure helpers ────────────────────────────────────────────────────────────

describe("connect sign-in page", () => {
  it("points unauthenticated visitors at the dashboard auth flow with returnTo", () => {
    expect(
      dashboardSignInUrl(
        "https://getbb.app",
        "https://sawyer.getbb.app/thread/thr_123?view=full",
      ),
    ).toBe(
      "https://getbb.app/dashboard?returnTo=https%3A%2F%2Fsawyer.getbb.app%2Fthread%2Fthr_123%3Fview%3Dfull",
    );
  });

  it("uses the configured app origin for staging", () => {
    expect(
      dashboardSignInUrl(
        "https://vibecodethis.site",
        "https://sawyer.vibecodethis.site/",
      ),
    ).toBe(
      "https://vibecodethis.site/dashboard?returnTo=https%3A%2F%2Fsawyer.vibecodethis.site%2F",
    );
  });
});

describe("requestForTunnelDo", () => {
  it("sets the target header on share hosts and strips visitor-supplied values", () => {
    const req = new Request("https://sawyer--8000.getbb.app/", {
      headers: { [TUNNEL_TARGET_HEADER]: "smuggled", cookie: "a=b" },
    });
    const out = requestForTunnelDo(req, "8000");
    expect(out.headers.get(TUNNEL_TARGET_HEADER)).toBe("8000");
    expect(out.headers.get("cookie")).toBe("a=b");
  });

  it("strips a smuggled target header on bare-handle hosts", () => {
    const req = new Request("https://sawyer.getbb.app/", {
      headers: { [TUNNEL_TARGET_HEADER]: "9999" },
    });
    const out = requestForTunnelDo(req, null);
    expect(out.headers.get(TUNNEL_TARGET_HEADER)).toBeNull();
  });
});

describe("cache namespace", () => {
  it("uses the bare handle or the full share label", () => {
    expect(cacheNamespace("sawyer", null)).toBe("sawyer");
    expect(cacheNamespace("sawyer", "8000")).toBe("sawyer--8000");
  });

  it("builds distinct edge-cache keys for bare handle vs share label", () => {
    const url = new URL("https://example/assets/app.js");
    const bare = cacheKey("sawyer", url);
    const share = cacheKey("sawyer--8000", url);
    expect(bare.url).not.toBe(share.url);
    expect(bare.url).toContain("/sawyer/assets/app.js");
    expect(share.url).toContain("/sawyer--8000/assets/app.js");
  });
});

describe("parseClientProtocolVersion", () => {
  it("treats missing or unparsable as 0", () => {
    expect(parseClientProtocolVersion(null)).toBe(0);
    expect(parseClientProtocolVersion("")).toBe(0);
    expect(parseClientProtocolVersion("nope")).toBe(0);
    expect(parseClientProtocolVersion("-1")).toBe(0);
  });

  it("parses non-negative integers", () => {
    expect(parseClientProtocolVersion("0")).toBe(0);
    expect(parseClientProtocolVersion("1")).toBe(1);
    expect(parseClientProtocolVersion("12")).toBe(12);
  });
});

// ── gate worker (mocked session + DO stub) ──────────────────────────────────

vi.mock("./session.js", () => ({
  parseCookie: vi.fn(),
  resolveHandle: vi.fn(),
  verifyMachineCredential: vi.fn(),
  verifySessionCookie: vi.fn(),
}));

vi.mock("./cache.js", async () => {
  const actual = await vi.importActual<typeof import("./cache.js")>("./cache.js");
  return {
    ...actual,
    serveWithCache: vi.fn(
      async (
        _request: Request,
        _namespace: string,
        _ctx: ExecutionContext,
        fetchOrigin: () => Promise<Response>,
      ) => fetchOrigin(),
    ),
  };
});

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({})),
}));

import {
  parseCookie,
  resolveHandle,
  verifyMachineCredential,
  verifySessionCookie,
} from "./session.js";
import { serveWithCache } from "./cache.js";
import worker from "./worker.js";
import { TunnelDO } from "./tunnel-do.js";

const mockParseCookie = vi.mocked(parseCookie);
const mockResolveHandle = vi.mocked(resolveHandle);
const mockVerifyMachine = vi.mocked(verifyMachineCredential);
const mockVerifySession = vi.mocked(verifySessionCookie);
const mockServeWithCache = vi.mocked(serveWithCache);

const BASE = "getbb.app";
const OWNER = "user-owner";
const OTHER = "user-other";

function makeEnv(doFetch: (req: Request) => Promise<Response> | Response) {
  const captured: Request[] = [];
  const stub = {
    fetch: (req: Request) => {
      captured.push(req);
      return Promise.resolve(doFetch(req));
    },
  };
  const env = {
    TUNNEL_DO: {
      idFromName: (name: string) => ({ name }),
      get: () => stub,
    },
    DB: {} as D1Database,
    BASE_DOMAIN: BASE,
    BETTER_AUTH_SECRET: "test-secret",
  };
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
  return { env, ctx, captured };
}

function visitorRequest(host: string, path = "/", init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("host", host);
  return new Request(`https://${host}${path}`, { ...init, headers });
}

describe("gate worker share hosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveHandle.mockResolvedValue({
      userId: OWNER,
      server: { id: "srv1", credentialHash: "abc", revokedAt: null },
    });
    mockParseCookie.mockReturnValue("session-token");
    mockVerifySession.mockResolvedValue(OWNER);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forwards share hosts to the DO with x-bb-tunnel-target", async () => {
    const { env, ctx, captured } = makeEnv(() => new Response("ok"));
    const res = await worker.fetch(
      visitorRequest("sawyer--8000.getbb.app", "/app", {
        headers: { [TUNNEL_TARGET_HEADER]: "smuggled" },
      }),
      env as never,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0].headers.get(TUNNEL_TARGET_HEADER)).toBe("8000");
    expect(mockServeWithCache).toHaveBeenCalledWith(
      expect.any(Request),
      "sawyer--8000",
      ctx,
      expect.any(Function),
    );
  });

  it("strips a smuggled target header on bare hosts", async () => {
    const { env, ctx, captured } = makeEnv(() => new Response("ok"));
    await worker.fetch(
      visitorRequest("sawyer.getbb.app", "/", {
        headers: { [TUNNEL_TARGET_HEADER]: "9999" },
      }),
      env as never,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].headers.get(TUNNEL_TARGET_HEADER)).toBeNull();
    expect(mockServeWithCache).toHaveBeenCalledWith(
      expect.any(Request),
      "sawyer",
      ctx,
      expect.any(Function),
    );
  });

  it("returns 401 sign-in page when share host has no session", async () => {
    mockParseCookie.mockReturnValue(null);
    const { env, ctx, captured } = makeEnv(() => new Response("ok"));
    const res = await worker.fetch(
      visitorRequest("sawyer--8000.getbb.app", "/"),
      env as never,
      ctx,
    );
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("Sign in");
    expect(html).toContain("sawyer");
    expect(captured).toHaveLength(0);
  });

  it("returns 403 when share host session is a different user", async () => {
    mockVerifySession.mockResolvedValue(OTHER);
    const { env, ctx, captured } = makeEnv(() => new Response("ok"));
    const res = await worker.fetch(
      visitorRequest("sawyer--8000.getbb.app", "/"),
      env as never,
      ctx,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("not your server");
    expect(captured).toHaveLength(0);
  });

  it("returns 404 for /__tunnel and /internal/* on share hosts", async () => {
    const { env, ctx, captured } = makeEnv(() => new Response("ok"));
    const tunnel = await worker.fetch(
      visitorRequest("sawyer--8000.getbb.app", "/__tunnel"),
      env as never,
      ctx,
    );
    expect(tunnel.status).toBe(404);
    expect(await tunnel.text()).toContain("not found");

    const internal = await worker.fetch(
      visitorRequest("sawyer--8000.getbb.app", "/internal/x"),
      env as never,
      ctx,
    );
    expect(internal.status).toBe(404);
    expect(await internal.text()).toContain("not found");
    expect(captured).toHaveLength(0);
  });

  it("redirects reserved handles and 404s the apex", async () => {
    const { env, ctx } = makeEnv(() => new Response("ok"));
    const reserved = await worker.fetch(
      visitorRequest("www.getbb.app", "/docs"),
      env as never,
      ctx,
    );
    expect(reserved.status).toBe(301);
    expect(reserved.headers.get("location")).toBe("https://getbb.app/docs");

    const apex = await worker.fetch(
      new Request("https://getbb.app/", { headers: { host: "getbb.app" } }),
      env as never,
      ctx,
    );
    expect(apex.status).toBe(404);
    expect(await apex.text()).toContain("unknown host");
  });

  it("forwards websocket upgrades on share hosts with the target header", async () => {
    // Node's Response rejects status 101; the gate only needs the upgrade path.
    const { env, ctx, captured } = makeEnv(() => new Response("upgraded", { status: 200 }));
    await worker.fetch(
      visitorRequest("sawyer--8000.getbb.app", "/ws", {
        headers: { upgrade: "websocket" },
      }),
      env as never,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].headers.get(TUNNEL_TARGET_HEADER)).toBe("8000");
    expect(captured[0].headers.get("upgrade")).toBe("websocket");
    expect(mockServeWithCache).not.toHaveBeenCalled();
  });

  it("does not apply machine-credential branch on share hosts", async () => {
    mockParseCookie.mockReturnValue(null);
    mockVerifyMachine.mockResolvedValue(OWNER);
    const { env, ctx, captured } = makeEnv(() => new Response("ok"));
    const res = await worker.fetch(
      visitorRequest("sawyer--8000.getbb.app", "/internal/ws", {
        headers: { "x-bb-connect-machine": "bbcm_ok" },
      }),
      env as never,
      ctx,
    );
    expect(res.status).toBe(404);
    expect(mockVerifyMachine).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });

  it("rejects invalid share hosts as unknown", async () => {
    const { env, ctx } = makeEnv(() => new Response("ok"));
    const res = await worker.fetch(
      visitorRequest("sawyer--08000.getbb.app", "/"),
      env as never,
      ctx,
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("unknown host");
  });
});

// ── TunnelDO protocol-version + target stamping ─────────────────────────────

// Node lacks Workers globals used by TunnelDO's constructor.
class FakeWebSocketRequestResponsePair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
}
vi.stubGlobal("WebSocketRequestResponsePair", FakeWebSocketRequestResponsePair);

type MockState = {
  sockets: WebSocket[];
  storage: Map<string, unknown>;
  restore: Promise<void>;
  api: DurableObjectState;
};

function mockDoState(initialStorage: Record<string, unknown> = {}): MockState {
  const storage = new Map<string, unknown>(Object.entries(initialStorage));
  const sockets: WebSocket[] = [];
  let restore = Promise.resolve();
  const api = {
    getWebSockets: (tag?: string) => {
      if (tag === "tunnel" || tag === undefined) return sockets;
      return [];
    },
    acceptWebSocket: (ws: WebSocket) => {
      sockets.push(ws);
    },
    setWebSocketAutoResponse: vi.fn(),
    blockConcurrencyWhile: (fn: () => Promise<void>) => {
      restore = fn();
      return restore;
    },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
      delete: async (key: string) => {
        storage.delete(key);
      },
      setAlarm: async () => {},
    },
  } as unknown as DurableObjectState;
  return {
    sockets,
    storage,
    get restore() {
      return restore;
    },
    api,
  };
}

function makeDoEnv() {
  return {
    TUNNEL_DO: {} as DurableObjectNamespace,
    DB: {} as D1Database,
    BASE_DOMAIN: BASE,
    BETTER_AUTH_SECRET: "s",
  };
}

function fakeTunnelSocket(send?: (data: ArrayBuffer | ArrayBufferView | string) => void) {
  return {
    send: send ?? vi.fn(),
    close: vi.fn(),
    deserializeAttachment: () => null,
  } as unknown as WebSocket;
}

describe("TunnelDO targeted request with old client", () => {
  it("returns 502 when client protocol version is < 1", async () => {
    const state = mockDoState({ protocolVersion: 0 });
    const dob = new TunnelDO(state.api, makeDoEnv());
    await state.restore;

    // Tunnel must look connected for the version gate (vs 503 offline).
    state.sockets.push(fakeTunnelSocket());

    const res = await dob.fetch(
      new Request("https://do.internal/", {
        headers: { [TUNNEL_TARGET_HEADER]: "8000" },
      }),
    );
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("too old for port sharing");
  });

  it("refuses targeted websocket upgrades when client is too old", async () => {
    const state = mockDoState({ protocolVersion: 0 });
    const dob = new TunnelDO(state.api, makeDoEnv());
    await state.restore;
    state.sockets.push(fakeTunnelSocket());

    const res = await dob.fetch(
      new Request("https://do.internal/ws", {
        headers: {
          upgrade: "websocket",
          [TUNNEL_TARGET_HEADER]: "8000",
        },
      }),
    );
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("too old for port sharing");
  });

  it("stamps target on open-http when protocol version is >= 1", async () => {
    vi.useFakeTimers();
    try {
      const sent: Uint8Array[] = [];
      const state = mockDoState({ protocolVersion: 1 });
      const dob = new TunnelDO(state.api, makeDoEnv());
      await state.restore;
      state.sockets.push(
        fakeTunnelSocket((data) => {
          if (typeof data === "string") return;
          if (data instanceof ArrayBuffer) {
            sent.push(new Uint8Array(data));
          } else {
            sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          }
        }),
      );

      const pending = dob.fetch(
        new Request("https://do.internal/foo", {
          method: "GET",
          headers: { [TUNNEL_TARGET_HEADER]: "8000" },
        }),
      );

      expect(sent.length).toBeGreaterThanOrEqual(1);
      const frame = decodeFrame(sent[0]);
      expect(frame.type).toBe("open-http");
      if (frame.type !== "open-http") throw new Error("unreachable");
      expect(frame.target).toBe("8000");
      expect(frame.path).toBe("/foo");
      expect(frame.headers.every(([n]) => n.toLowerCase() !== TUNNEL_TARGET_HEADER)).toBe(
        true,
      );

      // Resolve the hung proxyHttp promise via its resp-head timeout.
      vi.advanceTimersByTime(30_000);
      const timedOut = await pending;
      expect(timedOut.status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });
});
