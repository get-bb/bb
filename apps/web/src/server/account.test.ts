import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_CODE_TTL_MS,
  MAX_PER_ACCOUNT,
  connectCode,
  resolveServerCredential,
  schema,
  server,
  sha256Hex,
  user,
  verifyTunnelTicket,
} from "@bb/connect-db";
import {
  connectDbMigrationFiles,
  readConnectDbMigration,
} from "@bb/connect-db/testing";
import {
  LINK_POLL_INTERVAL_MS,
  approveServerLink,
  denyServerLink,
  getAccountMe,
  getLinkRequestView,
  issueTunnelTicket,
  pollServerLink,
  startServerLink,
  suggestHandle,
  suggestServerLabel,
} from "./account.js";
import { type Deps, claimHandle, redeemConnectCode } from "./api.js";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
let closeTunnel: ReturnType<typeof vi.fn<(label: string) => Promise<void>>>;
let deps: Deps;
const T0 = Date.UTC(2026, 8, 22, 12);

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of connectDbMigrationFiles()) {
    sqlite.exec(readConnectDbMigration(file));
  }
  db = drizzle(sqlite, { schema });
  closeTunnel = vi.fn<(label: string) => Promise<void>>(async () => {});
  deps = {
    db,
    appUrl: "https://getbb.app",
    serverUrlTemplate: "https://{label}.getbb.app",
    closeTunnel,
  };
});

afterEach(() => {
  sqlite.close();
});

function seedUser(
  id: string,
  over: { githubLogin?: string; image?: string } = {},
): void {
  const now = new Date();
  db.insert(user)
    .values({
      id,
      name: `Name ${id}`,
      email: `${id}@example.com`,
      emailVerified: true,
      image: over.image ?? null,
      githubLogin: over.githubLogin ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

async function start(now = T0) {
  const started = await startServerLink(deps, "sawyer-mbp", now);
  if (started.status !== 200) throw new Error("link start failed");
  return started.body;
}

function primaryServerId(userId: string): string {
  const row = db
    .select({ id: server.id })
    .from(server)
    .where(eq(server.userId, userId))
    .get();
  if (!row) throw new Error("no server");
  return row.id;
}

describe("startServerLink", () => {
  it("issues a device code and a user code stored as an unowned server-link row", async () => {
    const started = await start();
    expect(started.deviceCode).toMatch(/^bbdev_[a-z0-9]{32}$/u);
    expect(started.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u);
    expect(started.verificationUrl).toBe(
      `https://getbb.app/link?code=${started.userCode}`,
    );
    expect(started.expiresAt).toBe(T0 + CONNECT_CODE_TTL_MS);
    expect(started.intervalMs).toBe(LINK_POLL_INTERVAL_MS);

    const row = db
      .select()
      .from(connectCode)
      .where(eq(connectCode.code, started.userCode))
      .get();
    expect(row).toMatchObject({
      purpose: "server-link",
      userId: null,
      serverId: null,
      clientName: "sawyer-mbp",
      deviceCodeHash: await sha256Hex(started.deviceCode),
    });
  });

  it("rejects missing or oversized client names", async () => {
    expect(await startServerLink(deps, "", T0)).toEqual({
      status: 400,
      body: { error: "invalid-client-name" },
    });
    expect(await startServerLink(deps, 42, T0)).toEqual({
      status: 400,
      body: { error: "invalid-client-name" },
    });
    expect(await startServerLink(deps, "x".repeat(101), T0)).toEqual({
      status: 400,
      body: { error: "invalid-client-name" },
    });
    expect((await startServerLink(deps, "x".repeat(100), T0)).status).toBe(200);
  });
});

describe("link flow", () => {
  it("goes pending, approved once with a new server, then already-used", async () => {
    seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const started = await start();

    expect(await pollServerLink(deps, started.deviceCode, T0)).toEqual({
      status: 200,
      body: { status: "pending" },
    });

    const view = await getLinkRequestView(
      deps,
      "u1",
      started.userCode.toLowerCase(),
      MAX_PER_ACCOUNT,
      T0,
    );
    expect(view).toMatchObject({
      state: "choose-server",
      handle: "sawyer",
      suggestedLabel: "sawyer-sawyer-mbp",
      request: { userCode: started.userCode, clientName: "sawyer-mbp" },
    });

    expect(
      await approveServerLink(
        deps,
        "u1",
        started.userCode,
        { kind: "new", label: "sawyer-laptop" },
        T0 + 1_000,
      ),
    ).toEqual({ ok: true, serverUrl: "https://sawyer-laptop.getbb.app" });

    const approved = await pollServerLink(
      deps,
      started.deviceCode,
      T0 + LINK_POLL_INTERVAL_MS,
    );
    if (approved.status !== 200 || approved.body.status !== "approved") {
      throw new Error(`expected approval, got ${JSON.stringify(approved)}`);
    }
    expect(approved.body).toMatchObject({
      handle: "sawyer-laptop",
      serverUrl: "https://sawyer-laptop.getbb.app",
      tunnelUrl: "wss://sawyer-laptop.getbb.app/__tunnel",
    });
    expect(approved.body.credential).toMatch(/^bbcred_/u);
    const resolved = await resolveServerCredential(
      db,
      approved.body.credential,
    );
    expect(resolved?.server.id).toBe(approved.body.serverId);
    expect(resolved?.server.subdomain).toBe("sawyer-laptop");
    expect(resolved?.userId).toBe("u1");
    expect(closeTunnel).not.toHaveBeenCalled();

    expect(
      await pollServerLink(
        deps,
        started.deviceCode,
        T0 + 2 * LINK_POLL_INTERVAL_MS,
      ),
    ).toEqual({ status: 409, body: { error: "already-used" } });
    expect(
      await getLinkRequestView(
        deps,
        "u1",
        started.userCode,
        MAX_PER_ACCOUNT,
        T0,
      ),
    ).toEqual({
      state: "approved",
      serverUrl: "https://sawyer-laptop.getbb.app",
    });
  });

  it("replaces an existing server's credential and closes its tunnel", async () => {
    seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const primary = primaryServerId("u1");
    db.update(server)
      .set({ credentialHash: await sha256Hex("bbcred_old") })
      .where(eq(server.id, primary))
      .run();
    const started = await start();

    expect(
      await approveServerLink(
        deps,
        "u1",
        started.userCode,
        { kind: "existing", serverId: primary },
        T0,
      ),
    ).toEqual({ ok: true, serverUrl: "https://sawyer.getbb.app" });
    expect(await resolveServerCredential(db, "bbcred_old")).not.toBeNull();

    const approved = await pollServerLink(deps, started.deviceCode, T0);
    if (approved.status !== 200 || approved.body.status !== "approved") {
      throw new Error("expected approval");
    }
    expect(approved.body.serverId).toBe(primary);
    expect(approved.body.handle).toBe("sawyer");
    expect(await resolveServerCredential(db, "bbcred_old")).toBeNull();
    expect(
      (await resolveServerCredential(db, approved.body.credential))?.server.id,
    ).toBe(primary);
    expect(closeTunnel).toHaveBeenCalledWith("sawyer");
  });

  it("lets a user without a handle claim one before approving", async () => {
    seedUser("u1", { githubLogin: "Sawyer-Hood" });
    const started = await start();

    expect(
      await getLinkRequestView(
        deps,
        "u1",
        started.userCode,
        MAX_PER_ACCOUNT,
        T0,
      ),
    ).toMatchObject({
      state: "claim-handle",
      suggestedHandle: "sawyer-hood",
      serverUrlTemplate: "https://{label}.getbb.app",
    });
    expect(
      await approveServerLink(
        deps,
        "u1",
        started.userCode,
        { kind: "new", label: "sawyer-laptop" },
        T0,
      ),
    ).toEqual({ error: "no-handle" });

    await claimHandle(deps, "u1", "sawyer-hood");
    const view = await getLinkRequestView(
      deps,
      "u1",
      started.userCode,
      MAX_PER_ACCOUNT,
      T0,
    );
    if (view.state !== "choose-server") throw new Error("expected choice");
    expect(view.servers).toHaveLength(1);
    expect(view.servers[0]).toMatchObject({
      subdomain: "sawyer-hood",
      isPrimary: true,
      connected: false,
    });

    expect(
      await approveServerLink(
        deps,
        "u1",
        started.userCode,
        { kind: "existing", serverId: view.servers[0].id },
        T0,
      ),
    ).toEqual({ ok: true, serverUrl: "https://sawyer-hood.getbb.app" });
    const approved = await pollServerLink(deps, started.deviceCode, T0);
    expect(approved).toMatchObject({
      status: 200,
      body: { status: "approved", handle: "sawyer-hood" },
    });
    expect(closeTunnel).not.toHaveBeenCalled();
  });

  it("refuses a second approval, including from a different account", async () => {
    seedUser("u1");
    seedUser("u2");
    await claimHandle(deps, "u1", "sawyer");
    await claimHandle(deps, "u2", "mallory");
    const started = await start();

    expect(
      await approveServerLink(
        deps,
        "u1",
        started.userCode,
        { kind: "existing", serverId: primaryServerId("u1") },
        T0,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await approveServerLink(
        deps,
        "u2",
        started.userCode,
        { kind: "existing", serverId: primaryServerId("u2") },
        T0,
      ),
    ).toEqual({ error: "used" });
    expect(
      await getLinkRequestView(
        deps,
        "u2",
        started.userCode,
        MAX_PER_ACCOUNT,
        T0,
      ),
    ).toEqual({ state: "used" });
    expect(
      await approveServerLink(
        deps,
        "u2",
        started.userCode,
        { kind: "new", label: "mallory-steal" },
        T0,
      ),
    ).toEqual({ error: "used" });
    expect(
      db
        .select()
        .from(server)
        .where(eq(server.subdomain, "mallory-steal"))
        .get(),
    ).toBeUndefined();
  });

  it("does not let an account approve onto another account's server", async () => {
    seedUser("u1");
    seedUser("u2");
    await claimHandle(deps, "u1", "sawyer");
    await claimHandle(deps, "u2", "mallory");
    const started = await start();
    expect(
      await approveServerLink(
        deps,
        "u2",
        started.userCode,
        { kind: "existing", serverId: primaryServerId("u1") },
        T0,
      ),
    ).toEqual({ error: "not-found" });
    expect(await pollServerLink(deps, started.deviceCode, T0)).toEqual({
      status: 200,
      body: { status: "pending" },
    });
  });

  it("expires after ten minutes for polling and approval", async () => {
    seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const started = await start();
    const expired = T0 + CONNECT_CODE_TTL_MS;

    expect(
      await getLinkRequestView(
        deps,
        "u1",
        started.userCode,
        MAX_PER_ACCOUNT,
        expired,
      ),
    ).toEqual({ state: "expired" });
    expect(
      await approveServerLink(
        deps,
        "u1",
        started.userCode,
        { kind: "existing", serverId: primaryServerId("u1") },
        expired,
      ),
    ).toEqual({ error: "expired" });
    expect(await pollServerLink(deps, started.deviceCode, expired)).toEqual({
      status: 410,
      body: { error: "expired" },
    });
  });

  it("reports denial to the polling bb", async () => {
    seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const started = await start();

    expect(await denyServerLink(deps, started.userCode, T0)).toEqual({
      ok: true,
    });
    expect(await pollServerLink(deps, started.deviceCode, T0)).toEqual({
      status: 403,
      body: { error: "denied" },
    });
    expect(await denyServerLink(deps, started.userCode, T0)).toEqual({
      error: "denied",
    });
    expect(
      await approveServerLink(
        deps,
        "u1",
        started.userCode,
        { kind: "existing", serverId: primaryServerId("u1") },
        T0,
      ),
    ).toEqual({ error: "denied" });
    expect(
      await getLinkRequestView(
        deps,
        "u1",
        started.userCode,
        MAX_PER_ACCOUNT,
        T0,
      ),
    ).toEqual({ state: "denied" });
  });

  it("answers slow-down when polled faster than the interval", async () => {
    const started = await start();
    expect((await pollServerLink(deps, started.deviceCode, T0)).status).toBe(
      200,
    );
    expect(await pollServerLink(deps, started.deviceCode, T0 + 500)).toEqual({
      status: 429,
      body: { error: "slow-down" },
    });
    expect(
      await pollServerLink(
        deps,
        started.deviceCode,
        T0 + LINK_POLL_INTERVAL_MS - 1,
      ),
    ).toEqual({ status: 429, body: { error: "slow-down" } });
    expect(
      (
        await pollServerLink(
          deps,
          started.deviceCode,
          T0 + LINK_POLL_INTERVAL_MS,
        )
      ).status,
    ).toBe(200);
  });

  it("rejects unknown device codes", async () => {
    expect(await pollServerLink(deps, "bbdev_unknown", T0)).toEqual({
      status: 404,
      body: { error: "invalid-code" },
    });
    expect(await pollServerLink(deps, undefined, T0)).toEqual({
      status: 404,
      body: { error: "invalid-code" },
    });
    expect(
      await getLinkRequestView(deps, "u1", "ZZZZ-ZZZZ", MAX_PER_ACCOUNT, T0),
    ).toEqual({ state: "invalid" });
  });

  it("never redeems an approved link code through the pairing endpoint", async () => {
    seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const started = await start(Date.now());
    await approveServerLink(deps, "u1", started.userCode, {
      kind: "existing",
      serverId: primaryServerId("u1"),
    });
    expect(await redeemConnectCode(deps, started.userCode)).toEqual({
      error: "invalid-code",
      status: 404,
    });
  });
});

describe("label suggestions", () => {
  it("derives valid labels from GitHub logins and hostnames", () => {
    expect(suggestHandle("Sawyer-Hood")).toBe("sawyer-hood");
    expect(suggestHandle("ab")).toBe("");
    expect(suggestHandle("admin")).toBe("");
    expect(suggestHandle(null)).toBe("");
    expect(suggestServerLabel("sawyer", "Sawyer's MacBook Pro.local")).toBe(
      "sawyer-sawyer-s-macbook-pro-lo",
    );
    expect(suggestServerLabel("sawyer", "!!!")).toBe("sawyer-bb");
  });
});

describe("getAccountMe", () => {
  it("returns the account and server for a live credential", async () => {
    seedUser("u1", { githubLogin: "sawyerhood", image: "https://img/a.png" });
    await claimHandle(deps, "u1", "sawyer");
    const primary = primaryServerId("u1");
    db.update(server)
      .set({ credentialHash: await sha256Hex("bbcred_live") })
      .where(eq(server.id, primary))
      .run();

    expect(await getAccountMe(deps, "bbcred_live")).toEqual({
      status: 200,
      body: {
        userId: "u1",
        githubLogin: "sawyerhood",
        name: "Name u1",
        avatarUrl: "https://img/a.png",
        handle: "sawyer",
        serverId: primary,
        serverLabel: "sawyer",
        serverUrl: "https://sawyer.getbb.app",
        tunnelUrl: "wss://sawyer.getbb.app/__tunnel",
      },
    });
  });

  it("rejects revoked and unknown credentials", async () => {
    seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    db.update(server)
      .set({
        credentialHash: await sha256Hex("bbcred_revoked"),
        revokedAt: new Date(),
      })
      .where(eq(server.id, primaryServerId("u1")))
      .run();
    expect(await getAccountMe(deps, "bbcred_revoked")).toEqual({
      status: 401,
      body: { error: "unauthorized" },
    });
    expect(await getAccountMe(deps, "")).toEqual({
      status: 401,
      body: { error: "unauthorized" },
    });
  });
});

describe("issueTunnelTicket", () => {
  it("mints a five-minute ticket bound to the credential's server", async () => {
    seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const primary = primaryServerId("u1");
    db.update(server)
      .set({ credentialHash: await sha256Hex("bbcred_live") })
      .where(eq(server.id, primary))
      .run();

    const issued = await issueTunnelTicket(deps, "bbcred_live", "secret", T0);
    if (issued.status !== 200) throw new Error("expected a ticket");
    expect(issued.body.tunnelUrl).toBe("wss://sawyer.getbb.app/__tunnel");
    expect(issued.body.expiresAt).toBe(T0 + 5 * 60 * 1000);
    expect(issued.body.ticket).toMatch(/^bbtkt_[\w-]+\.[\w-]+$/u);
    expect(await verifyTunnelTicket(issued.body.ticket, "secret", T0)).toEqual({
      sid: primary,
      exp: issued.body.expiresAt,
    });
    expect(await issueTunnelTicket(deps, "bbcred_nope", "secret", T0)).toEqual({
      status: 401,
      body: { error: "unauthorized" },
    });
  });
});
