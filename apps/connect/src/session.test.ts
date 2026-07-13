import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  labelClaim,
  machine,
  profile,
  schema,
  server,
  user,
} from "@bb/connect-db";

import {
  MACHINE_LAST_SEEN_WRITE_INTERVAL_MS,
  markMachineSeen,
  resolveLabel,
  verifyMachineCredentialDetails,
} from "./session.js";
import { assignMachineLabel } from "./machine-label.js";

// Real in-memory SQLite (never mock the DB). resolveLabel accepts any Drizzle
// SQLite database (the widened ConnectDb type), so the better-sqlite3 driver
// exercises the exact query the D1 worker runs. The migrations live in
// connect-db; resolve them from that package rather than duplicating DDL.
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
      // Honor an explicit null (unpaired); default only when the key is absent.
      credentialHash: "credentialHash" in over ? over.credentialHash : "hash",
      revokedAt: over.revokedAt ?? null,
      lastSeenAt: over.lastSeenAt ?? null,
      createdAt: now,
    })
    .run();
  db.update(labelClaim)
    .set({ generation: `${over.id}-generation` })
    .where(eq(labelClaim.label, over.subdomain))
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
      cacheKey: "sawyer",
      routingKey: "sawyer",
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
    // Both belong to the one account, but each label resolves to ITS server row
    // — not the account's "single" server. This is the multi-server change.
    if (primary?.kind !== "server" || desktop?.kind !== "server") {
      throw new Error("expected server labels");
    }
    expect(primary.server.id).toBe("srv-primary");
    expect(desktop.server.id).toBe("srv-desktop");
    expect(desktop.routingKey).toBe("sawyer-desktop");
    expect(desktop.cacheKey).toBe("sawyer-desktop:srv-desktop-generation");
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
    // The gate compares the visitor's session userId against `resolved.userId`,
    // so this owner attribution is exactly what enforces isolation.
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
      cacheKey: expect.stringMatching(/^legacy-desktop:/u),
      routingKey: "legacy-desktop",
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
      cacheKey: expect.stringMatching(/^new-machine:/u),
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
      cacheKey: "sawyer-air:machine-air-generation",
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

describe("machine credential presence", () => {
  it("verifies the owning machine and throttles lastSeenAt writes", async () => {
    seedUser("acct-machine");
    const credential = `bbcm_${crypto.randomUUID()}`;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(credential),
    );
    const credentialHash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
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
