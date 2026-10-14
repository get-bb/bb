import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GATE_OAUTH_CLIENT_HEADER,
  GATE_OAUTH_GRANT_HEADER,
  GATE_OAUTH_SCOPE_HEADER,
  MCP_LOCAL_PATH,
  type McpAccessTokenClaims,
  oauthGrant,
  schema,
  server,
  signMcpAccessToken,
  user,
} from "@bb/connect-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("drizzle-orm/d1", () => ({ drizzle: () => holder.db }));

vi.mock("./cache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cache.js")>()),
  serveWithCache: async (
    _request: Request,
    _namespace: string,
    _ctx: ExecutionContext,
    fetchOrigin: () => Promise<Response>,
  ) => ({ cacheable: false, response: await fetchOrigin() }),
}));

vi.mock("./session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session.js")>()),
  markMachineSeen: vi.fn(),
  verifyMachineCredentialDetails: vi.fn(),
  verifySessionCookieDetails: vi.fn(),
}));

import {
  verifyMachineCredentialDetails,
  verifySessionCookieDetails,
} from "./session.js";
import {
  MCP_GRANT_CACHE_TTL_MS,
  headerSafeClientName,
  isMcpLocalPath,
} from "./mcp-gate.js";
import { GATE_AUTH_HEADER } from "./protocol-headers.js";
import { TUNNEL_OFFLINE_HEADER } from "./tunnel-do.js";
import worker from "./worker.js";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../packages/connect-db/migrations", import.meta.url),
);
const BASE = "getbb.app";
const SECRET = "test-secret";
const OWNER = "user-owner";
const OTHER = "user-other";
const SESSION_COOKIE = "__Secure-better-auth.session_token=session-token";
const START = Date.UTC(2026, 9, 11, 12);

let sqlite: Database.Database;
let db: ReturnType<typeof drizzleSqlite<typeof schema>>;
let sequence = 0;
let handle = "";
let otherHandle = "";
let serverId = "";
let otherServerId = "";
let grantId = "";

function seedGrant(over: {
  id: string;
  userId?: string;
  serverId?: string;
  revokedAt?: Date | null;
  lastUsedAt?: Date | null;
}): void {
  db.insert(oauthGrant)
    .values({
      id: over.id,
      userId: over.userId ?? OWNER,
      serverId: over.serverId ?? serverId,
      clientId: "client-1",
      clientName: "Claude",
      resource: `https://${handle}.${BASE}/mcp`,
      scope: "bb",
      createdAt: new Date(START),
      lastUsedAt: over.lastUsedAt ?? null,
      revokedAt: over.revokedAt ?? null,
    })
    .run();
}

function seedServer(id: string, userId: string, subdomain: string): void {
  db.insert(server)
    .values({
      id,
      userId,
      name: subdomain,
      subdomain,
      credentialHash: "hash",
      createdAt: new Date(START),
    })
    .run();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!file.endsWith(".sql")) continue;
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  db = drizzleSqlite(sqlite, { schema });
  holder.db = db;
  sequence += 1;
  handle = `mcpowner${sequence}`;
  otherHandle = `mcpother${sequence}`;
  serverId = `srv-${sequence}`;
  otherServerId = `srv-other-${sequence}`;
  grantId = `grant-${sequence}`;
  for (const id of [OWNER, OTHER]) {
    db.insert(user)
      .values({
        id,
        name: id,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: new Date(START),
        updatedAt: new Date(START),
      })
      .run();
  }
  seedServer(serverId, OWNER, handle);
  seedServer(otherServerId, OWNER, otherHandle);
  seedGrant({ id: grantId });
  vi.mocked(verifySessionCookieDetails).mockResolvedValue({
    sessionId: "session-owner",
    userId: OWNER,
    needsRefresh: false,
  });
  vi.mocked(verifyMachineCredentialDetails).mockResolvedValue({
    machineId: "machine-owner",
    userId: OWNER,
  });
});

afterEach(() => {
  sqlite.close();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function makeEnv(doFetch: (req: Request) => Promise<Response> | Response) {
  const captured: Request[] = [];
  const env = {
    TUNNEL_DO: {
      idFromName: (name: string) => ({ name }),
      get: () => ({
        fetch: (req: Request) => {
          captured.push(req);
          return Promise.resolve(doFetch(req));
        },
      }),
    },
    DB: {} as D1Database,
    BASE_DOMAIN: BASE,
    BETTER_AUTH_SECRET: SECRET,
    GATE_EVENTS: { writeDataPoint: vi.fn() },
  };
  const waitUntil = vi.fn<(work: Promise<unknown>) => void>();
  const ctx = {
    waitUntil,
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
  return { env, ctx, captured, waitUntil };
}

function visit(
  path: string,
  init: RequestInit = {},
  host = `${handle}.${BASE}`,
): Request {
  const headers = new Headers(init.headers);
  headers.set("host", host);
  return new Request(`https://${host}${path}`, { ...init, headers });
}

function token(over: Partial<McpAccessTokenClaims> = {}): Promise<string> {
  return signMcpAccessToken(
    {
      version: 1,
      userId: OWNER,
      serverId,
      grantId,
      resource: `https://${handle}.${BASE}/mcp`,
      scope: "bb",
      clientName: "Claude",
      issuedAt: START,
      expiresAt: START + 24 * 60 * 60 * 1000,
      ...over,
    },
    SECRET,
  );
}

function challenge(error: boolean): string {
  return `Bearer ${error ? 'error="invalid_token", ' : ""}resource_metadata="https://${handle}.${BASE}/.well-known/oauth-protected-resource/mcp", scope="bb"`;
}

async function expectChallenge(
  response: Response,
  error: boolean,
): Promise<void> {
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe(challenge(error));
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({ error: "unauthorized" });
}

function lastUsedAt(id: string): Date | null {
  return (
    db
      .select({ lastUsedAt: oauthGrant.lastUsedAt })
      .from(oauthGrant)
      .where(eq(oauthGrant.id, id))
      .get()?.lastUsedAt ?? null
  );
}

describe("MCP protected resource metadata", () => {
  it.each([
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ])("serves %s without credentials on a server host", async (path) => {
    const { env, ctx, captured } = makeEnv(() => new Response("origin"));
    const response = await worker.fetch(visit(path), env as never, ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.json()).toEqual({
      resource: `https://${handle}.${BASE}/mcp`,
      authorization_servers: ["https://getbb.app"],
      scopes_supported: ["bb"],
      bearer_methods_supported: ["header"],
      resource_name: "bb",
    });
    expect(captured).toHaveLength(0);
  });

  it("answers 404 for unknown and revoked servers", async () => {
    const { env, ctx, captured } = makeEnv(() => new Response("origin"));
    const path = "/.well-known/oauth-protected-resource/mcp";
    const unknown = await worker.fetch(
      visit(path, {}, `mcpnobody${sequence}.${BASE}`),
      env as never,
      ctx,
    );
    expect(unknown.status).toBe(404);
    db.update(server)
      .set({ revokedAt: new Date(START) })
      .where(eq(server.id, serverId))
      .run();
    const revoked = await worker.fetch(visit(path), env as never, ctx);
    expect(revoked.status).toBe(404);
    expect(captured).toHaveLength(0);
  });
});

describe("MCP bearer authentication", () => {
  it("challenges a request without credentials", async () => {
    const { env, ctx, captured } = makeEnv(() => new Response("origin"));
    await expectChallenge(
      await worker.fetch(
        visit("/mcp", { method: "POST", body: "{}" }),
        env as never,
        ctx,
      ),
      false,
    );
    expect(captured).toHaveLength(0);
  });

  it("never accepts a session cookie or a machine credential in place of a token", async () => {
    const { env, ctx, captured } = makeEnv(() => new Response("origin"));
    await expectChallenge(
      await worker.fetch(
        visit("/mcp", { headers: { cookie: SESSION_COOKIE } }),
        env as never,
        ctx,
      ),
      false,
    );
    await expectChallenge(
      await worker.fetch(
        visit("/mcp", { headers: { "x-bb-connect-machine": "bbcm_ok" } }),
        env as never,
        ctx,
      ),
      false,
    );
    const control = await worker.fetch(
      visit("/api/v1/threads", { headers: { cookie: SESSION_COOKIE } }),
      env as never,
      ctx,
    );
    expect(control.status).toBe(200);
    expect(captured).toHaveLength(1);
  });

  it("forwards a valid token to the plugin route with the verified identity only", async () => {
    const { env, ctx, captured } = makeEnv(() => new Response("origin"));
    const response = await worker.fetch(
      visit("/mcp?cursor=1", {
        method: "POST",
        body: '{"jsonrpc":"2.0"}',
        headers: {
          authorization: `Bearer ${await token({ scope: "bb", clientName: " Clauéde\r\nx-evil: 1 " + "a".repeat(200) })}`,
          cookie: `tenant=1; ${SESSION_COOKIE}`,
          [GATE_AUTH_HEADER]: "session",
          [GATE_OAUTH_SCOPE_HEADER]: "bb admin",
          [GATE_OAUTH_GRANT_HEADER]: "forged",
          [GATE_OAUTH_CLIENT_HEADER]: "forged",
        },
      }),
      env as never,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("origin");
    expect(captured).toHaveLength(1);
    const forwarded = captured[0];
    const forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.pathname).toBe(MCP_LOCAL_PATH);
    expect(forwardedUrl.search).toBe("?cursor=1");
    expect(forwarded.method).toBe("POST");
    expect(await forwarded.text()).toBe('{"jsonrpc":"2.0"}');
    expect(forwarded.headers.get(GATE_AUTH_HEADER)).toBe("oauth");
    expect(forwarded.headers.get(GATE_OAUTH_SCOPE_HEADER)).toBe("bb");
    expect(forwarded.headers.get(GATE_OAUTH_GRANT_HEADER)).toBe(grantId);
    const clientName = forwarded.headers.get(GATE_OAUTH_CLIENT_HEADER) ?? "";
    expect(clientName).toMatch(/^Clau\?de\?\?x-evil: 1 a+$/u);
    expect(clientName).toHaveLength(80);
    expect(forwarded.headers.get("authorization")).toBeNull();
    expect(forwarded.headers.get("cookie")).toBeNull();
    expect(forwarded.headers.get("x-bb-gate-owner")).toBe(`server:${serverId}`);
  });

  it("rejects tokens that do not belong to this server, user, resource or grant", async () => {
    const { env, ctx, captured } = makeEnv(() => new Response("origin"));
    seedGrant({ id: `${grantId}-revoked`, revokedAt: new Date(START) });
    seedGrant({ id: `${grantId}-other-user`, userId: OTHER });
    seedGrant({ id: `${grantId}-other-server`, serverId: otherServerId });
    const valid = await token();
    const [payload, signature] = valid.slice("bbmcp_".length).split(".");
    const forgedPayload = btoa(
      JSON.stringify({ ...JSON.parse(atob(payload)), scope: "bb admin" }),
    ).replace(/=+$/u, "");
    const invalid: Record<string, string> = {
      "another handle's resource": await token({
        resource: `https://${otherHandle}.${BASE}/mcp`,
        serverId: otherServerId,
      }),
      "mismatched resource": await token({
        resource: `https://${otherHandle}.${BASE}/mcp`,
      }),
      "another user": await token({ userId: OTHER }),
      "another server": await token({ serverId: otherServerId }),
      expired: await token({ expiresAt: START - 1 }),
      "tampered signature": `bbmcp_${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`,
      "tampered payload": `bbmcp_${forgedPayload}.${signature}`,
      "wrong secret": await signMcpAccessToken(
        {
          version: 1,
          userId: OWNER,
          serverId,
          grantId,
          resource: `https://${handle}.${BASE}/mcp`,
          scope: "bb",
          clientName: "Claude",
          issuedAt: START,
          expiresAt: START + 60_000,
        },
        "another-secret",
      ),
      "revoked grant": await token({ grantId: `${grantId}-revoked` }),
      "missing grant": await token({ grantId: `${grantId}-missing` }),
      "grant of another user": await token({
        grantId: `${grantId}-other-user`,
      }),
      "grant of another server": await token({
        grantId: `${grantId}-other-server`,
      }),
      "no recognised scope": await token({ scope: "admin" }),
      garbage: "not-a-token",
    };
    for (const [name, value] of Object.entries(invalid)) {
      const response = await worker.fetch(
        visit("/mcp", {
          headers: { authorization: `Bearer ${value}`, cookie: SESSION_COOKIE },
        }),
        env as never,
        ctx,
      );
      expect(response.status, name).toBe(401);
      expect(response.headers.get("www-authenticate"), name).toBe(
        challenge(true),
      );
    }
    expect(captured).toHaveLength(0);
    const control = await worker.fetch(
      visit("/mcp", { headers: { authorization: `Bearer ${valid}` } }),
      env as never,
      ctx,
    );
    expect(control.status).toBe(200);
  });

  it("rejects every token once the server is revoked", async () => {
    const { env, ctx, captured } = makeEnv(() => new Response("origin"));
    db.update(server)
      .set({ revokedAt: new Date(START) })
      .where(eq(server.id, serverId))
      .run();
    await expectChallenge(
      await worker.fetch(
        visit("/mcp", {
          headers: { authorization: `Bearer ${await token()}` },
        }),
        env as never,
        ctx,
      ),
      true,
    );
    expect(captured).toHaveLength(0);
  });

  it("stops honouring a revoked grant once the cached lookup expires", async () => {
    const { env, ctx, captured } = makeEnv(() => new Response("origin"));
    const request = async () =>
      worker.fetch(
        visit("/mcp", {
          headers: { authorization: `Bearer ${await token()}` },
        }),
        env as never,
        ctx,
      );
    expect((await request()).status).toBe(200);
    db.update(oauthGrant)
      .set({ revokedAt: new Date(START) })
      .where(eq(oauthGrant.id, grantId))
      .run();
    vi.setSystemTime(START + MCP_GRANT_CACHE_TTL_MS - 1);
    expect((await request()).status).toBe(200);
    vi.setSystemTime(START + MCP_GRANT_CACHE_TTL_MS + 1);
    await expectChallenge(await request(), true);
    expect(captured).toHaveLength(2);
  });

  it("writes lastUsedAt only for a grant's first use", async () => {
    const { env, ctx, waitUntil } = makeEnv(() => new Response("origin"));
    const request = async () => {
      const response = await worker.fetch(
        visit("/mcp", {
          headers: { authorization: `Bearer ${await token()}` },
        }),
        env as never,
        ctx,
      );
      expect(response.status).toBe(200);
      await Promise.all(waitUntil.mock.calls.map(([work]) => work));
    };
    await request();
    await request();
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(lastUsedAt(grantId)?.getTime()).toBe(START);

    vi.setSystemTime(START + MCP_GRANT_CACHE_TTL_MS + 1);
    await request();
    vi.setSystemTime(START + 6 * 60 * 60 * 1000);
    await request();
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(lastUsedAt(grantId)?.getTime()).toBe(START);
  });

  it("streams an event-stream response without buffering or caching it", async () => {
    const encoder = new TextEncoder();
    let origin: ReadableStreamDefaultController<Uint8Array> | null = null;
    const { env, ctx } = makeEnv(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              origin = controller;
            },
          }),
          {
            headers: {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
            },
          },
        ),
    );
    const response = await worker.fetch(
      visit("/mcp", {
        method: "POST",
        body: "{}",
        headers: {
          authorization: `Bearer ${await token()}`,
          accept: "application/json, text/event-stream",
        },
      }),
      env as never,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-encoding")).toBeNull();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    origin!.enqueue(encoder.encode("event: message\ndata: one\n\n"));
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe("event: message\ndata: one\n\n");
    origin!.enqueue(encoder.encode("event: message\ndata: two\n\n"));
    const second = await reader.read();
    expect(decoder.decode(second.value)).toBe("event: message\ndata: two\n\n");
    origin!.close();
    expect((await reader.read()).done).toBe(true);
  });

  it("returns the plain tunnel failure when the server is offline", async () => {
    const { env, ctx } = makeEnv(
      () =>
        new Response("bb connect: tunnel offline\n", {
          status: 503,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            [TUNNEL_OFFLINE_HEADER]: "1",
          },
        }),
    );
    const response = await worker.fetch(
      visit("/mcp", {
        headers: {
          authorization: `Bearer ${await token()}`,
          accept: "text/html",
        },
      }),
      env as never,
      ctx,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("bb connect: tunnel offline\n");
  });
});

describe("MCP on local Cloud dev", () => {
  it("uses the public local origin for metadata, challenges and token audience", async () => {
    const { env, ctx, captured } = makeEnv(() => new Response("origin"));
    Object.assign(env, {
      ACCOUNT_APP_URL: "http://bb.localhost:42745",
      BASE_DOMAIN: "bb.localhost",
      CLOUD_DEV: "true",
    });
    const origin = `http://${handle}.bb.localhost:42745`;
    const local = (path: string, headers: Record<string, string> = {}) =>
      new Request(`http://127.0.0.1:50743${path}`, {
        headers: {
          host: "127.0.0.1:50743",
          "x-bb-cloud-dev-host": handle,
          ...headers,
        },
      });

    const metadata = await worker.fetch(
      local("/.well-known/oauth-protected-resource"),
      env as never,
      ctx,
    );
    expect(await metadata.json()).toMatchObject({
      resource: `${origin}/mcp`,
      authorization_servers: ["http://bb.localhost:42745"],
    });

    const anonymous = await worker.fetch(local("/mcp"), env as never, ctx);
    expect(anonymous.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="bb"`,
    );

    const production = await worker.fetch(
      local("/mcp", { authorization: `Bearer ${await token()}` }),
      env as never,
      ctx,
    );
    expect(production.status).toBe(401);

    const forwarded = await worker.fetch(
      local("/mcp", {
        authorization: `Bearer ${await token({ resource: `${origin}/mcp` })}`,
      }),
      env as never,
      ctx,
    );
    expect(forwarded.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(new URL(captured[0].url).pathname).toBe(MCP_LOCAL_PATH);
    expect(captured[0].headers.get(GATE_AUTH_HEADER)).toBe("oauth");
    expect(captured[0].headers.get("x-bb-cloud-dev-host")).toBeNull();
  });
});

describe("MCP plugin route isolation", () => {
  const blocked = [
    MCP_LOCAL_PATH,
    `${MCP_LOCAL_PATH}?x=1`,
    `${MCP_LOCAL_PATH}/`,
    `${MCP_LOCAL_PATH}/messages`,
    `${MCP_LOCAL_PATH};v=1`,
    "//api/v1/plugins/bb--mcp/http/mcp",
    "/api/v1/plugins/bb--mcp/http//mcp",
    "/API/v1/Plugins/BB--MCP/http/Mcp",
    "/api/v1/plugins/bb--mcp/http%2Fmcp",
    "/api/v1/plugins/bb--mcp/http%252fmcp",
    "/api/v1/plugins/bb--%6dcp/http/mcp",
    "/api/v1/plugins/bb--mcp/http/mc%70",
    "/api/v1/threads/..%2fplugins/bb--mcp/http/mcp",
    "/api/v1/plugins/bb--mcp/http/./mcp",
    "/api/v1/plugins/bb--mcp/http%5cmcp",
    "/api/v1/plugins/bb--mcp/http/mcp%20",
    "/api/v1/plugins/bb--mcp/http/mcp%00",
  ];

  it.each(blocked)(
    "answers 404 for %s whatever the caller presents",
    async (path) => {
      const { env, ctx, captured } = makeEnv(() => new Response("origin"));
      const callers: Record<string, string>[] = [
        {},
        { cookie: SESSION_COOKIE },
        { "x-bb-connect-machine": "bbcm_ok" },
        { authorization: `Bearer ${await token()}` },
      ];
      for (const headers of callers) {
        const response = await worker.fetch(
          visit(path, { method: "POST", headers }),
          env as never,
          ctx,
        );
        expect(response.status).toBe(404);
      }
      expect(captured).toHaveLength(0);
    },
  );

  it("leaves neighbouring plugin routes to the session and machine gates", async () => {
    const { env, ctx, captured } = makeEnv(() => new Response("origin"));
    const allowed = [
      "/api/v1/plugins/bb--mcp/http/mcpx",
      "/api/v1/plugins/bb--mcp/http/status",
      "/api/v1/plugins/other/http/mcp",
      "/api/v1/files/api/v1/plugins/bb--mcp/http/mcp",
    ];
    for (const path of allowed) {
      expect(isMcpLocalPath(path)).toBe(false);
      const session = await worker.fetch(
        visit(path, { headers: { cookie: SESSION_COOKIE } }),
        env as never,
        ctx,
      );
      expect(session.status).toBe(200);
      const machineCaller = await worker.fetch(
        visit(path, { headers: { "x-bb-connect-machine": "bbcm_ok" } }),
        env as never,
        ctx,
      );
      expect(machineCaller.status).toBe(200);
    }
    expect(captured.map((req) => req.headers.get(GATE_AUTH_HEADER))).toEqual(
      allowed.flatMap(() => ["session", "machine"]),
    );
  });
});

describe("headerSafeClientName", () => {
  it("keeps printable ASCII, replaces the rest, trims and caps the length", () => {
    expect(headerSafeClientName("  Claude  ")).toBe("Claude");
    expect(headerSafeClientName("Chat GPT\t\u{1f600}")).toBe("Chat?GPT??");
    expect(headerSafeClientName("\r\n")).toBe("??");
    expect(headerSafeClientName("   ")).toBe("unknown");
    expect(headerSafeClientName("x".repeat(79) + " yz")).toBe("x".repeat(79));
  });
});
