import { eq, isNull } from "drizzle-orm";
import {
  type TestConnectDb,
  createTestConnectDb,
} from "@bb/connect-db-pg/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditLog,
  connectCode,
  labelClaim,
  machine,
  MAX_PER_ACCOUNT,
  NEXT_TUNNEL_STALE_MS,
  type ConnectDb,
  server,
  sha256Hex,
  user,
  first,
} from "@bb/connect-db";
import {
  ACCOUNT_DELETE_AUDIT_ACTION,
  type Deps,
  checkAvailability,
  claimHandle,
  createConnectCode,
  createMachineCodeForServerCredential,
  lookupMachineCodeForServerCredential,
  createServer,
  deleteAccount,
  disconnectServer,
  removeServer,
  getAccountState,
  redeemConnectCode,
  redeemMachineCode,
  resolveServerUrlTemplate,
  revokeMachineForServerCredential,
  revokeMachine,
  revokeUnusedDevices,
} from "./api.js";

let database: TestConnectDb;
let db: ConnectDb;
let closeTunnel: ReturnType<typeof vi.fn<(subdomain: string) => Promise<void>>>;
let deps: Deps;

beforeEach(async () => {
  database = await createTestConnectDb();
  db = database.db;
  closeTunnel = vi.fn<(subdomain: string) => Promise<void>>(async () => {});
  deps = {
    db,
    appUrl: "https://getbb.app",
    serverUrlTemplate: "https://{label}.getbb.app",
    closeTunnel,
    tunnelConnected: null,
  };
});

describe("resolveServerUrlTemplate", () => {
  it("accepts the local HTTP port without changing production defaults", () => {
    expect(resolveServerUrlTemplate(undefined, "getbb.app")).toBe(
      "https://{label}.getbb.app",
    );
    expect(
      resolveServerUrlTemplate(
        "http://{label}.bb.localhost:8787",
        "bb.localhost",
      ),
    ).toBe("http://{label}.bb.localhost:8787");
    expect(() =>
      resolveServerUrlTemplate("https://example.com/{label}", "example.com"),
    ).toThrow("under BASE_DOMAIN");
    expect(() =>
      resolveServerUrlTemplate("https://{label}.attacker.example", "getbb.app"),
    ).toThrow("under BASE_DOMAIN");
  });
});

afterEach(async () => {
  await database.close();
});

async function seedUser(id: string, githubLogin?: string): Promise<void> {
  const now = new Date();
  await db.insert(user).values({
    id,
    name: "Test",
    email: `${id}@example.com`,
    emailVerified: true,
    githubLogin: githubLogin ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("claimHandle", () => {
  it("creates the profile and the primary server (subdomain = handle)", async () => {
    await seedUser("u1");
    const r = await claimHandle(deps, "u1", "Sawyer");
    expect(r).toEqual({ ok: true, handle: "sawyer" });

    const rows = await db.select().from(server).where(eq(server.userId, "u1"));
    expect(rows).toHaveLength(1);
    expect(rows[0].subdomain).toBe("sawyer");
    expect(rows[0].name).toBe("default");
  });

  it("rejects reserved, malformed, and already-taken labels", async () => {
    await seedUser("u1");
    await seedUser("u2");
    expect(await claimHandle(deps, "u1", "admin")).toEqual({
      error: "reserved",
    });
    expect(await claimHandle(deps, "u1", "foo--bar")).toEqual({
      error: "invalid-format",
    });
    expect(await claimHandle(deps, "u1", "ab")).toEqual({ error: "too-short" });

    await claimHandle(deps, "u1", "sawyer");
    expect(await claimHandle(deps, "u2", "sawyer")).toEqual({ error: "taken" });
  });

  it("refuses a second claim for the same account", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    expect(await claimHandle(deps, "u1", "sawyer2")).toEqual({
      error: "already-claimed",
    });
  });
});

describe("checkAvailability", () => {
  it("reports free, invalid, and taken labels distinctly", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    expect(await checkAvailability(deps, "sawyer-desktop")).toEqual({
      available: true,
      label: "sawyer-desktop",
    });
    expect(await checkAvailability(deps, "admin")).toEqual({
      available: false,
      reason: "invalid",
      error: "reserved",
    });
    expect(await checkAvailability(deps, "sawyer")).toEqual({
      available: false,
      reason: "taken",
      namespace: "handle",
    });
  });
});

describe("createServer (connect another bb)", () => {
  it("claims a new label and holds it as an offline row", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const r = await createServer(deps, "u1", "sawyer-desktop");
    expect("ok" in r && r.ok).toBe(true);
    if ("ok" in r) {
      expect(r.server.subdomain).toBe("sawyer-desktop");
      expect(r.server.isPrimary).toBe(false);
      expect(r.server.connected).toBe(false);
      expect(r.server.serverUrl).toBe("https://sawyer-desktop.getbb.app");
    }
  });

  it("enforces the per-account server cap", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const createdAt = new Date();
    await db.insert(server).values(
      Array.from({ length: MAX_PER_ACCOUNT - 2 }, (_, index) => ({
        id: `seeded-${index + 1}`,
        userId: "u1",
        name: `sawyer-${index + 1}`,
        subdomain: `sawyer-${index + 1}`,
        createdAt,
      })),
    );
    expect(
      "ok" in (await createServer(deps, "u1", `sawyer-${MAX_PER_ACCOUNT - 1}`)),
    ).toBe(true);
    expect(
      await db.select().from(server).where(eq(server.userId, "u1")),
    ).toHaveLength(MAX_PER_ACCOUNT);
    expect(await createServer(deps, "u1", "sawyer-over")).toEqual({
      error: "server-limit",
    });
  });

  it("rejects a label already taken by another server", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    await createServer(deps, "u1", "sawyer-desktop");
    expect(await createServer(deps, "u1", "sawyer-desktop")).toEqual({
      error: "taken",
    });
  });
});

describe("createConnectCode (per-server minting + reuse)", () => {
  async function primaryId(userId: string): Promise<string> {
    const rows = await db
      .select()
      .from(server)
      .where(eq(server.userId, userId));
    return rows[0].id;
  }

  it("mints a server-pair code bound to the requested server", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const desktop = await createServer(deps, "u1", "sawyer-desktop");
    if (!("ok" in desktop)) throw new Error("setup");

    const r = await createConnectCode(deps, "u1", {
      serverId: desktop.server.id,
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.serverUrl).toBe("https://sawyer-desktop.getbb.app");
    expect(r.serverId).toBe(desktop.server.id);

    const row = await first(
      db
        .select()
        .from(connectCode)
        .where(eq(connectCode.code, r.code))
        .limit(1),
    );
    expect(row?.serverId).toBe(desktop.server.id);
    expect(row?.purpose).toBe("server-pair");
  });

  it("reuses an unexpired code instead of re-minting when reuse=true", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const id = await primaryId("u1");

    const first = await createConnectCode(deps, "u1", {
      serverId: id,
      reuse: true,
    });
    const second = await createConnectCode(deps, "u1", {
      serverId: id,
      reuse: true,
    });
    if ("error" in first || "error" in second) throw new Error("mint failed");
    expect(second.code).toBe(first.code);
    expect(await db.select().from(connectCode)).toHaveLength(1);
  });

  it("mints a fresh code when reuse is not requested", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const id = await primaryId("u1");
    const first = await createConnectCode(deps, "u1", { serverId: id });
    const second = await createConnectCode(deps, "u1", { serverId: id });
    if ("error" in first || "error" in second) throw new Error("mint failed");
    expect(second.code).not.toBe(first.code);
    expect(await db.select().from(connectCode)).toHaveLength(2);
  });
});

describe("redeemConnectCode (multi-server routing label)", () => {
  it("returns the redeemed server's subdomain, not the account handle", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const desktop = await createServer(deps, "u1", "sawyer-desktop");
    if (!("ok" in desktop)) throw new Error("setup");

    const primary = await first(
      db.select().from(server).where(eq(server.subdomain, "sawyer")).limit(1),
    );
    expect(primary?.credentialHash).toBeNull();

    const minted = await createConnectCode(deps, "u1", {
      serverId: desktop.server.id,
    });
    if ("error" in minted) throw new Error(minted.error);

    const result = await redeemConnectCode(deps, minted.code);
    if ("error" in result)
      throw new Error(`${result.error} (${result.status})`);

    expect(result.handle).toBe("sawyer-desktop");
    expect(result.serverId).toBe(desktop.server.id);
    expect(result.tunnelUrl).toBe("wss://sawyer-desktop.getbb.app/__tunnel");
    expect(result.credential.startsWith("bbcred_")).toBe(true);

    const second = await first(
      db.select().from(server).where(eq(server.id, desktop.server.id)).limit(1),
    );
    expect(second?.credentialHash).toBe(await sha256Hex(result.credential));
    expect(second?.revokedAt).toBeNull();

    const primaryAfter = await first(
      db.select().from(server).where(eq(server.subdomain, "sawyer")).limit(1),
    );
    expect(primaryAfter?.credentialHash).toBeNull();
  });

  it("returns the primary handle when redeeming a primary-server code", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const primary = await first(
      db.select().from(server).where(eq(server.subdomain, "sawyer")).limit(1),
    );
    const minted = await createConnectCode(deps, "u1", {
      serverId: primary!.id,
    });
    if ("error" in minted) throw new Error(minted.error);

    const result = await redeemConnectCode(deps, minted.code);
    if ("error" in result)
      throw new Error(`${result.error} (${result.status})`);

    expect(result.handle).toBe("sawyer");
    expect(result.tunnelUrl).toBe("wss://sawyer.getbb.app/__tunnel");
  });

  it("returns a ws tunnel URL for local Cloud", async () => {
    deps.serverUrlTemplate = "http://{label}.bb.localhost:42745";
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const primary = await first(
      db.select().from(server).where(eq(server.subdomain, "sawyer")).limit(1),
    );
    const minted = await createConnectCode(deps, "u1", {
      serverId: primary!.id,
    });
    if ("error" in minted) throw new Error(minted.error);

    const result = await redeemConnectCode(deps, minted.code);
    if ("error" in result) throw new Error(result.error);
    expect(result.tunnelUrl).toBe("ws://sawyer.bb.localhost:42745/__tunnel");
  });
});

describe("disconnectServer (server-scoped)", () => {
  it("clears only the target server's credential and closes only its tunnel", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const desktop = await createServer(deps, "u1", "sawyer-desktop");
    if (!("ok" in desktop)) throw new Error("setup");

    await db.update(server).set({ credentialHash: "hash", revokedAt: null });

    const r = await disconnectServer(deps, "u1", desktop.server.id);
    expect(r).toEqual({ ok: true });
    expect(closeTunnel).toHaveBeenCalledTimes(1);
    expect(closeTunnel).toHaveBeenCalledWith("sawyer-desktop");

    const target = await first(
      db.select().from(server).where(eq(server.id, desktop.server.id)).limit(1),
    );
    expect(target?.credentialHash).toBeNull();
    expect(target?.revokedAt).not.toBeNull();

    const primary = await first(
      db.select().from(server).where(eq(server.subdomain, "sawyer")).limit(1),
    );
    expect(primary?.credentialHash).toBe("hash");
    expect(primary?.revokedAt).toBeNull();
  });

  it("refuses a server the caller does not own", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await claimHandle(deps, "u1", "sawyer");
    await claimHandle(deps, "u2", "other");
    const victim = await first(
      db.select().from(server).where(eq(server.subdomain, "other")).limit(1),
    );
    expect(await disconnectServer(deps, "u1", victim!.id)).toEqual({
      error: "not-found",
    });
    expect(closeTunnel).not.toHaveBeenCalled();
  });
});

describe("removeServer (delete a never-paired row)", () => {
  it("deletes a never-paired secondary and frees its subdomain for re-claim", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const desktop = await createServer(deps, "u1", "sawyer-desktop");
    if (!("ok" in desktop)) throw new Error("setup");

    expect(await removeServer(deps, "u1", desktop.server.id)).toEqual({
      ok: true,
    });
    expect(
      await first(
        db
          .select()
          .from(server)
          .where(eq(server.id, desktop.server.id))
          .limit(1),
      ),
    ).toBeUndefined();

    const avail = await checkAvailability(deps, "sawyer-desktop");
    expect(avail.available).toBe(true);

    expect(
      await first(
        db.select().from(server).where(eq(server.subdomain, "sawyer")).limit(1),
      ),
    ).toBeDefined();
  });

  it("refuses to remove the primary (account handle) row", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const primary = await first(
      db.select().from(server).where(eq(server.subdomain, "sawyer")).limit(1),
    );
    expect(await removeServer(deps, "u1", primary!.id)).toEqual({
      error: "is-primary",
    });
    expect(
      await first(
        db.select().from(server).where(eq(server.id, primary!.id)).limit(1),
      ),
    ).toBeDefined();
  });

  it("refuses to remove a still-connected secondary (disconnect first)", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const desktop = await createServer(deps, "u1", "sawyer-desktop");
    if (!("ok" in desktop)) throw new Error("setup");
    await db
      .update(server)
      .set({ credentialHash: "hash", revokedAt: null })
      .where(eq(server.id, desktop.server.id));

    expect(await removeServer(deps, "u1", desktop.server.id)).toEqual({
      error: "connected",
    });
    expect(
      await first(
        db
          .select()
          .from(server)
          .where(eq(server.id, desktop.server.id))
          .limit(1),
      ),
    ).toBeDefined();
  });

  it("refuses a server the caller does not own", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await claimHandle(deps, "u1", "sawyer");
    await claimHandle(deps, "u2", "other");
    const victim = await first(
      db.select().from(server).where(eq(server.subdomain, "other")).limit(1),
    );
    expect(await removeServer(deps, "u1", victim!.id)).toEqual({
      error: "not-found",
    });
  });
});

describe("getAccountState (adaptive single / multi)", () => {
  it("returns an empty account before a handle is claimed", async () => {
    await seedUser("u1", "sawyerhood");
    const state = await getAccountState(deps, "u1");
    expect(state.handle).toBeNull();
    expect(state.servers).toHaveLength(0);
    expect(state.githubLogin).toBe("sawyerhood");
    expect(state.maxServers).toBe(MAX_PER_ACCOUNT);
  });

  it("returns one server, flagged primary, after a claim", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const state = await getAccountState(deps, "u1");
    expect(state.servers).toHaveLength(1);
    expect(state.servers[0]).toMatchObject({
      subdomain: "sawyer",
      isPrimary: true,
      connected: false,
      online: false,
      serverUrl: "https://sawyer.getbb.app",
    });
  });

  it("lists multiple servers with the primary first", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    await createServer(deps, "u1", "sawyer-desktop");
    await createServer(deps, "u1", "sawyer-studio");

    const state = await getAccountState(deps, "u1");
    expect(state.servers.map((s) => s.subdomain)).toEqual([
      "sawyer",
      "sawyer-desktop",
      "sawyer-studio",
    ]);
    expect(state.servers[0].isPrimary).toBe(true);
    expect(state.servers.slice(1).every((s) => !s.isPrimary)).toBe(true);
  });

  it("marks a server online only when credentialed and freshly seen", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    await db
      .update(server)
      .set({ credentialHash: "hash", revokedAt: null, lastSeenAt: new Date() });
    const online = (await getAccountState(deps, "u1")).servers[0];
    expect(online.connected).toBe(true);
    expect(online.online).toBe(true);

    await db
      .update(server)
      .set({ lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) });
    const stale = (await getAccountState(deps, "u1")).servers[0];
    expect(stale.connected).toBe(true);
    expect(stale.online).toBe(false);
  });
});

describe("getAccountState with tunnel objects as the liveness source", () => {
  it("reports servers and labelled machines online from their tunnel objects, not from last_seen_at", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    await createServer(deps, "u1", "sawyer-desktop");
    await createServer(deps, "u1", "sawyer-unpaired");
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    const fresh = new Date();
    await db
      .update(server)
      .set({ credentialHash: "hash", revokedAt: null, lastSeenAt: stale })
      .where(eq(server.subdomain, "sawyer"));
    await db
      .update(server)
      .set({ credentialHash: "hash-2", revokedAt: null, lastSeenAt: fresh })
      .where(eq(server.subdomain, "sawyer-desktop"));
    await db.insert(machine).values([
      {
        id: "machine-tunnel",
        userId: "u1",
        subdomain: "air",
        credentialHash: "hash-air",
        lastSeenAt: stale,
        createdAt: new Date(1),
      },
      {
        id: "machine-requests",
        userId: "u1",
        credentialHash: "hash-requests",
        lastSeenAt: fresh,
        createdAt: new Date(2),
      },
      {
        id: "machine-gone",
        userId: "u1",
        subdomain: "gone",
        credentialHash: "hash-gone",
        lastSeenAt: stale,
        createdAt: new Date(3),
      },
    ]);
    const machineRoutingKeys = Object.fromEntries(
      (
        await db.select().from(labelClaim).where(eq(labelClaim.kind, "machine"))
      ).map((claim) => [claim.label, `${claim.label}:${claim.generation}`]),
    );
    const airKey = machineRoutingKeys.air;
    const goneKey = machineRoutingKeys.gone;
    if (airKey === undefined || goneKey === undefined) {
      throw new Error("expected label claims for both labelled machines");
    }
    const asked: string[] = [];
    const answers: Record<string, boolean> = {
      sawyer: true,
      "sawyer-desktop": false,
      [airKey]: true,
      [goneKey]: false,
    };

    const state = await getAccountState(
      {
        ...deps,
        tunnelConnected: async (routingKey) => {
          asked.push(routingKey);
          return answers[routingKey] ?? null;
        },
      },
      "u1",
    );

    expect(
      Object.fromEntries(state.servers.map((s) => [s.subdomain, s.online])),
    ).toEqual({
      sawyer: true,
      "sawyer-desktop": false,
      "sawyer-unpaired": false,
    });
    expect(
      Object.fromEntries(state.machines.map((m) => [m.id, m.online])),
    ).toEqual({
      "machine-tunnel": true,
      "machine-requests": true,
      "machine-gone": false,
    });
    expect(asked.sort()).toEqual(
      [airKey, goneKey, "sawyer", "sawyer-desktop"].sort(),
    );
  });
});

describe("getAccountState with a bb connect next tunnel", () => {
  it("shows servers and machines online while next holds a fresh tunnel, whatever the tunnel object says", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    await createServer(deps, "u1", "sawyer-next");
    await createServer(deps, "u1", "sawyer-stale");
    await createServer(deps, "u1", "sawyer-revoked");
    const now = Date.now();
    const stale = new Date(now - 60 * 60 * 1000);
    const nextRows = {
      sawyer: { nextTunnelGate: null, nextTunnelAt: new Date(now) },
      "sawyer-next": { nextTunnelGate: "fly-a", nextTunnelAt: new Date(now) },
      "sawyer-stale": {
        nextTunnelGate: "fly-a",
        nextTunnelAt: new Date(now - NEXT_TUNNEL_STALE_MS),
      },
      "sawyer-revoked": {
        nextTunnelGate: "fly-a",
        nextTunnelAt: new Date(now),
      },
    } as const;
    for (const [subdomain, next] of Object.entries(nextRows)) {
      await db
        .update(server)
        .set({
          credentialHash: `hash-${subdomain}`,
          revokedAt: subdomain === "sawyer-revoked" ? new Date(now) : null,
          lastSeenAt: stale,
          nextTunnelGate: next.nextTunnelGate,
          nextTunnelRegion: next.nextTunnelGate === null ? null : "iad",
          nextTunnelAt: next.nextTunnelAt,
        })
        .where(eq(server.subdomain, subdomain));
    }
    await db.insert(machine).values([
      {
        id: "machine-next",
        userId: "u1",
        subdomain: "air",
        credentialHash: "hash-air",
        lastSeenAt: stale,
        nextTunnelGate: "fly-b",
        nextTunnelRegion: "ams",
        nextTunnelAt: new Date(now),
        createdAt: new Date(1),
      },
      {
        id: "machine-off",
        userId: "u1",
        subdomain: "off",
        credentialHash: "hash-off",
        lastSeenAt: stale,
        createdAt: new Date(2),
      },
    ]);

    const state = await getAccountState(
      { ...deps, tunnelConnected: async () => false },
      "u1",
    );

    expect(
      Object.fromEntries(state.servers.map((s) => [s.subdomain, s.online])),
    ).toEqual({
      sawyer: false,
      "sawyer-next": true,
      "sawyer-stale": false,
      "sawyer-revoked": false,
    });
    expect(
      Object.fromEntries(state.machines.map((m) => [m.id, m.online])),
    ).toEqual({ "machine-next": true, "machine-off": false });
  });
});

describe("pairing code purposes", () => {
  it("refuses a machine code at the server redeem endpoint and leaves it usable for the machine", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    const pair = await createConnectCode(deps, "u1", {});
    if ("error" in pair) throw new Error(pair.error);
    const paired = await redeemConnectCode(deps, pair.code);
    if ("error" in paired) throw new Error(paired.error);

    const machineCode = await createMachineCodeForServerCredential(
      deps,
      paired.credential,
    );
    if ("status" in machineCode) throw new Error(machineCode.error);

    expect(await redeemConnectCode(deps, machineCode.code)).toEqual({
      error: "invalid-code",
      status: 404,
    });
    const row = await first(
      db.select().from(server).where(eq(server.subdomain, "sawyer")).limit(1),
    );
    expect(row?.credentialHash).toBe(await sha256Hex(paired.credential));

    const redeemed = await redeemMachineCode(deps, machineCode.code, {
      name: null,
      kind: null,
    });
    expect("error" in redeemed).toBe(false);
  });
});

describe("server-authenticated machine-code round trip", () => {
  it.each(["Pixel 9 Pro", null])(
    "mints for the exact server and redeems a device named %s",
    async (deviceName) => {
      await seedUser("u1");
      await claimHandle(deps, "u1", "sawyer");
      const target = await createServer(deps, "u1", "sawyer-desktop");
      if (!("ok" in target)) throw new Error("server setup failed");
      const serverCredential = "bbcred_server_owned";
      await db
        .update(server)
        .set({
          credentialHash: await sha256Hex(serverCredential),
          revokedAt: null,
        })
        .where(eq(server.id, target.server.id));

      const minted = await createMachineCodeForServerCredential(
        deps,
        serverCredential,
      );
      if ("status" in minted) throw new Error(minted.error);
      expect(minted.serverUrl).toBe("https://sawyer-desktop.getbb.app");

      expect(
        await lookupMachineCodeForServerCredential(
          deps,
          serverCredential,
          minted.code,
        ),
      ).toEqual({ consumed: false, machineId: null });
      const redeemed = await redeemMachineCode(deps, minted.code, {
        name: deviceName,
        kind: "mobile",
      });
      if ("error" in redeemed) throw new Error(redeemed.error);
      expect(
        await lookupMachineCodeForServerCredential(
          deps,
          serverCredential,
          minted.code,
        ),
      ).toEqual({ consumed: true, machineId: redeemed.machineId });
      expect(
        await lookupMachineCodeForServerCredential(deps, "bogus", minted.code),
      ).toMatchObject({ status: 401 });
      const other = await createServer(deps, "u1", "sawyer-other");
      if (!("ok" in other)) throw new Error("server setup failed");
      await db
        .update(server)
        .set({ credentialHash: await sha256Hex("bbcred_other") })
        .where(eq(server.id, other.server.id));
      expect(
        await lookupMachineCodeForServerCredential(
          deps,
          "bbcred_other",
          minted.code,
        ),
      ).toMatchObject({ status: 404 });
      expect(redeemed.credential.startsWith("bbcm_")).toBe(true);
      expect(redeemed.serverUrl).toBe("https://sawyer-desktop.getbb.app");
      expect(await db.select().from(machine)).toHaveLength(1);
      expect((await getAccountState(deps, "u1")).machines).toEqual([
        expect.objectContaining({
          id: redeemed.machineId,
          name: deviceName,
          kind: "mobile",
          unused: false,
        }),
      ]);
      await expect(
        revokeMachineForServerCredential(
          deps,
          serverCredential,
          redeemed.machineId,
        ),
      ).resolves.toEqual({ ok: true });
      expect(
        (
          await first(
            db
              .select()
              .from(machine)
              .where(eq(machine.id, redeemed.machineId))
              .limit(1),
          )
        )?.revokedAt,
      ).not.toBeNull();
      const revokedAt = (await first(db.select().from(machine).limit(1)))
        ?.revokedAt;
      for (const token of [serverCredential, "bbcred_other"]) {
        await expect(
          revokeMachineForServerCredential(deps, token, redeemed.machineId),
        ).resolves.toEqual({ ok: true });
      }
      expect(
        (await first(db.select().from(machine).limit(1)))?.revokedAt,
      ).toEqual(revokedAt);
      await expect(
        revokeMachineForServerCredential(deps, serverCredential, "missing"),
      ).resolves.toEqual({ error: "not-found", status: 404 });
      await seedUser("foreign");
      await db.insert(machine).values({
        id: "foreign-device",
        userId: "foreign",
        credentialHash: "foreign-hash",
        createdAt: new Date(),
        revokedAt: new Date(),
      });
      await expect(
        revokeMachineForServerCredential(
          deps,
          serverCredential,
          "foreign-device",
        ),
      ).resolves.toEqual({ error: "not-found", status: 404 });
      for (const token of ["", "bogus"]) {
        await expect(
          revokeMachineForServerCredential(deps, token, redeemed.machineId),
        ).resolves.toEqual({ error: "unauthorized", status: 401 });
      }
      await db
        .update(server)
        .set({ revokedAt: new Date() })
        .where(eq(server.id, target.server.id));
      await expect(
        revokeMachineForServerCredential(
          deps,
          serverCredential,
          redeemed.machineId,
        ),
      ).resolves.toEqual({ error: "unauthorized", status: 401 });
      await expect(
        redeemMachineCode(deps, minted.code, { name: null, kind: null }),
      ).resolves.toMatchObject({
        error: "already-used",
        status: 409,
      });
    },
  );

  it("rejects a bogus server credential", async () => {
    await seedUser("u1");
    await claimHandle(deps, "u1", "sawyer");
    await expect(
      createMachineCodeForServerCredential(deps, "bbcred_bogus"),
    ).resolves.toEqual({ error: "unauthorized", status: 401 });
  });
});

describe("dashboard machine recovery", () => {
  it("lists active machines and revokes only the owner's selected credential", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const now = new Date();
    await db.insert(machine).values([
      {
        id: "machine-owner",
        userId: "u1",
        name: "lost laptop",
        subdomain: "lost-laptop",
        credentialHash: "hash-owner",
        lastSeenAt: now,
        createdAt: now,
      },
      {
        id: "machine-other",
        userId: "u2",
        credentialHash: "hash-other",
        createdAt: now,
      },
    ]);
    await db
      .update(labelClaim)
      .set({ generation: "lost-generation" })
      .where(eq(labelClaim.label, "lost-laptop"));

    expect((await getAccountState(deps, "u1")).machines).toEqual([
      {
        id: "machine-owner",
        name: "lost laptop",
        kind: null,
        subdomain: "lost-laptop",
        online: true,
        lastSeenAt: now.getTime(),
        unused: false,
        createdAt: now.getTime(),
      },
    ]);
    await expect(revokeMachine(deps, "u1", "machine-other")).resolves.toEqual({
      error: "not-found",
    });
    await expect(revokeMachine(deps, "u1", "machine-owner")).resolves.toEqual({
      ok: true,
    });
    expect(closeTunnel).toHaveBeenCalledWith("lost-laptop:lost-generation");
    expect(closeTunnel).toHaveBeenCalledTimes(1);
    expect((await getAccountState(deps, "u1")).machines).toEqual([]);
    await expect(revokeMachine(deps, "u1", "machine-owner")).resolves.toEqual({
      ok: true,
    });
    expect(closeTunnel).toHaveBeenCalledTimes(1);
    expect(
      (
        await first(
          db
            .select()
            .from(machine)
            .where(eq(machine.id, "machine-owner"))
            .limit(1),
        )
      )?.subdomain,
    ).toBeNull();
    expect(
      (
        await first(
          db
            .select()
            .from(machine)
            .where(eq(machine.id, "machine-other"))
            .limit(1),
        )
      )?.revokedAt,
    ).toBeNull();
  });

  it("marks a machine online only when freshly seen, offline when stale", async () => {
    await seedUser("u1");
    const now = new Date();
    const stale = new Date(now.getTime() - 10 * 60_000);
    await db.insert(machine).values([
      {
        id: "machine-fresh",
        userId: "u1",
        subdomain: "fresh-machine",
        credentialHash: "hash-fresh",
        lastSeenAt: now,
        createdAt: new Date(now.getTime() - 2000),
      },
      {
        id: "machine-stale",
        userId: "u1",
        subdomain: "stale-machine",
        credentialHash: "hash-stale",
        lastSeenAt: stale,
        createdAt: new Date(now.getTime() - 1000),
      },
      {
        id: "machine-unlabeled",
        userId: "u1",
        credentialHash: "hash-unlabeled",
        createdAt: now,
      },
    ]);

    const machines = (await getAccountState(deps, "u1")).machines;
    expect(machines.map((m) => [m.id, m.subdomain, m.online])).toEqual([
      ["machine-fresh", "fresh-machine", true],
      ["machine-stale", "stale-machine", false],
      ["machine-unlabeled", null, false],
    ]);
  });

  it("keeps a revoked label pinned when tunnel close fails", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const now = new Date();
    await db.insert(machine).values([
      {
        id: "machine-a",
        userId: "u1",
        subdomain: "shared-machine",
        credentialHash: "hash-a",
        createdAt: now,
      },
      {
        id: "machine-b",
        userId: "u2",
        credentialHash: "hash-b",
        createdAt: now,
      },
    ]);
    await db
      .update(labelClaim)
      .set({ generation: "generation-a" })
      .where(eq(labelClaim.label, "shared-machine"));
    closeTunnel.mockRejectedValueOnce(new Error("close unavailable"));

    await expect(revokeMachine(deps, "u1", "machine-a")).resolves.toEqual({
      error: "tunnel-close-failed",
    });
    expect(
      (
        await first(
          db.select().from(machine).where(eq(machine.id, "machine-a")).limit(1),
        )
      )?.subdomain,
    ).toBe("shared-machine");
    await expect(
      db
        .update(machine)
        .set({ subdomain: "shared-machine" })
        .where(eq(machine.id, "machine-b")),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/unique constraint/iu) },
    });
  });

  it("retries a failed machine close during the reachable account-state sweep", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const now = new Date();
    await db.insert(machine).values([
      {
        id: "machine-retry",
        userId: "u1",
        subdomain: "retry-machine",
        credentialHash: "hash-a",
        createdAt: now,
      },
      {
        id: "machine-new",
        userId: "u2",
        credentialHash: "hash-b",
        createdAt: now,
      },
    ]);
    await db
      .update(labelClaim)
      .set({ generation: "generation-a" })
      .where(eq(labelClaim.label, "retry-machine"));
    closeTunnel.mockRejectedValueOnce(new Error("close unavailable"));

    await expect(revokeMachine(deps, "u1", "machine-retry")).resolves.toEqual({
      error: "tunnel-close-failed",
    });
    expect(closeTunnel).toHaveBeenCalledTimes(1);
    await getAccountState(deps, "u1");
    expect(closeTunnel).toHaveBeenCalledTimes(2);
    expect(
      await first(
        db
          .select()
          .from(labelClaim)
          .where(eq(labelClaim.label, "retry-machine"))
          .limit(1),
      ),
    ).toBeUndefined();
    await db
      .update(machine)
      .set({ subdomain: "retry-machine" })
      .where(eq(machine.id, "machine-new"));
  });

  it("does not release a label until delayed close confirms, then gives the new owner a new generation", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const now = new Date();
    await db.insert(machine).values([
      {
        id: "machine-a",
        userId: "u1",
        subdomain: "shared-machine",
        credentialHash: "hash-a",
        createdAt: now,
      },
      {
        id: "machine-b",
        userId: "u2",
        credentialHash: "hash-b",
        createdAt: now,
      },
    ]);
    await db
      .update(labelClaim)
      .set({ generation: "generation-a" })
      .where(eq(labelClaim.label, "shared-machine"));
    let confirmClose: (() => void) | undefined;
    closeTunnel.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          confirmClose = resolve;
        }),
    );

    const revocation = revokeMachine(deps, "u1", "machine-a");
    await vi.waitFor(() => expect(closeTunnel).toHaveBeenCalledTimes(1));
    await expect(
      db
        .update(machine)
        .set({ subdomain: "shared-machine" })
        .where(eq(machine.id, "machine-b")),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/unique constraint/iu) },
    });

    confirmClose?.();
    await expect(revocation).resolves.toEqual({ ok: true });
    await db
      .update(machine)
      .set({ subdomain: "shared-machine" })
      .where(eq(machine.id, "machine-b"));
    expect(await first(db.select().from(labelClaim).limit(1))).toMatchObject({
      ownerId: "machine-b",
      generation: expect.stringMatching(/^[a-f0-9]{32}$/u),
    });
  });
});

describe("device cleanup", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function seedMachines(now: number) {
    await seedUser("u1");
    await db.insert(machine).values([
      {
        id: "abandoned-phone",
        userId: "u1",
        kind: "mobile",
        credentialHash: "h1",
        createdAt: new Date(now - 20 * DAY),
      },
      {
        id: "legacy-never-seen",
        userId: "u1",
        credentialHash: "h2",
        createdAt: new Date(now - 20 * DAY),
      },
      {
        id: "idle-desktop",
        userId: "u1",
        kind: "desktop",
        credentialHash: "h3",
        lastSeenAt: new Date(now - 20 * DAY),
        createdAt: new Date(now - 40 * DAY),
      },
      {
        id: "recent-phone",
        userId: "u1",
        kind: "mobile",
        credentialHash: "h4",
        lastSeenAt: new Date(now - DAY),
        createdAt: new Date(now - 40 * DAY),
      },
      {
        id: "fresh-pairing",
        userId: "u1",
        kind: "mobile",
        credentialHash: "h5",
        createdAt: new Date(now - DAY),
      },
    ]);
  }

  async function activeIds(): Promise<string[]> {
    return (
      await db
        .select({ id: machine.id })
        .from(machine)
        .where(isNull(machine.revokedAt))
    )
      .map((row) => row.id)
      .sort();
  }

  it("auto-revokes only current-client pairings never used in 14 days", async () => {
    await seedMachines(Date.now());

    const machines = (await getAccountState(deps, "u1")).machines;

    expect(Object.fromEntries(machines.map((m) => [m.id, m.unused]))).toEqual({
      "idle-desktop": true,
      "legacy-never-seen": true,
      "recent-phone": false,
      "fresh-pairing": false,
    });
    expect(await activeIds()).toEqual([
      "fresh-pairing",
      "idle-desktop",
      "legacy-never-seen",
      "recent-phone",
    ]);
  });

  it("removes every unused device on request and keeps the rest", async () => {
    await seedMachines(Date.now());

    await expect(revokeUnusedDevices(deps, "u1")).resolves.toEqual({
      ok: true,
      revoked: 3,
    });
    expect(await activeIds()).toEqual(["fresh-pairing", "recent-phone"]);
  });

  it("never marks a device with a live tunnel unused", async () => {
    await seedUser("u1");
    await db.insert(machine).values({
      id: "tunnelled-host",
      userId: "u1",
      kind: "host",
      subdomain: "build-box",
      credentialHash: "h1",
      lastSeenAt: new Date(Date.now() - 30 * DAY),
      createdAt: new Date(Date.now() - 60 * DAY),
    });
    const live = { ...deps, tunnelConnected: async () => true };

    expect((await getAccountState(live, "u1")).machines).toEqual([
      expect.objectContaining({
        id: "tunnelled-host",
        online: true,
        unused: false,
      }),
    ]);
    await expect(revokeUnusedDevices(live, "u1")).resolves.toEqual({
      ok: true,
      revoked: 0,
    });
  });
});

describe("deleteAccount", () => {
  async function seedAccount() {
    await seedUser("u1", "sawyer-gh");
    await seedUser("u2");
    await claimHandle(deps, "u1", "sawyer");
    await claimHandle(deps, "u2", "other");
    const desktop = await createServer(deps, "u1", "sawyer-desktop");
    if (!("ok" in desktop)) throw new Error("setup");
    await db
      .update(server)
      .set({ credentialHash: "server-hash", revokedAt: null })
      .where(eq(server.id, desktop.server.id));
    await db.insert(machine).values({
      id: "host",
      userId: "u1",
      kind: "host",
      subdomain: "sawyer-box",
      credentialHash: "machine-hash",
      createdAt: new Date(),
    });
    await db
      .update(labelClaim)
      .set({ generation: "box-generation" })
      .where(eq(labelClaim.label, "sawyer-box"));
  }

  it("refuses when the typed handle does not match", async () => {
    await seedAccount();

    await expect(deleteAccount(deps, "u1", "sawyre")).resolves.toEqual({
      error: "handle-mismatch",
    });
    expect(
      await first(db.select().from(user).where(eq(user.id, "u1")).limit(1)),
    ).toBeDefined();
    expect(closeTunnel).not.toHaveBeenCalled();
  });

  it("refuses an account that has no handle to confirm with", async () => {
    await seedUser("u1", "sawyer-gh");

    await expect(deleteAccount(deps, "u1", "")).resolves.toEqual({
      error: "no-handle",
    });
    expect(
      await first(db.select().from(user).where(eq(user.id, "u1")).limit(1)),
    ).toBeDefined();
  });

  it("deletes the account, frees its addresses, and closes its tunnels", async () => {
    await seedAccount();

    await expect(deleteAccount(deps, "u1", " Sawyer ")).resolves.toEqual({
      ok: true,
    });

    expect(
      await first(db.select().from(user).where(eq(user.id, "u1")).limit(1)),
    ).toBeUndefined();
    expect(
      await db.select().from(server).where(eq(server.userId, "u1")),
    ).toEqual([]);
    expect(
      await db.select().from(machine).where(eq(machine.userId, "u1")),
    ).toEqual([]);
    for (const label of ["sawyer", "sawyer-desktop", "sawyer-box"]) {
      expect((await checkAvailability(deps, label)).available).toBe(true);
    }
    expect((await checkAvailability(deps, "other")).available).toBe(false);
    expect(closeTunnel.mock.calls.map(([key]) => key).sort()).toEqual([
      "sawyer",
      "sawyer-box:box-generation",
      "sawyer-desktop",
    ]);
    expect(
      await db
        .select({ userId: auditLog.userId, action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.action, ACCOUNT_DELETE_AUDIT_ACTION)),
    ).toEqual([{ userId: null, action: ACCOUNT_DELETE_AUDIT_ACTION }]);
  });
});
