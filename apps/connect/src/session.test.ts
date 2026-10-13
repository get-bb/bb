import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_SESSION_EXPIRES_IN_SECONDS,
  CONNECT_SESSION_UPDATE_AGE_SECONDS,
  labelClaim,
  machine,
  profile,
  schema,
  server,
  session,
  sha256Hex,
  user,
} from "@bb/connect-db";

import {
  invalidateSessionCookie,
  MACHINE_LAST_SEEN_WRITE_INTERVAL_MS,
  markMachineSeen,
  resolveLabel,
  verifyMachineCredentialDetails,
  verifySessionCookieDetails,
} from "./session.js";
import { refreshAccountSessionCookies } from "./account-session.js";
import { assignMachineLabel } from "./machine-label.js";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../packages/connect-db/migrations", import.meta.url),
);

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!file.endsWith(".sql")) continue;
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
});

const now = new Date();

function seedUser(id: string): void {
  db.insert(user)
    .values({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function seedServer(over: {
  id: string;
  userId: string;
  name: string;
  subdomain: string;
  credentialHash?: string | null;
  revokedAt?: Date | null;
  lastSeenAt?: Date | null;
}): void {
  db.insert(server)
    .values({
      id: over.id,
      userId: over.userId,
      name: over.name,
      subdomain: over.subdomain,
      credentialHash: "credentialHash" in over ? over.credentialHash : "hash",
      revokedAt: over.revokedAt ?? null,
      lastSeenAt: over.lastSeenAt ?? null,
      createdAt: now,
    })
    .run();
}

function seedMachine(over: {
  id: string;
  userId: string;
  subdomain: string | null;
  credentialHash?: string;
  revokedAt?: Date | null;
  lastSeenAt?: Date | null;
}): void {
  db.insert(machine)
    .values({
      id: over.id,
      userId: over.userId,
      subdomain: over.subdomain,
      credentialHash: over.credentialHash ?? "machine-hash",
      revokedAt: over.revokedAt ?? null,
      lastSeenAt: over.lastSeenAt ?? null,
      createdAt: now,
    })
    .run();
  if (over.subdomain !== null) {
    db.update(labelClaim)
      .set({ generation: `${over.id}-generation` })
      .where(eq(labelClaim.label, over.subdomain))
      .run();
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
    seedUser("acct-a");
    db.insert(profile)
      .values({ userId: "acct-a", handle: "sawyer", createdAt: now })
      .run();
    const seen = new Date(now.getTime() - 60_000);
    seedServer({
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
    seedUser("acct-a");
    db.insert(profile)
      .values({ userId: "acct-a", handle: "sawyer", createdAt: now })
      .run();
    seedServer({
      id: "srv-primary",
      userId: "acct-a",
      name: "default",
      subdomain: "sawyer",
    });
    seedServer({
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
    seedUser("acct-a");
    seedUser("acct-b");
    seedServer({
      id: "srv-a",
      userId: "acct-a",
      name: "default",
      subdomain: "sawyer",
    });
    seedServer({
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
    seedUser("acct-a");
    seedServer({
      id: "srv-a",
      userId: "acct-a",
      name: "default",
      subdomain: "sawyer",
    });
    expect(await resolveLabel("nobody", db, { fresh: true })).toBeNull();
  });

  it("routes a server row atomically claimed by the migration trigger", async () => {
    seedUser("acct-a");
    db.insert(profile)
      .values({ userId: "acct-a", handle: "sawyer", createdAt: now })
      .run();
    db.insert(server)
      .values({
        id: "legacy-server",
        userId: "acct-a",
        name: "desktop",
        subdomain: "legacy-desktop",
        credentialHash: "hash",
        createdAt: now,
      })
      .run();

    await expect(
      resolveLabel("legacy-desktop", db, { fresh: true }),
    ).resolves.toMatchObject({
      kind: "server",
      server: { id: "legacy-server" },
    });
    expect(
      db
        .select()
        .from(labelClaim)
        .where(eq(labelClaim.label, "legacy-desktop"))
        .get(),
    ).toMatchObject({
      kind: "server",
      ownerId: "legacy-server",
      generation: expect.stringMatching(/^[a-f0-9]{32}$/u),
    });
  });

  it("fresh resolution sees an immediately assigned label after a cached negative", async () => {
    seedUser("acct-a");
    db.insert(profile)
      .values({ userId: "acct-a", handle: "sawyer", createdAt: now })
      .run();
    seedMachine({
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
    seedUser("acct-a");
    seedServer({
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
    seedUser("acct-a");
    db.insert(profile)
      .values({ userId: "acct-a", handle: "sawyer", createdAt: now })
      .run();
    const seen = new Date(now.getTime() - 30_000);
    seedMachine({
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
    seedUser("acct-a");
    db.insert(profile)
      .values({ userId: "acct-a", handle: "sawyer", createdAt: now })
      .run();
    seedServer({
      id: "srv-collision",
      userId: "acct-a",
      name: "default",
      subdomain: "collision",
    });
    seedMachine({
      id: "machine-collision",
      userId: "acct-a",
      subdomain: null,
    });
    expect(() =>
      db
        .update(machine)
        .set({ subdomain: "collision" })
        .where(eq(machine.id, "machine-collision"))
        .run(),
    ).toThrow(/unique constraint/iu);

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

  function seedSession(
    token: string,
    refreshAt: number,
    expiresAt: number,
  ): void {
    seedUser(`user-${token}`);
    db.insert(session)
      .values({
        id: `id-${token}`,
        token,
        expiresAt: new Date(expiresAt),
        userId: `user-${token}`,
        createdAt: new Date(refreshAt - updateAgeMs),
        updatedAt: new Date(refreshAt - updateAgeMs),
      })
      .run();
  }

  function createAuthFetch(baseURL: string, baseDomain: string) {
    const auth = betterAuth({
      secret,
      baseURL,
      database: drizzleAdapter(db, {
        provider: "sqlite",
        schema: { session, user },
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
    seedSession(freshToken, checkedAt, checkedAt + expiresInMs);
    seedSession(
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
    seedSession(token, refreshAt, oldExpiresAt);
    const cookie = await signedSessionCookie(token, secret);
    const beforeRefresh = Date.now();

    const setCookies = await refreshAccountSessionCookies(
      `__Secure-better-auth.session_token=${cookie}`,
      "https://getbb.app",
      createAuthFetch("https://getbb.app", "getbb.app"),
    );
    const afterRefresh = Date.now();
    const refreshed = db
      .select()
      .from(session)
      .where(eq(session.token, token))
      .get();
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

  it("leaves a fresh session unchanged before the update-age boundary", async () => {
    const refreshAt = Date.now();
    const token = `session-${crypto.randomUUID()}`;
    const expiresAt = refreshAt + expiresInMs;
    seedSession(token, refreshAt, expiresAt);
    const cookie = await signedSessionCookie(token, secret);

    await expect(
      refreshAccountSessionCookies(
        `__Secure-better-auth.session_token=${cookie}`,
        "https://getbb.app",
        createAuthFetch("https://getbb.app", "getbb.app"),
      ),
    ).resolves.toBeNull();
    expect(
      db
        .select({ expiresAt: session.expiresAt })
        .from(session)
        .where(eq(session.token, token))
        .get()
        ?.expiresAt.getTime(),
    ).toBe(expiresAt);
  });

  it("passes through Better Auth's non-secure local Cloud cookie", async () => {
    const refreshAt = Date.now();
    const token = `session-${crypto.randomUUID()}`;
    seedSession(token, refreshAt, refreshAt + expiresInMs - updateAgeMs);
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

function stalledDb(target: typeof db): typeof db {
  const query: object = new Proxy(() => {}, {
    get: (_query, prop) =>
      prop === "then"
        ? undefined
        : prop === "get"
          ? () => new Promise(() => {})
          : () => query,
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
        if (prop === "get") {
          return async (...args: unknown[]) => {
            await gate;
            return value.apply(b, args);
          };
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
): Promise<string> {
  seedUser(userId);
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
  db.insert(session)
    .values({
      id: `sess-${token}`,
      token,
      expiresAt: new Date(Date.now() + 60_000),
      userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return `${token}.${sig}`;
}

describe("gate lookup caches", () => {
  it("answers a label whose earlier lookup never settled", async () => {
    seedUser("acct-stalled-label");
    seedServer({
      id: "srv-stalled-label",
      userId: "acct-stalled-label",
      name: "default",
      subdomain: "stalled-label",
    });

    void resolveLabel("stalled-label", stalledDb(db));

    await expect(resolveLabel("stalled-label", db)).resolves.toMatchObject({
      kind: "server",
      userId: "acct-stalled-label",
    });
  });

  it("verifies a session cookie whose earlier lookup never settled", async () => {
    const secret = "stalled-secret";
    const cookieValue = await seedSignedSession("acct-stalled-cookie", secret);

    void verifySessionCookieDetails(cookieValue, secret, stalledDb(db));

    await expect(
      verifySessionCookieDetails(cookieValue, secret, db),
    ).resolves.toMatchObject({ userId: "acct-stalled-cookie" });
  });

  it("serves later session verifications from the cache", async () => {
    const secret = "cached-secret";
    const cookieValue = await seedSignedSession("acct-cached-cookie", secret);
    const counted = countingDb(db);

    await verifySessionCookieDetails(cookieValue, secret, counted.db);
    await verifySessionCookieDetails(cookieValue, secret, counted.db);

    expect(counted.counts.select).toBe(1);
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

  it("does not cache a failed lookup: the next request retries D1", async () => {
    seedUser("acct-flight-retry");
    seedServer({
      id: "srv-flight-retry",
      userId: "acct-flight-retry",
      name: "default",
      subdomain: "flight-retry",
    });
    let failNext = true;
    const failingOnce = new Proxy(db, {
      get(t, prop) {
        if (prop === "select" && failNext) {
          failNext = false;
          throw new Error("d1 hiccup");
        }
        const value = Reflect.get(t, prop);
        return typeof value === "function" ? value.bind(t) : value;
      },
    });

    await expect(resolveLabel("flight-retry", failingOnce)).rejects.toThrow(
      "d1 hiccup",
    );
    await expect(
      resolveLabel("flight-retry", failingOnce),
    ).resolves.toMatchObject({ kind: "server", userId: "acct-flight-retry" });
  });
});

describe("machine credential presence", () => {
  it("verifies the owning machine and throttles lastSeenAt writes", async () => {
    seedUser("acct-machine");
    const credential = `bbcm_${crypto.randomUUID()}`;
    const credentialHash = await sha256Hex(credential);
    db.insert(machine)
      .values({
        id: "machine-presence",
        userId: "acct-machine",
        credentialHash,
        createdAt: new Date(0),
      })
      .run();

    await expect(
      verifyMachineCredentialDetails(credential, db),
    ).resolves.toEqual({
      machineId: "machine-presence",
      userId: "acct-machine",
    });
    expect(await markMachineSeen("machine-presence", db, 10_000)).toBe(true);
    expect(
      db
        .select()
        .from(machine)
        .where(eq(machine.id, "machine-presence"))
        .get()
        ?.lastSeenAt?.getTime(),
    ).toBe(10_000);

    expect(
      await markMachineSeen(
        "machine-presence",
        db,
        10_000 + MACHINE_LAST_SEEN_WRITE_INTERVAL_MS - 1,
      ),
    ).toBe(false);
    expect(
      db
        .select()
        .from(machine)
        .where(eq(machine.id, "machine-presence"))
        .get()
        ?.lastSeenAt?.getTime(),
    ).toBe(10_000);

    expect(
      await markMachineSeen(
        "machine-presence",
        db,
        10_000 + MACHINE_LAST_SEEN_WRITE_INTERVAL_MS,
      ),
    ).toBe(true);
  });
});

describe("machine credential cache", () => {
  async function seedMachine(id: string): Promise<string> {
    seedUser(`acct-${id}`);
    const credential = `bbcm_${crypto.randomUUID()}`;
    db.insert(machine)
      .values({
        id,
        userId: `acct-${id}`,
        credentialHash: await sha256Hex(credential),
        createdAt: new Date(0),
      })
      .run();
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
    });
  });

  it("caches an unknown credential so retries do not reach D1", async () => {
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
    });

    db.update(machine)
      .set({ revokedAt: new Date() })
      .where(eq(machine.id, "machine-revoked"))
      .run();
    vi.setSystemTime(1_000_000 + 19_999);
    expect(await verifyMachineCredentialDetails(credential, db)).not.toBe(null);

    vi.setSystemTime(1_000_000 + 20_000);
    expect(await verifyMachineCredentialDetails(credential, db)).toBe(null);
  });

  it("does not cache a failed D1 lookup", async () => {
    const credential = await seedMachine("machine-flaky");
    let failNext = true;
    const flaky = new Proxy(db, {
      get(target, prop) {
        if (prop === "select" && failNext) {
          failNext = false;
          throw new Error("D1_ERROR: D1 DB is overloaded.");
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      verifyMachineCredentialDetails(credential, flaky),
    ).rejects.toThrow("overloaded");
    expect(await verifyMachineCredentialDetails(credential, flaky)).toEqual({
      machineId: "machine-flaky",
      userId: "acct-machine-flaky",
    });
  });
});
