import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  NEXT_TUNNEL_WRITE_INTERVAL_MS,
  sha256Hex,
  signMcpAccessToken,
} from "@bb/connect-db";
import { applyConnectDbMigrationsToD1 } from "@bb/connect-db/testing";
import {
  GATE_PRESENCE_BATCH_MAX,
  GATE_PRESENCE_BATCH_PATH,
  GATE_PRESENCE_PATH,
  GATE_RESOLVE_BATCH_MAX,
  GATE_RESOLVE_BATCH_PATH,
  GATE_RESOLVE_PATH,
  type GatePresenceRequest,
  type GateResolveRequest,
} from "@bb/tunnel-contract/next";
import { createDesktopSessionCookie } from "./desktop-session.js";

const SECRET = "auth-secret";
const GATE_SECRET = "gate-secret-0123456789";
const BASE = "getbb.app";
const NEXT = "next.getbb.app";
const OWNER = "user-owner";
const OTHER = "user-other";
const SERVER_CREDENTIAL = "bbcred_server_orchid";
const REVOKED_CREDENTIAL = "bbcred_server_gone";
const MACHINE_CREDENTIAL = "bbcm_machine_box";
const OTHER_MACHINE_CREDENTIAL = "bbcm_machine_other";
const SESSION_COOKIE = "__Secure-better-auth.session_token";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.now();

type ClientWebSocket = NonNullable<
  Awaited<ReturnType<Miniflare["dispatchFetch"]>>["webSocket"]
>;

let script = "";
let mf: Miniflare;
let db: D1Database;
const instances: Miniflare[] = [];

async function bundleWorker(): Promise<string> {
  const result = await build({
    entryPoints: [
      fileURLToPath(new URL("../test/host-fixture.ts", import.meta.url)),
    ],
    bundle: true,
    format: "esm",
    target: "esnext",
    conditions: ["workerd", "worker", "browser"],
    write: false,
  });
  return result.outputFiles[0].text;
}

function gate(bindings: Record<string, string>): Miniflare {
  const instance = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2026-06-11",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { TUNNEL_DO: "TunnelDO" },
    d1Databases: { DB: `gate-api-${instances.length}` },
    bindings: {
      BASE_DOMAIN: BASE,
      BETTER_AUTH_SECRET: SECRET,
      PRESENCE_WRITES: "on-change",
      ...bindings,
    },
  });
  instances.push(instance);
  return instance;
}

async function run(sql: string, ...values: unknown[]): Promise<void> {
  await db
    .prepare(sql)
    .bind(...values)
    .run();
}

async function signedSessionCookie(token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  return encodeURIComponent(
    `${token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`,
  );
}

async function seed(target: D1Database): Promise<void> {
  const exec = async (sql: string, ...values: unknown[]): Promise<void> => {
    await target
      .prepare(sql)
      .bind(...values)
      .run();
  };
  await applyConnectDbMigrationsToD1(target);
  for (const id of [OWNER, OTHER]) {
    await exec(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?1, ?1 || '@example.com', 1, ?2, ?2)",
      id,
      NOW,
    );
  }
  await exec(
    "INSERT INTO profile (user_id, handle, created_at) VALUES (?1, 'owner', ?2)",
    OWNER,
    NOW,
  );
  await exec(
    "INSERT INTO server (id, user_id, name, subdomain, credential_hash, last_seen_at, created_at) VALUES ('srv-orchid', ?1, 'orchid', 'orchid', ?2, ?3, ?3)",
    OWNER,
    await sha256Hex(SERVER_CREDENTIAL),
    NOW - HOUR_MS,
  );
  await exec(
    "INSERT INTO server (id, user_id, name, subdomain, credential_hash, revoked_at, created_at) VALUES ('srv-gone', ?1, 'gone', 'gone', ?2, ?3, ?3)",
    OWNER,
    await sha256Hex(REVOKED_CREDENTIAL),
    NOW,
  );
  await exec(
    "INSERT INTO server (id, user_id, name, subdomain, credential_hash, created_at) VALUES ('srv-bravo', ?1, 'bravo', 'bravo', ?2, ?3)",
    OWNER,
    await sha256Hex("bbcred_server_bravo"),
    NOW,
  );
  await exec(
    "INSERT INTO machine (id, user_id, name, subdomain, credential_hash, created_at) VALUES ('mch-box', ?1, 'box', 'box', ?2, ?3)",
    OWNER,
    await sha256Hex(MACHINE_CREDENTIAL),
    NOW,
  );
  await exec(
    "INSERT INTO machine (id, user_id, name, credential_hash, created_at) VALUES ('mch-other', ?1, 'other', ?2, ?3)",
    OTHER,
    await sha256Hex(OTHER_MACHINE_CREDENTIAL),
    NOW,
  );
  const sessions = [
    ["ses-owner", OWNER, "tok-owner", NOW + 6.5 * DAY_MS],
    ["ses-stale", OWNER, "tok-stale", NOW + DAY_MS],
    ["ses-expired", OWNER, "tok-expired", NOW - HOUR_MS],
    ["ses-other", OTHER, "tok-other", NOW + 6.5 * DAY_MS],
  ] as const;
  for (const [id, userId, token, expiresAt] of sessions) {
    await exec(
      "INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
      id,
      userId,
      token,
      expiresAt,
      NOW,
    );
  }
  for (const [id, resource] of [
    ["grant-next", `https://orchid.${NEXT}/mcp`],
    ["grant-cf", `https://orchid.${BASE}/mcp`],
  ] as const) {
    await exec(
      "INSERT INTO oauth_grant (id, user_id, server_id, client_id, client_name, resource, scope, created_at) VALUES (?1, ?2, 'srv-orchid', 'client-1', 'Claude', ?3, 'bb', ?4)",
      id,
      OWNER,
      resource,
      NOW,
    );
  }
}

beforeAll(async () => {
  script = await bundleWorker();
  mf = gate({ GATE_SECRET, NEXT_BASE_DOMAIN: NEXT });
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
  await seed(db);
}, 60_000);

afterAll(async () => {
  await Promise.all(instances.map((instance) => instance.dispose()));
});

function post(
  instance: Miniflare,
  path: string,
  body: unknown,
  authorization: string | null = `Bearer ${GATE_SECRET}`,
  host = `connect.${BASE}`,
) {
  return instance.dispatchFetch(`https://${host}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization === null ? {} : { authorization }),
    },
    body: JSON.stringify(body),
  });
}

function ask(over: Partial<GateResolveRequest>): GateResolveRequest {
  return {
    label: "orchid",
    session: null,
    desktopSession: null,
    credential: null,
    machineCredential: null,
    oauth: null,
    ...over,
  };
}

async function resolve(over: Partial<GateResolveRequest>) {
  const response = await post(mf, GATE_RESOLVE_PATH, ask(over));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return (await response.json()) as Record<string, unknown>;
}

function accessToken(over: {
  grantId: string;
  resource: string;
  expiresAt?: number;
}): Promise<string> {
  return signMcpAccessToken(
    {
      version: 1,
      userId: OWNER,
      serverId: "srv-orchid",
      grantId: over.grantId,
      resource: over.resource,
      scope: "bb",
      clientName: "Claude",
      issuedAt: NOW,
      expiresAt: over.expiresAt ?? NOW + HOUR_MS,
    },
    SECRET,
  );
}

describe("gate account API authentication", () => {
  it("answers 404 for a missing, wrong or non-bearer secret on every route", async () => {
    for (const path of [
      GATE_RESOLVE_PATH,
      GATE_PRESENCE_PATH,
      GATE_RESOLVE_BATCH_PATH,
      GATE_PRESENCE_BATCH_PATH,
    ]) {
      for (const authorization of [
        null,
        "Bearer wrong",
        `Bearer ${GATE_SECRET}x`,
        `Basic ${GATE_SECRET}`,
        GATE_SECRET,
      ]) {
        const response = await post(mf, path, ask({}), authorization);
        expect(response.status).toBe(404);
        expect(await response.text()).toBe("bb connect: not found\n");
      }
    }
  });

  it("answers 404 even with a bearer when the worker has no GATE_SECRET", async () => {
    const unset = gate({ NEXT_BASE_DOMAIN: NEXT });
    for (const authorization of ["Bearer ", "Bearer undefined", "Bearer x"]) {
      const response = await post(
        unset,
        GATE_RESOLVE_PATH,
        ask({}),
        authorization,
      );
      expect(response.status).toBe(404);
    }
  });

  it("is reached on connect.<base> before the reserved-handle redirect", async () => {
    const other = await mf.dispatchFetch(`https://connect.${BASE}/dashboard`, {
      redirect: "manual",
    });
    expect(other.status).toBe(301);
    expect(other.headers.get("location")).toBe(`https://${BASE}/dashboard`);
    const resolved = await post(mf, GATE_RESOLVE_PATH, ask({}));
    expect(resolved.status).toBe(200);
  });

  it("does not take the path over on a server's own label", async () => {
    const response = await post(
      mf,
      GATE_RESOLVE_PATH,
      ask({}),
      `Bearer ${GATE_SECRET}`,
      `orchid.${BASE}`,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).not.toContain("json");
  });

  it("refuses GET and malformed bodies after authenticating", async () => {
    const get = await mf.dispatchFetch(
      `https://connect.${BASE}${GATE_RESOLVE_PATH}`,
      {
        headers: { authorization: `Bearer ${GATE_SECRET}` },
      },
    );
    expect(get.status).toBe(405);
    for (const body of [
      null,
      { label: "orchid" },
      { ...ask({}), extra: true },
      ask({ label: "Alpha" }),
      ask({ label: "a.b" }),
      ask({ session: "" }),
      ask({ credential: 7 as unknown as string }),
      { ...ask({}), oauth: { token: "t" } },
    ]) {
      const response = await post(mf, GATE_RESOLVE_PATH, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
  });
});

describe("POST /api/gate/resolve", () => {
  it("answers every field null when nothing is asked of an unknown label", async () => {
    expect(await resolve({ label: "nobody" })).toEqual({
      label: null,
      session: null,
      desktopSession: null,
      credential: null,
      machine: null,
      oauth: null,
    });
  });

  it("resolves a server label and a machine label", async () => {
    expect((await resolve({})).label).toEqual({
      kind: "server",
      serverId: "srv-orchid",
      userId: OWNER,
      revoked: false,
      lastSeenAt: expect.any(Number),
    });
    const machine = (await resolve({ label: "box" })).label as Record<
      string,
      unknown
    >;
    expect(machine).toMatchObject({
      kind: "machine",
      machineId: "mch-box",
      userId: OWNER,
      accountHandle: "owner",
      revoked: false,
      lastSeenAt: null,
    });
    expect(machine.routingKey).toMatch(/^box:/u);
    expect((await resolve({ label: "gone" })).label).toMatchObject({
      kind: "server",
      revoked: true,
    });
  });

  it("verifies better-auth session cookies, valid, near expiry, expired and another user's", async () => {
    expect(
      (await resolve({ session: await signedSessionCookie("tok-owner") }))
        .session,
    ).toEqual({ userId: OWNER, needsRefresh: false });
    expect(
      (await resolve({ session: await signedSessionCookie("tok-stale") }))
        .session,
    ).toEqual({ userId: OWNER, needsRefresh: true });
    expect(
      (await resolve({ session: await signedSessionCookie("tok-expired") }))
        .session,
    ).toBeNull();
    expect(
      (await resolve({ session: await signedSessionCookie("tok-other") }))
        .session,
    ).toEqual({ userId: OTHER, needsRefresh: false });
    expect(
      (await resolve({ session: "tok-owner.forged-signature" })).session,
    ).toBeNull();
  });

  it("verifies desktop session cookies and renews one close to expiry for the label owner", async () => {
    const fresh = await createDesktopSessionCookie(
      { userId: OWNER, grant: { kind: "session", sessionId: "ses-owner" } },
      SECRET,
      NOW + 6.5 * DAY_MS,
    );
    expect((await resolve({ desktopSession: fresh })).desktopSession).toEqual({
      userId: OWNER,
      setCookie: null,
    });

    const ageing = await createDesktopSessionCookie(
      { userId: OWNER, grant: { kind: "session", sessionId: "ses-owner" } },
      SECRET,
      NOW + DAY_MS,
    );
    const renewed = (await resolve({ desktopSession: ageing }))
      .desktopSession as { userId: string; setCookie: string };
    expect(renewed.userId).toBe(OWNER);
    expect(renewed.setCookie).toMatch(
      /^__Secure-bb-connect\.desktop_session=[^;]+; Domain=\.getbb\.app; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax; Secure$/u,
    );

    const other = await createDesktopSessionCookie(
      { userId: OTHER, grant: { kind: "session", sessionId: "ses-other" } },
      SECRET,
      NOW + DAY_MS,
    );
    expect((await resolve({ desktopSession: other })).desktopSession).toEqual({
      userId: OTHER,
      setCookie: null,
    });

    const revokedGrant = await createDesktopSessionCookie(
      { userId: OWNER, grant: { kind: "session", sessionId: "ses-expired" } },
      SECRET,
      NOW + DAY_MS,
    );
    expect(
      (await resolve({ desktopSession: revokedGrant })).desktopSession,
    ).toBeNull();
    expect(
      (await resolve({ desktopSession: `${fresh.slice(0, -2)}xx` }))
        .desktopSession,
    ).toBeNull();
  });

  it("checks the link credential against the label's own hash and refuses revoked servers", async () => {
    expect((await resolve({ credential: SERVER_CREDENTIAL })).credential).toBe(
      true,
    );
    expect((await resolve({ credential: "bbcred_wrong" })).credential).toBe(
      false,
    );
    expect(
      (await resolve({ label: "bravo", credential: SERVER_CREDENTIAL }))
        .credential,
    ).toBe(false);
    expect(
      (await resolve({ label: "gone", credential: REVOKED_CREDENTIAL }))
        .credential,
    ).toBe(false);
    expect(
      (await resolve({ label: "box", credential: MACHINE_CREDENTIAL }))
        .credential,
    ).toBe(true);
    expect(
      (await resolve({ label: "nobody", credential: SERVER_CREDENTIAL }))
        .credential,
    ).toBe(false);
  });

  it("sees a credential rotated a moment ago because credential checks read fresh", async () => {
    await resolve({ credential: SERVER_CREDENTIAL });
    await run(
      "UPDATE server SET credential_hash = ?1 WHERE id = 'srv-bravo'",
      await sha256Hex("bbcred_bravo_rotated"),
    );
    expect(
      (await resolve({ label: "bravo", credential: "bbcred_bravo_rotated" }))
        .credential,
    ).toBe(true);
  });

  it("verifies machine credentials by their own hash, whoever owns the label", async () => {
    expect(
      (await resolve({ machineCredential: MACHINE_CREDENTIAL })).machine,
    ).toEqual({ machineId: "mch-box", userId: OWNER });
    expect(
      (await resolve({ machineCredential: OTHER_MACHINE_CREDENTIAL })).machine,
    ).toEqual({ machineId: "mch-other", userId: OTHER });
    expect(
      (await resolve({ machineCredential: SERVER_CREDENTIAL })).machine,
    ).toBeNull();
  });

  it("accepts an MCP token only for the next resource it was issued for", async () => {
    const nextResource = `https://orchid.${NEXT}/mcp`;
    const cfResource = `https://orchid.${BASE}/mcp`;
    const nextToken = await accessToken({
      grantId: "grant-next",
      resource: nextResource,
    });
    const cfToken = await accessToken({
      grantId: "grant-cf",
      resource: cfResource,
    });
    expect(
      (await resolve({ oauth: { token: nextToken, resource: nextResource } }))
        .oauth,
    ).toEqual({ scope: "bb", grantId: "grant-next", clientName: "Claude" });
    expect(
      (await resolve({ oauth: { token: cfToken, resource: nextResource } }))
        .oauth,
    ).toBeNull();
    expect(
      (await resolve({ oauth: { token: cfToken, resource: cfResource } }))
        .oauth,
    ).toBeNull();
    expect(
      (
        await resolve({
          label: "bravo",
          oauth: { token: nextToken, resource: `https://bravo.${NEXT}/mcp` },
        })
      ).oauth,
    ).toBeNull();
    expect(
      (
        await resolve({
          oauth: {
            token: await accessToken({
              grantId: "grant-next",
              resource: nextResource,
              expiresAt: NOW - 1,
            }),
            resource: nextResource,
          },
        })
      ).oauth,
    ).toBeNull();
  });

  it("refuses a next token at the Cloudflare gate's /mcp", async () => {
    const nextToken = await accessToken({
      grantId: "grant-next",
      resource: `https://orchid.${NEXT}/mcp`,
    });
    const response = await mf.dispatchFetch(`https://orchid.${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${nextToken}` },
      body: "{}",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
  });

  it("accepts an http next resource with a port only in local Cloud development", async () => {
    const portResource = `http://orchid.${NEXT}:8080/mcp`;
    expect(
      (
        await resolve({
          oauth: {
            token: await accessToken({
              grantId: "grant-next",
              resource: portResource,
            }),
            resource: portResource,
          },
        })
      ).oauth,
    ).toBeNull();

    const local = gate({
      GATE_SECRET,
      BASE_DOMAIN: "bb.localhost",
      ACCOUNT_APP_URL: "http://bb.localhost:35067",
      CLOUD_DEV: "true",
      NEXT_BASE_DOMAIN: "next.bb.localhost",
    });
    await seed((await local.getD1Database("DB")) as unknown as D1Database);
    const localResource = "http://orchid.next.bb.localhost:41000/mcp";
    const token = await accessToken({
      grantId: "grant-next",
      resource: localResource,
    });
    const oauthFor = async (label: string, resource: string) => {
      const response = await post(
        local,
        GATE_RESOLVE_PATH,
        ask({ label, oauth: { token, resource } }),
        `Bearer ${GATE_SECRET}`,
        "connect.bb.localhost",
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { oauth: unknown }).oauth;
    };
    expect(await oauthFor("orchid", localResource)).toEqual({
      scope: "bb",
      grantId: "grant-next",
      clientName: "Claude",
    });
    expect(
      await oauthFor("orchid", "http://orchid.next.bb.localhost:41001/mcp"),
    ).toBeNull();
    expect(
      await oauthFor("bravo", "http://bravo.next.bb.localhost:41000/mcp"),
    ).toBeNull();
    expect(
      await oauthFor("orchid", "http://orchid.bb.localhost:41000/mcp"),
    ).toBeNull();
  }, 30_000);

  it("refuses OAuth when the worker has no NEXT_BASE_DOMAIN", async () => {
    const bare = gate({ GATE_SECRET });
    await seed((await bare.getD1Database("DB")) as unknown as D1Database);
    const nextResource = `https://orchid.${NEXT}/mcp`;
    const response = await post(
      bare,
      GATE_RESOLVE_PATH,
      ask({
        oauth: {
          token: await accessToken({
            grantId: "grant-next",
            resource: nextResource,
          }),
          resource: nextResource,
        },
      }),
    );
    expect(((await response.json()) as { oauth: unknown }).oauth).toBeNull();
  }, 30_000);
});

function presence(over: Partial<GatePresenceRequest>): GatePresenceRequest {
  return {
    label: "orchid",
    state: "connected",
    region: "iad",
    gateMachineId: "fly-a",
    at: Date.now(),
    ...over,
  };
}

async function report(over: Partial<GatePresenceRequest>) {
  const response = await post(mf, GATE_PRESENCE_PATH, presence(over));
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function nextColumns(table: "server" | "machine", id: string) {
  return db
    .prepare(
      `SELECT next_tunnel_gate AS gate, next_tunnel_region AS region, next_tunnel_at AS at, last_seen_at AS lastSeenAt FROM ${table} WHERE id = ?1`,
    )
    .bind(id)
    .first<{
      gate: string | null;
      region: string | null;
      at: number | null;
      lastSeenAt: number | null;
    }>();
}

async function dashboardLive(handle: string): Promise<boolean | undefined> {
  const response = await mf.dispatchFetch(
    `https://connect.${BASE}/api/connect/servers`,
    {
      headers: {
        cookie: `${SESSION_COOKIE}=${await signedSessionCookie("tok-owner")}`,
      },
    },
  );
  const body = (await response.json()) as {
    servers: { handle: string; live: boolean }[];
  };
  return body.servers.find((entry) => entry.handle === handle)?.live;
}

async function dialCloudflareTunnel(): Promise<ClientWebSocket> {
  const dial = await mf.dispatchFetch(`https://orchid.${BASE}/__tunnel`, {
    headers: {
      upgrade: "websocket",
      authorization: `Bearer ${SERVER_CREDENTIAL}`,
    },
  });
  if (!dial.webSocket) throw new Error(`tunnel dial failed: ${dial.status}`);
  dial.webSocket.accept();
  return dial.webSocket;
}

let lastTick = 0;

function tick(): number {
  lastTick = Math.max(Date.now(), lastTick + 1);
  return lastTick;
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition never held");
}

describe("POST /api/gate/presence", () => {
  it("rejects unknown labels, bad bodies and times from the future", async () => {
    expect(await report({ label: "nobody" })).toEqual({
      status: 404,
      body: { error: "unknown_label" },
    });
    expect(
      (await report({ state: "gone" as GatePresenceRequest["state"] })).status,
    ).toBe(400);
    expect((await report({ gateMachineId: "" })).status).toBe(400);
    expect((await report({ at: 1.5 })).status).toBe(400);
    expect((await report({ at: Date.now() + 5 * 60_000 })).status).toBe(400);
  });

  it("shows a server online through next, through Cloudflare, and through both", async () => {
    expect(await dashboardLive("orchid")).toBe(false);

    const connectedAt = tick();
    expect(await report({ at: connectedAt })).toEqual({
      status: 200,
      body: { recorded: true },
    });
    expect(await nextColumns("server", "srv-orchid")).toMatchObject({
      gate: "fly-a",
      region: "iad",
      at: connectedAt,
    });
    expect(
      (await nextColumns("server", "srv-orchid"))?.lastSeenAt,
    ).toBeGreaterThanOrEqual(connectedAt - 1000);
    expect(await dashboardLive("orchid")).toBe(true);

    expect((await report({ at: connectedAt + 1000 })).body).toEqual({
      recorded: false,
    });
    await run(
      "UPDATE server SET next_tunnel_at = ?1 WHERE id = 'srv-orchid'",
      connectedAt - NEXT_TUNNEL_WRITE_INTERVAL_MS,
    );
    const refreshedAt = tick();
    expect((await report({ at: refreshedAt })).body).toEqual({
      recorded: true,
    });
    expect((await nextColumns("server", "srv-orchid"))?.at).toBe(refreshedAt);

    const tunnel = await dialCloudflareTunnel();
    await waitFor(async () => (await dashboardLive("orchid")) === true);

    expect(
      (
        await report({
          state: "disconnected",
          gateMachineId: "fly-b",
          at: tick(),
        })
      ).body,
    ).toEqual({ recorded: false });
    expect(
      (await report({ state: "disconnected", at: connectedAt - 1 })).body,
    ).toEqual({ recorded: false });
    expect((await report({ state: "disconnected", at: tick() })).body).toEqual({
      recorded: true,
    });
    expect(await nextColumns("server", "srv-orchid")).toMatchObject({
      gate: null,
      region: null,
    });
    expect(await dashboardLive("orchid")).toBe(true);

    expect((await report({ state: "disconnected", at: tick() })).body).toEqual({
      recorded: false,
    });

    tunnel.close(1000, "done");
    await waitFor(async () => (await dashboardLive("orchid")) === false);

    expect((await report({ at: tick() })).body).toEqual({
      recorded: true,
    });
    expect(await dashboardLive("orchid")).toBe(true);
    expect((await report({ state: "disconnected", at: tick() })).body).toEqual({
      recorded: true,
    });
    expect(await dashboardLive("orchid")).toBe(false);
  });

  it("ignores a late connect older than the last event, and moves to another gate machine", async () => {
    const first = Date.now();
    expect((await report({ label: "bravo", at: first })).body).toEqual({
      recorded: true,
    });
    expect(
      (await report({ label: "bravo", gateMachineId: "fly-b", at: first - 10 }))
        .body,
    ).toEqual({ recorded: false });
    expect(
      (
        await report({
          label: "bravo",
          gateMachineId: "fly-b",
          region: "ams",
          at: first + 10,
        })
      ).body,
    ).toEqual({ recorded: true });
    expect(
      (
        await report({
          label: "bravo",
          state: "disconnected",
          gateMachineId: "fly-a",
          at: first + 20,
        })
      ).body,
    ).toEqual({ recorded: false });
    expect(await nextColumns("server", "srv-bravo")).toMatchObject({
      gate: "fly-b",
      region: "ams",
    });
    expect(await dashboardLive("bravo")).toBe(true);
  });

  it("records machine labels on the machine row", async () => {
    const at = Date.now();
    expect((await report({ label: "box", at })).body).toEqual({
      recorded: true,
    });
    expect(await nextColumns("machine", "mch-box")).toMatchObject({
      gate: "fly-a",
      region: "iad",
      at,
    });
  });
});

describe("POST /api/gate/resolve/batch", () => {
  it("answers each request in order exactly as the single route does", async () => {
    const requests = [
      ask({ credential: SERVER_CREDENTIAL }),
      ask({ label: "gone", credential: REVOKED_CREDENTIAL }),
      ask({
        session: await signedSessionCookie("tok-owner"),
      }),
      ask({ label: "nobody" }),
      ask({ label: "box", machineCredential: MACHINE_CREDENTIAL }),
    ];
    const response = await post(mf, GATE_RESOLVE_BATCH_PATH, { requests });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { answers } = (await response.json()) as { answers: unknown[] };
    expect(answers).toHaveLength(requests.length);
    const withoutSeen = (answer: unknown) =>
      JSON.parse(
        JSON.stringify(answer, (key, value: unknown) =>
          key === "lastSeenAt" ? undefined : value,
        ),
      ) as unknown;
    for (const [index, request] of requests.entries()) {
      expect(withoutSeen(answers[index])).toEqual(
        withoutSeen(await resolve(request)),
      );
    }
    expect(answers[0]).toMatchObject({ credential: true });
    expect(answers[1]).toMatchObject({ credential: false });
    expect(answers[2]).toMatchObject({ session: { userId: OWNER } });
    expect(answers[3]).toMatchObject({ label: null });
  });

  it("refuses empty, oversized and malformed batches", async () => {
    for (const body of [
      {},
      { requests: [] },
      { requests: [ask({})], extra: 1 },
      { requests: [ask({ label: "Bad" })] },
      {
        requests: Array.from({ length: GATE_RESOLVE_BATCH_MAX + 1 }, () =>
          ask({}),
        ),
      },
    ]) {
      const response = await post(mf, GATE_RESOLVE_BATCH_PATH, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
  });
});

describe("POST /api/gate/presence/batch", () => {
  async function batch(reports: GatePresenceRequest[]) {
    const response = await post(mf, GATE_PRESENCE_BATCH_PATH, { reports });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }

  it("applies the single route's write rules to every entry in one call", async () => {
    await run(
      "INSERT INTO server (id, user_id, name, subdomain, credential_hash, created_at) VALUES ('srv-lily', ?1, 'lily', 'lily', 'x', ?2), ('srv-iris', ?1, 'iris', 'iris', 'y', ?2)",
      OWNER,
      NOW,
    );
    const at = tick();
    expect(
      await batch([
        presence({ label: "lily", at }),
        presence({ label: "iris", at, gateMachineId: "fly-z", region: "sjc" }),
        presence({ label: "box", at, gateMachineId: "fly-m" }),
        presence({ label: "nobody", at }),
      ]),
    ).toEqual({
      status: 200,
      body: { results: ["recorded", "recorded", "recorded", "unknown_label"] },
    });
    expect(await nextColumns("server", "srv-lily")).toMatchObject({
      gate: "fly-a",
      region: "iad",
      at,
    });
    expect(await nextColumns("machine", "mch-box")).toMatchObject({
      gate: "fly-m",
      at,
    });
    expect(await dashboardLive("lily")).toBe(true);

    const later = tick();
    expect(
      await batch([
        presence({ label: "lily", at: later }),
        presence({ label: "iris", at: later - 10_000, gateMachineId: "fly-y" }),
        presence({
          label: "box",
          state: "disconnected",
          gateMachineId: "fly-other",
          at: later,
        }),
      ]),
    ).toEqual({
      status: 200,
      body: { results: ["unchanged", "unchanged", "unchanged"] },
    });

    await run(
      "UPDATE server SET next_tunnel_at = ?1 WHERE id = 'srv-lily'",
      at - NEXT_TUNNEL_WRITE_INTERVAL_MS,
    );
    const refreshed = tick();
    expect(
      await batch([
        presence({ label: "lily", at: refreshed }),
        presence({
          label: "iris",
          state: "disconnected",
          gateMachineId: "fly-z",
          at: refreshed,
        }),
        presence({
          label: "box",
          state: "disconnected",
          gateMachineId: "fly-m",
          at: refreshed,
        }),
      ]),
    ).toEqual({
      status: 200,
      body: { results: ["recorded", "recorded", "recorded"] },
    });
    expect((await nextColumns("server", "srv-lily"))?.at).toBe(refreshed);
    expect(await nextColumns("server", "srv-iris")).toMatchObject({
      gate: null,
      region: null,
      at: refreshed,
    });
    expect(await nextColumns("machine", "mch-box")).toMatchObject({
      gate: null,
    });
    expect(await dashboardLive("iris")).toBe(false);
    expect(await dashboardLive("lily")).toBe(true);
  });

  it("does not record a revoked machine", async () => {
    await run(
      "INSERT INTO machine (id, user_id, name, subdomain, credential_hash, revoked_at, created_at) VALUES ('mch-old', ?1, 'old', 'old', 'z', ?2, ?2)",
      OWNER,
      NOW,
    );
    expect(await batch([presence({ label: "old", at: tick() })])).toEqual({
      status: 200,
      body: { results: ["unchanged"] },
    });
    expect((await nextColumns("machine", "mch-old"))?.gate).toBeNull();
  });

  it(`records ${GATE_PRESENCE_BATCH_MAX} labels in one call`, async () => {
    await run(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${GATE_PRESENCE_BATCH_MAX})
       INSERT INTO server (id, user_id, name, subdomain, credential_hash, created_at)
       SELECT 'srv-bulk-' || i, ?1, 'bulk-' || i, 'bulk-' || i, 'h', ?2 FROM n`,
      OWNER,
      NOW,
    );
    const at = tick();
    const reports = Array.from(
      { length: GATE_PRESENCE_BATCH_MAX },
      (_, index) => presence({ label: `bulk-${index + 1}`, at }),
    );
    const first = await batch(reports);
    expect(first.status).toBe(200);
    expect(first.body.results).toEqual(reports.map(() => "recorded"));
    const counted = await db
      .prepare(
        "SELECT count(*) AS n FROM server WHERE subdomain LIKE 'bulk-%' AND next_tunnel_gate = 'fly-a' AND next_tunnel_at = ?1",
      )
      .bind(at)
      .first<{ n: number }>();
    expect(counted?.n).toBe(GATE_PRESENCE_BATCH_MAX);
    const again = await batch(
      reports.map((report) => ({ ...report, at: tick() })),
    );
    expect(again.body.results).toEqual(reports.map(() => "unchanged"));
  });

  it("refuses duplicates, oversized batches, bad entries and times from the future", async () => {
    for (const body of [
      {},
      { reports: [] },
      { reports: [presence({}), presence({})] },
      { reports: [presence({ gateMachineId: "" })] },
      { reports: [presence({ at: Date.now() + 5 * 60_000 })] },
      {
        reports: Array.from(
          { length: GATE_PRESENCE_BATCH_MAX + 1 },
          (_, index) => presence({ label: `x${index}` }),
        ),
      },
    ]) {
      const response = await post(mf, GATE_PRESENCE_BATCH_PATH, body);
      expect(response.status).toBe(400);
    }
  });
});
