import { and, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  aiUsageDay,
  checkLabelAvailability,
  labelClaim,
  machine,
  profile,
  rowsChanged,
  server,
  user,
  first,
} from "@bb/connect-db";
import { applyConnectDbMigrations } from "../src/migrate.js";
import { type TestConnectDb, createTestConnectDb } from "../src/testing.js";

const opened: TestConnectDb[] = [];

async function pglite(): Promise<TestConnectDb> {
  const instance = await createTestConnectDb();
  opened.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((instance) => instance.close()));
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

describe("connect-db on Postgres", () => {
  it("round-trips dates, booleans and write counts", async () => {
    const { db } = await pglite();

    await db.insert(user).values(userRow("u1"));
    const row = await first(
      db.select().from(user).where(eq(user.id, "u1")).limit(1),
    );
    expect(row).toEqual({ ...userRow("u1"), image: null, githubLogin: null });

    const updated = await db
      .update(user)
      .set({ emailVerified: false })
      .where(eq(user.id, "u1"));
    expect(rowsChanged(updated)).toBe(1);
    const missing = await db
      .update(user)
      .set({ emailVerified: false })
      .where(eq(user.id, "nobody"));
    expect(rowsChanged(missing)).toBe(0);
    expect(
      (await first(db.select().from(user).where(eq(user.id, "u1")).limit(1)))
        ?.emailVerified,
    ).toBe(false);
  });

  it("keeps label claims and their collisions", async () => {
    const { db } = await pglite();
    await db.insert(user).values([userRow("u1"), userRow("u2")]);
    await db
      .insert(profile)
      .values({ userId: "u1", handle: "alice", createdAt: NOW });

    expect(await checkLabelAvailability(db, "alice")).toEqual({
      available: false,
      reason: "taken",
      namespace: "handle",
    });
    await expect(
      db.insert(server).values({
        id: "s2",
        userId: "u2",
        subdomain: "alice",
        createdAt: NOW,
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/unique constraint/iu) },
    });

    await db.insert(machine).values({
      id: "m1",
      userId: "u2",
      credentialHash: "hash",
      createdAt: NOW,
    });
    await db
      .update(machine)
      .set({ subdomain: "bob-laptop" })
      .where(eq(machine.id, "m1"));
    const claim = await first(
      db
        .select()
        .from(labelClaim)
        .where(eq(labelClaim.label, "bob-laptop"))
        .limit(1),
    );
    expect(claim).toMatchObject({ kind: "machine", ownerId: "m1" });
    expect(claim?.generation).toMatch(/^[0-9a-f]{32}$/u);
  });

  it("runs the AI budget's conditional upsert", async () => {
    const { db } = await pglite();
    await db.insert(user).values(userRow("u1"));
    const reserve = (micros: number, limit: number) =>
      first(
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
          .returning({ spentMicros: aiUsageDay.spentMicros }),
      );

    expect(await reserve(5_000, 10_000)).toEqual({ spentMicros: 0 });
    expect(await reserve(5_000, 10_000)).toEqual({ spentMicros: 0 });
    expect(await reserve(5_000, 10_000)).toBeUndefined();

    await db
      .update(aiUsageDay)
      .set({
        reservedMicros: sql`case when ${aiUsageDay.reservedMicros} > ${20_000} then ${aiUsageDay.reservedMicros} - ${20_000} else 0 end`,
      })
      .where(
        and(eq(aiUsageDay.userId, "u1"), eq(aiUsageDay.day, "2026-11-03")),
      );
    expect(
      await first(
        db
          .select({
            reserved: aiUsageDay.reservedMicros,
            requests: aiUsageDay.requests,
          })
          .from(aiUsageDay)
          .limit(1),
      ),
    ).toEqual({ reserved: 0, requests: 2 });
  });

  it("applies migrations once", async () => {
    const { queryable } = await pglite();
    expect(await applyConnectDbMigrations(queryable)).toEqual([]);
  });
});
