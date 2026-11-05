import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { eq } from "drizzle-orm";
import {
  type TestConnectDb,
  createTestConnectDb,
} from "@bb/connect-db-pg/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  account,
  CONNECT_SESSION_EXPIRES_IN_SECONDS,
  CONNECT_SESSION_UPDATE_AGE_SECONDS,
  labelClaim,
  machine,
  profile,
  server,
  session,
  sha256Hex,
  user,
  verification,
  first,
  type ConnectDb,
} from "@bb/connect-db";

import {
  invalidateSessionCookie,
  LOOKUP_FALLBACK_AFTER_MS,
  LOOKUP_FALLBACK_WINDOW_MS,
  LOOKUP_JOIN_TIMEOUT_MS,
  LOOKUP_RETRY_DELAY_MS,
  MACHINE_LAST_SEEN_WRITE_INTERVAL_MS,
  markMachineSeen,
  resolveLabel,
  verifyMachineCredentialDetails,
  verifySessionCookieDetails,
} from "./session.js";
import { refreshAccountSessionCookies } from "./account-session.js";
import { assignMachineLabel } from "./machine-label.js";

let database: TestConnectDb;
let db: ConnectDb;

beforeEach(async () => {
  database = await createTestConnectDb();
  db = database.db;
});

afterEach(async () => {
  await database.close();
});

const now = new Date();

async function seedUser(id: string): Promise<void> {
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedServer(over: {
  id: string;
  userId: string;
  name: string;
  subdomain: string;
  credentialHash?: string | null;
  revokedAt?: Date | null;
  lastSeenAt?: Date | null;
}): Promise<void> {
  await db.insert(server).values({
    id: over.id,
    userId: over.userId,
    name: over.name,
    subdomain: over.subdomain,
    credentialHash: "credentialHash" in over ? over.credentialHash : "hash",
    revokedAt: over.revokedAt ?? null,
    lastSeenAt: over.lastSeenAt ?? null,
    createdAt: now,
  });
}

async function seedMachine(over: {
  id: string;
  userId: string;
  subdomain: string | null;
  credentialHash?: string;
  revokedAt?: Date | null;
  lastSeenAt?: Date | null;
}): Promise<void> {
  await db.insert(machine).values({
    id: over.id,
    userId: over.userId,
    subdomain: over.subdomain,
    credentialHash: over.credentialHash ?? "machine-hash",
    revokedAt: over.revokedAt ?? null,
    lastSeenAt: over.lastSeenAt ?? null,
    createdAt: now,
  });
  if (over.subdomain !== null) {
    await db
      .update(labelClaim)
      .set({ generation: `${over.id}-generation` })
      .where(eq(labelClaim.label, over.subdomain));
  }
}

async function signedSessionCookie(
  token: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return encodeURIComponent(`${token}.${encoded}`);
}

describe("resolveLabel — label → server row (multi-server)", () => {
  it("resolves the primary bb by its backfilled handle-label subdomain", async () => {
    await seedUser("acct-a");
    await db
      .insert(profile)
      .values({ userId: "acct-a", handle: "sawyer", createdAt: now });
    const seen = new Date(now.getTime() - 60_000);
    await seedServer({
      id: "srv-primary",
      userId: "acct-a",
      name: "default",
      subdomain: "sawyer",
      lastSeenAt: seen,
    });

    const resolved = await resolveLabel("sawyer", db, { fresh: true });
    expect(resolved).toEqual({
      kind: "server",
      userId: "acct-a",
      server: {
        id: "srv-primary",
        credentialHash: "hash",
        revokedAt: null,
        lastSeenAt: seen,
      },
    });
  });

  it("resolves a second bb on the same account by its own claimed subdomain", async () => {
    await seedUser("acct-a");
    await db
      .insert(profile)
      .values({ userId: "acct-a", handle: "sawyer", createdAt: now });
    await seedServer({
      id: "srv-primary",
      userId: "acct-a",
      name: "default",
      subdomain: "sawyer",
    });
    await seedServer({
      id: "srv-desktop",
      userId: "acct-a",
      name: "desktop",
      subdomain: "sawyer-desktop",
    });

    const primary = await resolveLabel("sawyer", db, { fresh: true });
    const desktop = await resolveLabel("sawyer-desktop", db, { fresh: true });
    if (primary?.kind !== "server" || desktop?.kind !== "server") {
      throw new Error("expected server labels");
    }
    expect(primary.server.id).toBe("srv-primary");
    expect(desktop.server.id).toBe("srv-desktop");
    expect(primary?.userId).toBe("acct-a");
    expect(desktop?.userId).toBe("acct-a");
  });

  it("keeps cross-tenant isolation: a label resolves to its owning account only", async () => {
    await seedUser("acct-a");
    await seedUser("acct-b");
    await seedServer({
      id: "srv-a",
      userId: "acct-a",
      name: "default",
      subdomain: "sawyer",
    });
    await seedServer({
      id: "srv-b",
      userId: "acct-b",
      name: "default",
      subdomain: "morgan",
    });

    const a = await resolveLabel("sawyer", db, { fresh: true });
    const b = await resolveLabel("morgan", db, { fresh: true });
    expect(a?.userId).toBe("acct-a");
    expect(b?.userId).toBe("acct-b");
    if (a?.kind !== "server" || b?.kind !== "server") {
      throw new Error("expected server labels");
    }
    expect(a.server.id).toBe("srv-a");
    expect(b.server.id).toBe("srv-b");
  });

  it("returns null for an unclaimed label", async () => {
    await seedUser("acct-a");
    await seedServer({
      id: "srv-a",
      userId: "acct-a",
      name: "default",
      subdomain: "sawyer",
    });
    expect(await resolveLabel("nobody", db, { fresh: true })).toBeNull();
  });

  it("routes a server row atomically claimed by the migration trigger", async () => {
    await seedUser("acct-a");
    await db
      .insert(profile)
      .values({ userId: "acct-a", handle: "sawyer", createdAt: now });
    await db.insert(server).values({
      id: "legacy-server",
      userId: "acct-a",
      name: "desktop",
      subdomain: "legacy-desktop",
      credentialHash: "hash",
      createdAt: now,
    });

    await expect(
      resolveLabel("legacy-desktop", db, { fresh: true }),
    ).resolves.toMatchObject({
      kind: "server",
      server: { id: "legacy-server" },
    });
    expect(
      await first(
        db
          .select()
          .from(labelClaim)
          .where(eq(labelClaim.label, "legacy-desktop"))
          .limit(1),
      ),
    ).toMatchObject({
      kind: "server",
      ownerId: "legacy-server",
      generation: expect.stringMatching(/^[a-f0-9]{32}$/u),
    });
  });

  it("fresh resolution sees an immediately assigned label after a cached negative", async () => {
    await seedUser("acct-a");
    await db
      .insert(profile)
      .values({ userId: "acct-a", handle: "sawyer", createdAt: now });
    await seedMachine({
      id: "machine-new",
      userId: "acct-a",
      subdomain: null,
    });
    await expect(resolveLabel("new-machine", db)).resolves.toBeNull();
    await expect(
      assignMachineLabel(db, "machine-new", "New Machine"),
    ).resolves.toBe("new-machine");
    await expect(resolveLabel("new-machine", db)).resolves.toBeNull();
    await expect(
      resolveLabel("new-machine", db, { fresh: true }),
    ).resolves.toMatchObject({
      kind: "machine",
      routingKey: expect.stringMatching(/^new-machine:/u),
      machine: { id: "machine-new" },
    });
  });

  it("surfaces revoked / unpaired credential state for the tunnel gate", async () => {
    await seedUser("acct-a");
    await seedServer({
      id: "srv-a",
      userId: "acct-a",
      name: "default",
      subdomain: "sawyer",
      credentialHash: null,
      revokedAt: new Date(now.getTime() - 1000),
    });
    const resolved = await resolveLabel("sawyer", db, { fresh: true });
    if (resolved?.kind !== "server") throw new Error("expected server label");
    expect(resolved.server.credentialHash).toBeNull();
    expect(resolved.server.revokedAt).toBeInstanceOf(Date);
  });

  it("falls through to a machine label with owner and presence data", async () => {
    await seedUser("acct-a");
    await db
      .insert(profile)
      .values({ userId: "acct-a", handle: "sawyer", createdAt: now });
    const seen = new Date(now.getTime() - 30_000);
    await seedMachine({
      id: "machine-air",
      userId: "acct-a",
      subdomain: "sawyer-air",
      lastSeenAt: seen,
    });

    await expect(
      resolveLabel("sawyer-air", db, { fresh: true }),
    ).resolves.toEqual({
      kind: "machine",
      routingKey: "sawyer-air:machine-air-generation",
      userId: "acct-a",
      accountHandle: "sawyer",
      machine: {
        id: "machine-air",
        credentialHash: "machine-hash",
        revokedAt: null,
        lastSeenAt: seen,
      },
    });
  });

  it("keeps the server claim when a machine source attempts a collision", async () => {
    await seedUser("acct-a");
    await db
      .insert(profile)
      .values({ userId: "acct-a", handle: "sawyer", createdAt: now });
    await seedServer({
      id: "srv-collision",
      userId: "acct-a",
      name: "default",
      subdomain: "collision",
    });
    await seedMachine({
      id: "machine-collision",
      userId: "acct-a",
      subdomain: null,
    });
    await expect(
      db
        .update(machine)
        .set({ subdomain: "collision" })
        .where(eq(machine.id, "machine-collision")),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/unique constraint/iu) },
    });

    const resolved = await resolveLabel("collision", db, { fresh: true });
    expect(resolved?.kind).toBe("server");
    if (resolved?.kind !== "server") throw new Error("expected server label");
    expect(resolved.server.id).toBe("srv-collision");
  });
});

describe("account session refresh", () => {
  const secret = "test-better-auth-secret-32-chars";
  const expiresInMs = CONNECT_SESSION_EXPIRES_IN_SECONDS * 1000;
  const updateAgeMs = CONNECT_SESSION_UPDATE_AGE_SECONDS * 1000;

  async function seedSession(
    token: string,
    refreshAt: number,
    expiresAt: number,
  ): Promise<void> {
    await seedUser(`user-${token}`);
    await db.insert(session).values({
      id: `id-${token}`,
      token,
      expiresAt: new Date(expiresAt),
      userId: `user-${token}`,
      createdAt: new Date(refreshAt - updateAgeMs),
      updatedAt: new Date(refreshAt - updateAgeMs),
    });
  }

  function createAuthFetch(baseURL: string, baseDomain: string) {
    const auth = betterAuth({
      secret,
      baseURL,
      database: drizzleAdapter(db, {
        provider: "pg",
        schema: { account, session, user, verification },
      }),
      session: {
        expiresIn: CONNECT_SESSION_EXPIRES_IN_SECONDS,
        updateAge: CONNECT_SESSION_UPDATE_AGE_SECONDS,
      },
      advanced: {
        crossSubDomainCookies: {
          enabled: true,
          domain: `.${baseDomain}`,
        },
      },
    });
    return (request: Request) => auth.handler(request);
  }

  it("reports Better Auth's update-age boundary from the session expiry", async () => {
    const checkedAt = Date.now();
    const freshToken = `fresh-${crypto.randomUUID()}`;
    const dueToken = `due-${crypto.randomUUID()}`;
    await seedSession(freshToken, checkedAt, checkedAt + expiresInMs);
    await seedSession(
      dueToken,
      checkedAt,
      checkedAt + expiresInMs - updateAgeMs - 1000,
    );

    await expect(
      verifySessionCookieDetails(
        await signedSessionCookie(freshToken, secret),
        secret,
        db,
      ),
    ).resolves.toEqual({
      sessionId: `id-${freshToken}`,
      userId: `user-${freshToken}`,
      needsRefresh: false,
    });
    await expect(
      verifySessionCookieDetails(
        await signedSessionCookie(dueToken, secret),
        secret,
        db,
      ),
    ).resolves.toEqual({
      sessionId: `id-${dueToken}`,
      userId: `user-${dueToken}`,
      needsRefresh: true,
    });
  });

  it("lets Better Auth renew the database session and production cookie", async () => {
    const refreshAt = Date.now();
    const token = `session-${crypto.randomUUID()}`;
    const oldExpiresAt = refreshAt + expiresInMs - updateAgeMs;
    await seedSession(token, refreshAt, oldExpiresAt);
    const cookie = await signedSessionCookie(token, secret);
    const beforeRefresh = Date.now();

    const setCookies = await refreshAccountSessionCookies(
      `__Secure-better-auth.session_token=${cookie}`,
      "https://getbb.app",
      createAuthFetch("https://getbb.app", "getbb.app"),
    );
    const afterRefresh = Date.now();
    const refreshed = await first(
      db.select().from(session).where(eq(session.token, token)).limit(1),
    );
    expect(refreshed?.expiresAt.getTime()).toBeGreaterThanOrEqual(
      beforeRefresh + expiresInMs,
    );
    expect(refreshed?.expiresAt.getTime()).toBeLessThanOrEqual(
      afterRefresh + expiresInMs,
    );
    expect(setCookies).toHaveLength(1);
    expect(setCookies?.[0]).toContain("__Secure-better-auth.session_token=");
    expect(setCookies?.[0]).toContain("Max-Age=604800");
    expect(setCookies?.[0]).toContain("Domain=.getbb.app");
    expect(setCookies?.[0]).toContain("Secure");
  });

  it("stops reporting needsRefresh as soon as the session was renewed", async () => {
    const refreshAt = Date.now();
    const token = `session-${crypto.randomUUID()}`;
    await seedSession(token, refreshAt, refreshAt + expiresInMs - updateAgeMs);
    const cookie = await signedSessionCookie(token, secret);

    await expect(
      verifySessionCookieDetails(cookie, secret, db),
    ).resolves.toMatchObject({ needsRefresh: true });
    await refreshAccountSessionCookies(
      `__Secure-better-auth.session_token=${cookie}`,
      "https://getbb.app",
      createAuthFetch("https://getbb.app", "getbb.app"),
    );
    await expect(
      verifySessionCookieDetails(cookie, secret, db),
    ).resolves.toMatchObject({ needsRefresh: false });
  });

  it("leaves a fresh session unchanged before the update-age boundary", async () => {
    const refreshAt = Date.now();
    const token = `session-${crypto.randomUUID()}`;
    const expiresAt = refreshAt + expiresInMs;
    await seedSession(token, refreshAt, expiresAt);
    const cookie = await signedSessionCookie(token, secret);

    await expect(
      refreshAccountSessionCookies(
        `__Secure-better-auth.session_token=${cookie}`,
        "https://getbb.app",
        createAuthFetch("https://getbb.app", "getbb.app"),
      ),
    ).resolves.toBeNull();
    expect(
      (
        await first(
          db
            .select({ expiresAt: session.expiresAt })
            .from(session)
            .where(eq(session.token, token))
            .limit(1),
        )
      )?.expiresAt.getTime(),
    ).toBe(expiresAt);
  });

  it("passes through Better Auth's non-secure local Cloud cookie", async () => {
    const refreshAt = Date.now();
    const token = `session-${crypto.randomUUID()}`;
    await seedSession(token, refreshAt, refreshAt + expiresInMs - updateAgeMs);
    const cookie = await signedSessionCookie(token, secret);

    const setCookies = await refreshAccountSessionCookies(
      `better-auth.session_token=${cookie}`,
      "http://bb.localhost:42745",
      createAuthFetch("http://bb.localhost:42745", "bb.localhost"),
    );
    expect(setCookies).toHaveLength(1);
    expect(setCookies?.[0]).toContain("better-auth.session_token=");
    expect(setCookies?.[0]).toContain("Domain=.bb.localhost");
    expect(setCookies?.[0]).not.toContain("Secure");
  });

  it("preserves multiple Better Auth cookies as separate values", async () => {
    const headers = new Headers();
    headers.append("set-cookie", "session=renewed; Path=/; HttpOnly");
    headers.append("set-cookie", "session-data=cached; Path=/; HttpOnly");

    await expect(
      refreshAccountSessionCookies(
        "session=old",
        "https://getbb.app",
        async () =>
          Response.json(
            { session: { id: "session" }, user: { id: "user" } },
            { headers },
          ),
      ),
    ).resolves.toEqual([
      "session=renewed; Path=/; HttpOnly",
      "session-data=cached; Path=/; HttpOnly",
    ]);
  });
});

function countingDb(target: typeof db): {
  db: typeof db;
  counts: { select: number };
} {
  const counts = { select: 0 };
  const proxied = new Proxy(target, {
    get(t, prop) {
      if (prop === "select") counts.select += 1;
      const value = Reflect.get(t, prop);
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
  return { db: proxied, counts };
}

function failingDb(
  target: typeof db,
  failures: number,
): { db: typeof db; counts: { select: number } } {
  const counts = { select: 0 };
  const proxied = new Proxy(target, {
    get(t, prop) {
      if (prop === "select") {
        counts.select += 1;
        if (counts.select <= failures) {
          throw new Error("Connection terminated unexpectedly");
        }
      }
      const value = Reflect.get(t, prop);
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
  return { db: proxied, counts };
}

function stalledDb(target: typeof db): typeof db {
  const query: object = new Proxy(() => {}, {
    get: (_query, prop) => (prop === "then" ? () => {} : () => query),
  });
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "select") return () => query;
      const value = Reflect.get(t, prop);
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
}

function gatedDb(target: typeof db, gate: Promise<void>): typeof db {
  const wrap = (builder: object): object =>
    new Proxy(builder, {
      get(b, prop) {
        const value = Reflect.get(b, prop);
        if (typeof value !== "function") return value;
        if (prop === "then") {
          return (...args: unknown[]) => gate.then(() => value.apply(b, args));
        }
        return (...args: unknown[]) => {
          const result = value.apply(b, args);
          return typeof result === "object" && result !== null
            ? wrap(result)
            : result;
        };
      },
    });
  return new Proxy(target, {
    get(t, prop) {
      const value = Reflect.get(t, prop);
      if (prop === "select" && typeof value === "function") {
        return (...args: unknown[]) => wrap(value.apply(t, args));
      }
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
}

async function seedSignedSession(
  userId: string,
  secret: string,
  expiresAt = Date.now() + 60_000,
): Promise<string> {
  await seedUser(userId);
  const token = `sess_${crypto.randomUUID()}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  await db.insert(session).values({
    id: `sess-${token}`,
    token,
    expiresAt: new Date(expiresAt),
    userId,
    createdAt: now,
    updatedAt: now,
  });
  return `${token}.${sig}`;
}

describe("gate lookup caches", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function seedLabel(label: string): Promise<void> {
    await seedUser(`acct-${label}`);
    await seedServer({
      id: `srv-${label}`,
      userId: `acct-${label}`,
      name: "default",
      subdomain: label,
    });
  }

  it("runs one database lookup for a burst of concurrent requests", async () => {
    await seedLabel("burst-label");
    const counted = countingDb(db);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated = gatedDb(counted.db, gate);

    const burst = Array.from({ length: 20 }, () =>
      resolveLabel("burst-label", gated),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();

    const resolved = await Promise.all(burst);
    expect(counted.counts.select).toBe(1);
    expect(resolved.every((r) => r?.userId === "acct-burst-label")).toBe(true);
  });

  it("retries a failed lookup once for a whole burst and shares the final failure", async () => {
    await seedLabel("burst-failure");
    vi.useFakeTimers();
    const failing = failingDb(db, Infinity);

    const burst = Array.from({ length: 5 }, () =>
      resolveLabel("burst-failure", failing.db).then(
        () => "resolved",
        (error: Error) => error.message,
      ),
    );
    await vi.advanceTimersByTimeAsync(LOOKUP_RETRY_DELAY_MS);

    expect(await Promise.all(burst)).toEqual(
      Array.from({ length: 5 }, () => "Connection terminated unexpectedly"),
    );
    expect(failing.counts.select).toBe(2);
  });

  it("absorbs a database failure by retrying once before answering", async () => {
    await seedLabel("blip-label");
    vi.useFakeTimers();
    const flaky = failingDb(db, 1);

    const resolved = resolveLabel("blip-label", flaky.db);
    await vi.advanceTimersByTimeAsync(LOOKUP_RETRY_DELAY_MS);

    await expect(resolved).resolves.toMatchObject({
      userId: "acct-blip-label",
    });
    expect(flaky.counts.select).toBe(2);
  });

  it("answers an expired label from its last value when the database fails, without retrying", async () => {
    await seedLabel("fallback-label");
    vi.useFakeTimers();
    await resolveLabel("fallback-label", db);
    vi.setSystemTime(Date.now() + 61_000);
    const failing = failingDb(db, Infinity);

    await expect(
      resolveLabel("fallback-label", failing.db),
    ).resolves.toMatchObject({ userId: "acct-fallback-label" });
    expect(failing.counts.select).toBe(1);
  });

  it("answers an expired label from its last value when the database stalls", async () => {
    await seedLabel("stalled-fallback");
    vi.useFakeTimers();
    await resolveLabel("stalled-fallback", db);
    vi.setSystemTime(Date.now() + 61_000);

    const resolved = resolveLabel("stalled-fallback", stalledDb(db));
    await vi.advanceTimersByTimeAsync(LOOKUP_FALLBACK_AFTER_MS);

    await expect(resolved).resolves.toMatchObject({
      userId: "acct-stalled-fallback",
    });
  });

  it("stops answering from the last value once the fallback window passes", async () => {
    await seedLabel("lapsed-fallback");
    vi.useFakeTimers();
    await resolveLabel("lapsed-fallback", db);
    vi.setSystemTime(Date.now() + 60_000 + LOOKUP_FALLBACK_WINDOW_MS);

    const resolved = resolveLabel(
      "lapsed-fallback",
      failingDb(db, Infinity).db,
    ).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(LOOKUP_RETRY_DELAY_MS);

    expect(await resolved).toBe("Connection terminated unexpectedly");
  });

  it("never answers a fresh read from the last value", async () => {
    await seedLabel("fresh-fallback");
    vi.useFakeTimers();
    await resolveLabel("fresh-fallback", db);

    const resolved = resolveLabel(
      "fresh-fallback",
      failingDb(db, Infinity).db,
      { fresh: true },
    ).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(LOOKUP_RETRY_DELAY_MS);

    expect(await resolved).toBe("Connection terminated unexpectedly");
  });

  it("replaces a lookup that never settles with a single new one", async () => {
    await seedLabel("abandoned-label");
    vi.useFakeTimers();
    void resolveLabel("abandoned-label", stalledDb(db));
    const counted = countingDb(db);
    const waiters = Array.from({ length: 10 }, () =>
      resolveLabel("abandoned-label", counted.db),
    );

    await vi.advanceTimersByTimeAsync(LOOKUP_JOIN_TIMEOUT_MS - 50);
    expect(counted.counts.select).toBe(0);
    await vi.advanceTimersByTimeAsync(50);

    const resolved = await Promise.all(waiters);
    expect(resolved.every((r) => r?.userId === "acct-abandoned-label")).toBe(
      true,
    );
    expect(counted.counts.select).toBe(1);
  });

  it("answers a label whose earlier lookup never settled", async () => {
    await seedUser("acct-stalled-label");
    await seedServer({
      id: "srv-stalled-label",
      userId: "acct-stalled-label",
      name: "default",
      subdomain: "stalled-label",
    });

    vi.useFakeTimers();
    void resolveLabel("stalled-label", stalledDb(db));
    const later = resolveLabel("stalled-label", db);
    await vi.advanceTimersByTimeAsync(LOOKUP_JOIN_TIMEOUT_MS);

    await expect(later).resolves.toMatchObject({
      kind: "server",
      userId: "acct-stalled-label",
    });
  });

  it("verifies a session cookie whose earlier lookup never settled", async () => {
    const secret = "stalled-secret";
    const cookieValue = await seedSignedSession("acct-stalled-cookie", secret);

    vi.useFakeTimers();
    void verifySessionCookieDetails(cookieValue, secret, stalledDb(db));
    const later = verifySessionCookieDetails(cookieValue, secret, db);
    await vi.advanceTimersByTimeAsync(LOOKUP_JOIN_TIMEOUT_MS);

    await expect(later).resolves.toMatchObject({
      userId: "acct-stalled-cookie",
    });
  });

  it("serves later session verifications from the cache", async () => {
    const secret = "cached-secret";
    const cookieValue = await seedSignedSession(
      "acct-cached-cookie",
      secret,
      Date.now() + CONNECT_SESSION_EXPIRES_IN_SECONDS * 1000,
    );
    const counted = countingDb(db);

    await verifySessionCookieDetails(cookieValue, secret, counted.db);
    await verifySessionCookieDetails(cookieValue, secret, counted.db);

    expect(counted.counts.select).toBe(1);
  });

  it("rereads a cached session that is due for a refresh", async () => {
    const secret = "due-secret";
    const cookieValue = await seedSignedSession("acct-due-cookie", secret);
    const counted = countingDb(db);

    await verifySessionCookieDetails(cookieValue, secret, counted.db);
    expect(counted.counts.select).toBe(1);
    await verifySessionCookieDetails(cookieValue, secret, counted.db);
    expect(counted.counts.select).toBe(2);
  });

  it("does not cache a lookup that was in flight when its cookie was invalidated", async () => {
    const secret = "invalidated-secret";
    const cookieValue = await seedSignedSession(
      "acct-invalidated-cookie",
      secret,
    );
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const inFlight = verifySessionCookieDetails(
      cookieValue,
      secret,
      gatedDb(db, gate),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    invalidateSessionCookie(cookieValue);
    release();
    await inFlight;
    const counted = countingDb(db);
    await verifySessionCookieDetails(cookieValue, secret, counted.db);

    expect(counted.counts.select).toBe(1);
  });

  it("fails closed for an expired session when the database fails", async () => {
    const secret = "fail-closed-secret";
    const cookieValue = await seedSignedSession(
      "acct-fail-closed",
      secret,
      Date.now() + CONNECT_SESSION_EXPIRES_IN_SECONDS * 1000,
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    await verifySessionCookieDetails(cookieValue, secret, db);
    vi.setSystemTime(Date.now() + 61_000);

    await expect(
      verifySessionCookieDetails(
        cookieValue,
        secret,
        failingDb(db, Infinity).db,
      ),
    ).rejects.toThrow("Connection terminated");
  });

  it("does not cache a lookup that failed its retry", async () => {
    await seedLabel("flight-retry");
    vi.useFakeTimers();
    const flaky = failingDb(db, 2);

    const first = resolveLabel("flight-retry", flaky.db).catch(
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(LOOKUP_RETRY_DELAY_MS);

    expect(await first).toBe("Connection terminated unexpectedly");
    await expect(resolveLabel("flight-retry", flaky.db)).resolves.toMatchObject(
      { kind: "server", userId: "acct-flight-retry" },
    );
  });
});

describe("machine credential presence", () => {
  it("verifies the owning machine and throttles lastSeenAt writes", async () => {
    const presence = { machineId: "machine-presence", lastSeenAt: null };
    await seedUser("acct-machine");
    const credential = `bbcm_${crypto.randomUUID()}`;
    const credentialHash = await sha256Hex(credential);
    await db.insert(machine).values({
      id: "machine-presence",
      userId: "acct-machine",
      credentialHash,
      createdAt: new Date(0),
    });

    await expect(
      verifyMachineCredentialDetails(credential, db),
    ).resolves.toEqual({
      machineId: "machine-presence",
      userId: "acct-machine",
      lastSeenAt: null,
    });
    expect(await markMachineSeen(presence, db, 10_000)).toBe(true);
    expect(
      (
        await first(
          db
            .select()
            .from(machine)
            .where(eq(machine.id, "machine-presence"))
            .limit(1),
        )
      )?.lastSeenAt?.getTime(),
    ).toBe(10_000);

    expect(
      await markMachineSeen(
        presence,
        db,
        10_000 + MACHINE_LAST_SEEN_WRITE_INTERVAL_MS - 1,
      ),
    ).toBe(false);
    expect(
      (
        await first(
          db
            .select()
            .from(machine)
            .where(eq(machine.id, "machine-presence"))
            .limit(1),
        )
      )?.lastSeenAt?.getTime(),
    ).toBe(10_000);

    expect(
      await markMachineSeen(
        presence,
        db,
        10_000 + MACHINE_LAST_SEEN_WRITE_INTERVAL_MS,
      ),
    ).toBe(true);
  });
});

describe("machine last-seen writes", () => {
  it("skips the write while the stored lastSeenAt is recent", async () => {
    await seedUser("acct-recent");
    await db.insert(machine).values({
      id: "machine-recent",
      userId: "acct-recent",
      credentialHash: "recent-hash",
      lastSeenAt: new Date(50_000),
      createdAt: new Date(0),
    });
    const verified = {
      machineId: "machine-recent",
      lastSeenAt: new Date(50_000),
    };

    expect(
      await markMachineSeen(
        verified,
        db,
        50_000 + MACHINE_LAST_SEEN_WRITE_INTERVAL_MS - 1,
      ),
    ).toBe(false);
    expect(
      await markMachineSeen(
        verified,
        db,
        50_000 + MACHINE_LAST_SEEN_WRITE_INTERVAL_MS,
      ),
    ).toBe(true);
  });
});

describe("machine credential cache", () => {
  async function seedMachine(id: string): Promise<string> {
    await seedUser(`acct-${id}`);
    const credential = `bbcm_${crypto.randomUUID()}`;
    await db.insert(machine).values({
      id,
      userId: `acct-${id}`,
      credentialHash: await sha256Hex(credential),
      createdAt: new Date(0),
    });
    return credential;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers repeat daemon requests from the cache", async () => {
    const credential = await seedMachine("machine-repeat");
    const counted = countingDb(db);

    await verifyMachineCredentialDetails(credential, counted.db);
    const verified = await verifyMachineCredentialDetails(
      credential,
      counted.db,
    );

    expect(counted.counts.select).toBe(1);
    expect(verified).toEqual({
      machineId: "machine-repeat",
      userId: "acct-machine-repeat",
      lastSeenAt: null,
    });
  });

  it("verifies a credential whose earlier lookup never settled", async () => {
    const credential = await seedMachine("machine-stalled");

    void verifyMachineCredentialDetails(credential, stalledDb(db));

    await expect(
      verifyMachineCredentialDetails(credential, db),
    ).resolves.toEqual({
      machineId: "machine-stalled",
      userId: "acct-machine-stalled",
      lastSeenAt: null,
    });
  });

  it("caches an unknown credential so retries do not reach the database", async () => {
    const counted = countingDb(db);
    const unknown = `bbcm_${crypto.randomUUID()}`;

    expect(await verifyMachineCredentialDetails(unknown, counted.db)).toBe(
      null,
    );
    expect(await verifyMachineCredentialDetails(unknown, counted.db)).toBe(
      null,
    );
    expect(counted.counts.select).toBe(1);
  });

  it("stops honoring a revoked credential once its entry expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const credential = await seedMachine("machine-revoked");
    expect(await verifyMachineCredentialDetails(credential, db)).toEqual({
      machineId: "machine-revoked",
      userId: "acct-machine-revoked",
      lastSeenAt: null,
    });

    await db
      .update(machine)
      .set({ revokedAt: new Date() })
      .where(eq(machine.id, "machine-revoked"));
    vi.setSystemTime(1_000_000 + 59_999);
    expect(await verifyMachineCredentialDetails(credential, db)).not.toBe(null);

    vi.setSystemTime(1_000_000 + 60_000);
    expect(await verifyMachineCredentialDetails(credential, db)).toBe(null);
  });

  it("fails closed for an expired credential when the database fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const credential = await seedMachine("machine-fail-closed");
    await verifyMachineCredentialDetails(credential, db);
    vi.setSystemTime(1_000_000 + 60_000);

    await expect(
      verifyMachineCredentialDetails(credential, failingDb(db, Infinity).db),
    ).rejects.toThrow("Connection terminated");
  });

  it("retries a failed database lookup once before answering", async () => {
    const credential = await seedMachine("machine-flaky");
    const flaky = failingDb(db, 1);

    await expect(
      verifyMachineCredentialDetails(credential, flaky.db),
    ).resolves.toEqual({
      machineId: "machine-flaky",
      userId: "acct-machine-flaky",
      lastSeenAt: null,
    });
    expect(flaky.counts.select).toBe(2);
  });
});
