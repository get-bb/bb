import { eq } from "drizzle-orm";
import {
  type TestConnectDb,
  createTestConnectDb,
} from "@bb/connect-db-pg/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SERVER_OFFLINE_AFTER_MS,
  labelClaim,
  machine,
  profile,
  type ConnectDb,
  server,
  session,
  sha256Hex,
  user,
  first,
} from "@bb/connect-db";

import {
  listAccountServers,
  resolveAccount,
  revokeServerCredential,
  verifyServerCredential,
} from "./servers.js";
import {
  assignMachineLabel,
  assignMachineLabelForCredential,
  sanitizeMachineLabelBase,
} from "./machine-label.js";
import { SECURE_SESSION_COOKIE } from "./cloud-dev.js";
import { verifyMachineCredential } from "./session.js";

let database: TestConnectDb;
let db: ConnectDb;

beforeEach(async () => {
  database = await createTestConnectDb();
  db = database.db;
});

afterEach(async () => {
  await database.close();
  vi.restoreAllMocks();
});

const now = new Date("2026-07-01T12:00:00.000Z");

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

describe("listAccountServers", () => {
  it("returns only the authenticated account's rows with live from last_seen_at", async () => {
    await seedUser("acct-a");
    await seedUser("acct-b");
    const liveAt = new Date(now.getTime() - 30_000);
    const staleAt = new Date(now.getTime() - SERVER_OFFLINE_AFTER_MS - 1_000);

    await seedServer({
      id: "s1",
      userId: "acct-a",
      name: "default",
      subdomain: "sawyer",
      lastSeenAt: liveAt,
    });
    await seedServer({
      id: "s2",
      userId: "acct-a",
      name: "desktop",
      subdomain: "sawyer-desktop",
      lastSeenAt: staleAt,
    });
    await seedServer({
      id: "s3",
      userId: "acct-b",
      name: "default",
      subdomain: "other",
      lastSeenAt: liveAt,
    });

    const listed = await listAccountServers(db, "acct-a", now.getTime());
    expect(listed).toEqual(
      expect.arrayContaining([
        { handle: "sawyer", name: "default", live: true },
        { handle: "sawyer-desktop", name: "desktop", live: false },
      ]),
    );
    expect(listed).toHaveLength(2);
    expect(listed.find((s) => s.handle === "other")).toBeUndefined();
  });

  it("takes live from each paired server's tunnel object when a lookup is given, and the timestamp when it is unknown", async () => {
    await seedUser("acct-a");
    const liveAt = new Date(now.getTime() - 30_000);
    const staleAt = new Date(now.getTime() - SERVER_OFFLINE_AFTER_MS - 1_000);
    await seedServer({
      id: "s1",
      userId: "acct-a",
      name: "connected",
      subdomain: "connected",
      lastSeenAt: staleAt,
    });
    await seedServer({
      id: "s2",
      userId: "acct-a",
      name: "dropped",
      subdomain: "dropped",
      lastSeenAt: liveAt,
    });
    await seedServer({
      id: "s3",
      userId: "acct-a",
      name: "unknown",
      subdomain: "unknown",
      lastSeenAt: liveAt,
    });
    await seedServer({
      id: "s4",
      userId: "acct-a",
      name: "revoked",
      subdomain: "revoked-box",
      revokedAt: new Date(now.getTime() - 5_000),
      lastSeenAt: liveAt,
    });
    const asked: string[] = [];
    const answers: Record<string, boolean | null> = {
      connected: true,
      dropped: false,
      unknown: null,
    };

    const listed = await listAccountServers(
      db,
      "acct-a",
      now.getTime(),
      async (routingKey) => {
        asked.push(routingKey);
        return answers[routingKey] ?? null;
      },
    );

    expect(listed).toEqual(
      expect.arrayContaining([
        { handle: "connected", name: "connected", live: true },
        { handle: "dropped", name: "dropped", live: false },
        { handle: "unknown", name: "unknown", live: true },
        { handle: "revoked-box", name: "revoked", live: false },
      ]),
    );
    expect(asked.sort()).toEqual(["connected", "dropped", "unknown"]);
  });

  it("falls back name to handle and treats unpaired/revoked as not live", async () => {
    await seedUser("acct-a");
    await seedServer({
      id: "s1",
      userId: "acct-a",
      name: "   ",
      subdomain: "empty-name",
      credentialHash: "hash",
      lastSeenAt: now,
    });
    await seedServer({
      id: "s2",
      userId: "acct-a",
      name: "revoked",
      subdomain: "revoked-box",
      credentialHash: "hash",
      revokedAt: now,
      lastSeenAt: now,
    });
    await seedServer({
      id: "s3",
      userId: "acct-a",
      name: "never",
      subdomain: "never-paired",
      credentialHash: null,
      lastSeenAt: null,
    });

    const listed = await listAccountServers(db, "acct-a", now.getTime());
    expect(listed).toEqual(
      expect.arrayContaining([
        { handle: "empty-name", name: "empty-name", live: true },
        { handle: "revoked-box", name: "revoked", live: false },
        { handle: "never-paired", name: "never", live: false },
      ]),
    );
  });
});

describe("verifyServerCredential / resolveAccount", () => {
  it("authenticates a non-revoked server tunnel credential to its owner", async () => {
    await seedUser("acct-a");
    const plaintext = "bbcred_server_secret";
    await seedServer({
      id: "s1",
      userId: "acct-a",
      name: "default",
      subdomain: "sawyer",
      credentialHash: await sha256Hex(plaintext),
    });

    expect(await verifyServerCredential(plaintext, db)).toBe("acct-a");
    expect(await verifyServerCredential("wrong", db)).toBeNull();
  });

  it("revokes only the row authenticated by the presenting server", async () => {
    await seedUser("acct-a");
    const plaintext = "bbcred_revoke_this_server";
    await seedServer({
      id: "s1",
      userId: "acct-a",
      name: "default",
      subdomain: "sawyer",
      credentialHash: await sha256Hex(plaintext),
    });
    await seedServer({
      id: "s2",
      userId: "acct-a",
      name: "desktop",
      subdomain: "sawyer-desktop",
      credentialHash: await sha256Hex("bbcred_keep_this_server"),
    });

    expect(await verifyServerCredential(plaintext, db)).toBe("acct-a");
    await expect(revokeServerCredential(plaintext, db)).resolves.toEqual({
      subdomain: "sawyer",
    });

    const rows = await db
      .select({
        id: server.id,
        credentialHash: server.credentialHash,
        revokedAt: server.revokedAt,
      })
      .from(server);
    expect(rows.find((row) => row.id === "s1")).toMatchObject({
      credentialHash: null,
      revokedAt: expect.any(Date),
    });
    expect(rows.find((row) => row.id === "s2")).toMatchObject({
      credentialHash: await sha256Hex("bbcred_keep_this_server"),
      revokedAt: null,
    });
    await expect(verifyServerCredential(plaintext, db)).resolves.toBeNull();
    await expect(revokeServerCredential(plaintext, db)).resolves.toBeNull();
  });

  it("authenticates a machine credential and isolates cross-account rows", async () => {
    await seedUser("acct-a");
    await seedUser("acct-b");
    const machinePlain = "bbcm_machine_a";
    await db.insert(machine).values({
      id: "m1",
      userId: "acct-a",
      name: "laptop",
      credentialHash: await sha256Hex(machinePlain),
      createdAt: now,
      revokedAt: null,
    });
    await seedServer({
      id: "s-a",
      userId: "acct-a",
      name: "default",
      subdomain: "sawyer",
      lastSeenAt: now,
    });
    await seedServer({
      id: "s-b",
      userId: "acct-b",
      name: "default",
      subdomain: "other",
      lastSeenAt: now,
    });

    expect(await verifyMachineCredential(machinePlain, db)).toBe("acct-a");

    const req = new Request("https://sawyer.getbb.app/api/connect/servers", {
      headers: { "x-bb-connect-machine": machinePlain },
    });
    const account = await resolveAccount(
      req,
      "secret",
      db,
      SECURE_SESSION_COOKIE,
    );
    expect(account).toEqual({
      userId: "acct-a",
      grant: {
        kind: "machine",
        credentialHash: await sha256Hex(machinePlain),
      },
    });
    const listed = await listAccountServers(db, account!.userId, now.getTime());
    expect(listed.map((s) => s.handle)).toEqual(["sawyer"]);
  });

  it("returns null (unauthorized) when no credential or session is presented", async () => {
    const req = new Request("https://sawyer.getbb.app/api/connect/servers");
    expect(
      await resolveAccount(req, "secret", db, SECURE_SESSION_COOKIE),
    ).toBeNull();
  });

  it("accepts a valid owner session cookie", async () => {
    await seedUser("acct-a");
    const token = "sess_token_abc";
    const secret = "test-better-auth-secret";
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
    const cookieValue = `${token}.${sig}`;

    await db.insert(session).values({
      id: "sess1",
      token,
      expiresAt: new Date(Date.now() + 60_000),
      userId: "acct-a",
      createdAt: now,
      updatedAt: now,
    });

    const req = new Request("https://sawyer.getbb.app/api/connect/servers", {
      headers: {
        cookie: `__Secure-better-auth.session_token=${cookieValue}`,
      },
    });
    expect(
      await resolveAccount(req, secret, db, SECURE_SESSION_COOKIE),
    ).toEqual({
      userId: "acct-a",
      grant: { kind: "session", sessionId: "sess1" },
    });

    const localRequest = new Request(
      "http://sawyer.bb.localhost:8787/api/connect/servers",
      {
        headers: { cookie: `better-auth.session_token=${cookieValue}` },
      },
    );
    expect(
      (
        await resolveAccount(
          localRequest,
          secret,
          db,
          "better-auth.session_token",
        )
      )?.userId,
    ).toBe("acct-a");
  });
});

describe("machine label assignment", () => {
  it("sanitizes a host name, suffixes across every namespace, and is idempotent", async () => {
    await seedUser("acct-a");
    await db
      .insert(profile)
      .values({ userId: "acct-a", handle: "sawyer-air", createdAt: now });
    await seedServer({
      id: "s2",
      userId: "acct-a",
      name: "second",
      subdomain: "sawyer-air-2",
    });
    await db.insert(machine).values([
      {
        id: "machine-existing",
        userId: "acct-a",
        subdomain: "sawyer-air-3",
        credentialHash: "existing-hash",
        createdAt: now,
      },
      {
        id: "machine-new",
        userId: "acct-a",
        credentialHash: "new-hash",
        createdAt: now,
      },
    ]);
    expect(sanitizeMachineLabelBase("  Sawyer Air!!!  ", "machine-new")).toBe(
      "sawyer-air",
    );
    await expect(
      assignMachineLabel(db, "machine-new", "  Sawyer Air!!!  "),
    ).resolves.toBe("sawyer-air-4");
    await expect(
      assignMachineLabel(db, "machine-new", "a totally different name"),
    ).resolves.toBe("sawyer-air-4");
  });

  it("uses machine-<id-prefix> when the desired name is empty or invalid", async () => {
    await seedUser("acct-a");
    await db.insert(machine).values({
      id: "ABC-12345-rest",
      userId: "acct-a",
      credentialHash: "hash",
      createdAt: now,
    });

    expect(sanitizeMachineLabelBase("", "ABC-12345-rest")).toBe(
      "machine-abc12345",
    );
    await expect(
      assignMachineLabel(db, "ABC-12345-rest", "admin"),
    ).resolves.toBe("machine-abc12345");
  });

  it("authenticates the assigning machine and refuses revoked credentials", async () => {
    await seedUser("acct-a");
    const credential = "bbcm_assigning_machine";
    await db.insert(machine).values({
      id: "machine-auth",
      userId: "acct-a",
      credentialHash: await sha256Hex(credential),
      createdAt: now,
    });

    await expect(
      assignMachineLabelForCredential(db, credential, "Sawyer Air"),
    ).resolves.toBe("sawyer-air");
    await db
      .update(machine)
      .set({ revokedAt: now, subdomain: null })
      .where(eq(machine.id, "machine-auth"));
    await expect(
      assignMachineLabelForCredential(db, credential, "Sawyer Air"),
    ).resolves.toBeNull();
  });

  it("keeps concurrent assignments on one atomic global claim", async () => {
    await seedUser("acct-a");
    await db.insert(machine).values([
      {
        id: "machine-a",
        userId: "acct-a",
        credentialHash: "a",
        createdAt: now,
      },
      {
        id: "machine-b",
        userId: "acct-a",
        credentialHash: "b",
        createdAt: now,
      },
    ]);

    const [a, b] = await Promise.all([
      assignMachineLabel(db, "machine-a", "Shared Name"),
      assignMachineLabel(db, "machine-b", "Shared Name"),
    ]);
    expect(new Set([a, b])).toEqual(new Set(["shared-name", "shared-name-2"]));
    expect(await db.select().from(labelClaim)).toHaveLength(2);
  });

  it("loses cleanly when revocation crosses the pre-attach barrier", async () => {
    await seedUser("acct-a");
    await db.insert(machine).values({
      id: "machine-race",
      userId: "acct-a",
      credentialHash: "hash",
      createdAt: now,
    });
    let releaseBarrier: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    let attachReached: (() => void) | undefined;
    const attaching = new Promise<void>((resolve) => {
      attachReached = resolve;
    });
    const assignment = assignMachineLabel(db, "machine-race", "Race Box", {
      beforeAttach: async () => {
        attachReached?.();
        await barrier;
      },
    });

    await attaching;
    await db
      .update(machine)
      .set({ revokedAt: now })
      .where(eq(machine.id, "machine-race"));
    releaseBarrier?.();

    await expect(assignment).resolves.toBeNull();
    expect(
      (
        await first(
          db
            .select()
            .from(machine)
            .where(eq(machine.id, "machine-race"))
            .limit(1),
        )
      )?.subdomain,
    ).toBeNull();
    expect(await db.select().from(labelClaim)).toEqual([]);
  });

  it("has no pause-after-claim gap against a claim-ignorant server writer", async () => {
    await seedUser("acct-a");
    await seedUser("acct-b");
    await db.insert(machine).values({
      id: "machine-atomic",
      userId: "acct-a",
      credentialHash: "hash",
      createdAt: now,
    });
    let resumeAttach: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      resumeAttach = resolve;
    });
    let attachReached: (() => void) | undefined;
    const attaching = new Promise<void>((resolve) => {
      attachReached = resolve;
    });
    let paused = false;
    const assignment = assignMachineLabel(
      db,
      "machine-atomic",
      "Shared Atomic",
      {
        beforeAttach: async (candidate) => {
          if (candidate !== "shared-atomic" || paused) return;
          paused = true;
          attachReached?.();
          await barrier;
        },
      },
    );

    await attaching;
    expect(await db.select().from(labelClaim)).toEqual([]);
    await seedServer({
      id: "old-writer-server",
      userId: "acct-b",
      name: "default",
      subdomain: "shared-atomic",
      credentialHash: null,
    });
    resumeAttach?.();

    await expect(assignment).resolves.toBe("shared-atomic-2");
    expect(
      (
        await first(
          db
            .select()
            .from(server)
            .where(eq(server.id, "old-writer-server"))
            .limit(1),
        )
      )?.subdomain,
    ).toBe("shared-atomic");
    expect(
      (
        await first(
          db
            .select()
            .from(machine)
            .where(eq(machine.id, "machine-atomic"))
            .limit(1),
        )
      )?.subdomain,
    ).toBe("shared-atomic-2");
    expect(
      await db
        .select({ label: labelClaim.label })
        .from(labelClaim)
        .orderBy(labelClaim.label),
    ).toEqual([{ label: "shared-atomic" }, { label: "shared-atomic-2" }]);
  });
});
