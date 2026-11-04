import Database from "better-sqlite3";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  aiUsageDay,
  checkLabelAvailability,
  labelClaim,
  machine,
  profile,
  rowsChanged,
  server,
  user,
} from "@bb/connect-db";
import {
  type MirrorFailure,
  type SqlBackend,
  createConnectDb,
} from "@bb/connect-db/store";
import { connectDbMigrationStatements } from "@bb/connect-db/testing";
import { applyConnectDbPgMigrations } from "../src/migrate.js";
import { type PgliteConnectDb, createMigratedPglite } from "../src/testing.js";

function sqliteBackend(db: Database.Database): SqlBackend {
  return {
    kind: "d1",
    async execute(text, params, method) {
      const statement = db.prepare(text);
      if (statement.reader) {
        const rows = statement.raw(true).all(...params) as unknown[][];
        return { rows, changes: method === "run" ? rows.length : 0 };
      }
      const result = statement.run(...params);
      return { rows: [], changes: result.changes };
    },
  };
}

function migratedSqlite(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of connectDbMigrationStatements()) db.exec(statement);
  return db;
}

let pglite: PgliteConnectDb;

beforeEach(async () => {
  const instance = await createMigratedPglite();
  pglite = instance;
  return () => instance.close();
});

const NOW = new Date(1_790_000_000_000);

function userRow(id: string) {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mirrorPair(
  primary: SqlBackend,
  secondary: SqlBackend | null,
  shadowReads = 0,
) {
  const pending: Promise<unknown>[] = [];
  const failures: MirrorFailure[] = [];
  const handle = createConnectDb({
    backends: { primary, secondary, shadowReads },
    waitUntil: (promise) => pending.push(promise),
    onMirrorFailure: (failure) => failures.push(failure),
  });
  return { ...handle, failures };
}

async function labelClaims(backend: SqlBackend): Promise<unknown[][]> {
  const { rows } = await backend.execute(
    `select "label", "kind", "owner_id", "user_id", "generation" from "label_claim" order by "label"`,
    [],
    "all",
  );
  return rows;
}

describe("SQLite-dialect queries on Postgres", () => {
  it("round-trips dates, booleans and write counts", async () => {
    const { backend } = pglite;
    const { db } = mirrorPair(backend, null);

    await db.insert(user).values(userRow("u1")).run();
    const row = await db.select().from(user).where(eq(user.id, "u1")).get();
    expect(row).toEqual({ ...userRow("u1"), image: null, githubLogin: null });

    const updated = await db
      .update(user)
      .set({ emailVerified: false })
      .where(eq(user.id, "u1"))
      .run();
    expect(rowsChanged(updated)).toBe(1);
    const missing = await db
      .update(user)
      .set({ emailVerified: false })
      .where(eq(user.id, "nobody"))
      .run();
    expect(rowsChanged(missing)).toBe(0);
    expect(
      (await db.select().from(user).where(eq(user.id, "u1")).get())
        ?.emailVerified,
    ).toBe(false);
  });

  it("keeps label claims and their collisions", async () => {
    const { backend } = pglite;
    const { db } = mirrorPair(backend, null);
    await db
      .insert(user)
      .values([userRow("u1"), userRow("u2")])
      .run();
    await db
      .insert(profile)
      .values({ userId: "u1", handle: "alice", createdAt: NOW })
      .run();

    expect(await checkLabelAvailability(db, "alice")).toEqual({
      available: false,
      reason: "taken",
      namespace: "handle",
    });
    await expect(
      db
        .insert(server)
        .values({
          id: "s2",
          userId: "u2",
          subdomain: "alice",
          createdAt: NOW,
        })
        .run(),
    ).rejects.toThrow(/unique constraint/iu);

    await db
      .insert(machine)
      .values({
        id: "m1",
        userId: "u2",
        credentialHash: "hash",
        createdAt: NOW,
      })
      .run();
    await db
      .update(machine)
      .set({ subdomain: "bob-laptop" })
      .where(eq(machine.id, "m1"))
      .run();
    const claim = await db
      .select()
      .from(labelClaim)
      .where(eq(labelClaim.label, "bob-laptop"))
      .get();
    expect(claim).toMatchObject({ kind: "machine", ownerId: "m1" });
    expect(claim?.generation).toMatch(/^[0-9a-f]{32}$/u);
  });

  it("runs the AI budget's conditional upsert", async () => {
    const { backend } = pglite;
    const { db } = mirrorPair(backend, null);
    await db.insert(user).values(userRow("u1")).run();
    const reserve = (micros: number, limit: number) =>
      db
        .insert(aiUsageDay)
        .values({
          userId: "u1",
          day: "2026-11-03",
          reservedMicros: micros,
          requests: 1,
        })
        .onConflictDoUpdate({
          target: [aiUsageDay.userId, aiUsageDay.day],
          set: {
            reservedMicros: sql`${aiUsageDay.reservedMicros} + ${micros}`,
            requests: sql`${aiUsageDay.requests} + 1`,
          },
          setWhere: sql`${aiUsageDay.spentMicros} + ${aiUsageDay.reservedMicros} + ${micros} <= ${limit}`,
        })
        .returning({ spentMicros: aiUsageDay.spentMicros })
        .get();

    expect(await reserve(5_000, 10_000)).toEqual({ spentMicros: 0 });
    expect(await reserve(5_000, 10_000)).toEqual({ spentMicros: 0 });
    expect(await reserve(5_000, 10_000)).toBeUndefined();

    await db
      .update(aiUsageDay)
      .set({
        reservedMicros: sql`case when ${aiUsageDay.reservedMicros} > ${20_000} then ${aiUsageDay.reservedMicros} - ${20_000} else 0 end`,
      })
      .where(and(eq(aiUsageDay.userId, "u1"), eq(aiUsageDay.day, "2026-11-03")))
      .run();
    expect(
      await db
        .select({
          reserved: aiUsageDay.reservedMicros,
          requests: aiUsageDay.requests,
        })
        .from(aiUsageDay)
        .get(),
    ).toEqual({ reserved: 0, requests: 2 });
  });

  it("applies migrations once", async () => {
    const { queryable } = pglite;
    expect(await applyConnectDbPgMigrations(queryable)).toEqual([]);
  });
});

describe("mirrored writes", () => {
  it("copies D1 writes and label generations to Postgres", async () => {
    const sqlite = sqliteBackend(migratedSqlite());
    const { backend: pg } = pglite;
    const { db, mirrored, failures } = mirrorPair(sqlite, pg);

    await db.insert(user).values(userRow("u1")).run();
    await db
      .insert(profile)
      .values({ userId: "u1", handle: "alice", createdAt: NOW })
      .run();
    await db
      .insert(server)
      .values({ id: "s1", userId: "u1", subdomain: "alice-2", createdAt: NOW })
      .run();
    await db
      .insert(machine)
      .values({
        id: "m1",
        userId: "u1",
        subdomain: "alice-mac",
        credentialHash: "hash",
        createdAt: NOW,
      })
      .run();
    const renamed = await db
      .update(machine)
      .set({ subdomain: "alice-mbp" })
      .where(eq(machine.id, "m1"))
      .returning({ subdomain: machine.subdomain })
      .get();
    expect(renamed).toEqual({ subdomain: "alice-mbp" });
    await mirrored();

    expect(failures).toEqual([]);
    const primaryClaims = await labelClaims(sqlite);
    expect(primaryClaims.map((row) => row[0])).toEqual([
      "alice",
      "alice-2",
      "alice-mbp",
    ]);
    expect(await labelClaims(pg)).toEqual(primaryClaims);
  });

  it("copies Postgres generations back to D1", async () => {
    const sqlite = sqliteBackend(migratedSqlite());
    const { backend: pg } = pglite;
    const { db, mirrored, failures } = mirrorPair(pg, sqlite);

    await db.insert(user).values(userRow("u1")).run();
    await db
      .insert(profile)
      .values({ userId: "u1", handle: "alice", createdAt: NOW })
      .run();
    await db.delete(profile).where(eq(profile.userId, "u1")).run();
    await db
      .insert(profile)
      .values({ userId: "u1", handle: "alice", createdAt: NOW })
      .run();
    await mirrored();

    expect(failures).toEqual([]);
    expect(await labelClaims(sqlite)).toEqual(await labelClaims(pg));
  });

  it("skips last-seen writes and reports replay failures without failing the request", async () => {
    const sqlite = sqliteBackend(migratedSqlite());
    const { backend: pg } = pglite;
    const seed = mirrorPair(sqlite, null);
    await seed.db.insert(user).values(userRow("u1")).run();
    const { db, mirrored, failures } = mirrorPair(sqlite, pg);

    await db
      .insert(machine)
      .values({ id: "m1", userId: "u1", credentialHash: "h", createdAt: NOW })
      .run();
    await db
      .update(machine)
      .set({ lastSeenAt: NOW })
      .where(eq(machine.id, "m1"))
      .run();
    await mirrored();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      stage: "replay",
      table: "machine",
      primary: "d1",
      secondary: "pg",
    });
    expect(
      (await db.select().from(machine).where(eq(machine.id, "m1")).get())
        ?.lastSeenAt,
    ).toEqual(NOW);
  });
});

describe("shadow reads", () => {
  it("serves the primary's rows and reports reads that differ on the secondary", async () => {
    const sqlite = sqliteBackend(migratedSqlite());
    const { backend: pg } = await pglite();
    const both = mirrorPair(sqlite, pg);
    await both.db.insert(user).values(userRow("u1")).run();
    await both.db.insert(user).values(userRow("u2")).run();
    await both.mirrored();
    await mirrorPair(sqlite, null)
      .db.update(user)
      .set({ name: "primary only" })
      .where(eq(user.id, "u2"))
      .run();
    const { db, mirrored, failures } = mirrorPair(sqlite, pg, 1);

    const matching = await db
      .select({ id: user.id, verified: user.emailVerified })
      .from(user)
      .where(eq(user.id, "u1"))
      .get();
    const listed = await db.select({ id: user.id }).from(user).all();
    const differing = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, "u2"))
      .get();
    await mirrored();

    expect(matching).toEqual({ id: "u1", verified: true });
    expect(listed.map((row) => row.id).sort()).toEqual(["u1", "u2"]);
    expect(differing).toEqual({ name: "primary only" });
    expect(failures).toEqual([
      {
        stage: "shadow_mismatch",
        table: "user",
        primary: "d1",
        secondary: "pg",
        error: "rows differ (primary 1, secondary 1)",
      },
    ]);
  });

  it("reports a failing secondary without failing the read", async () => {
    const sqlite = sqliteBackend(migratedSqlite());
    const broken: SqlBackend = {
      kind: "pg",
      execute: () => Promise.reject(new Error("connection refused")),
    };
    await mirrorPair(sqlite, null).db.insert(user).values(userRow("u1")).run();
    const { db, mirrored, failures } = mirrorPair(sqlite, broken, 1);

    const row = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, "u1"))
      .get();
    await mirrored();

    expect(row).toEqual({ id: "u1" });
    expect(failures).toEqual([
      {
        stage: "shadow_read",
        table: "user",
        primary: "d1",
        secondary: "pg",
        error: "connection refused",
      },
    ]);
  });
});
