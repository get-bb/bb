import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONNECT_CODE_TTL_MS,
  type ConnectDb,
  checkLabelAvailability,
  connectCode,
  labelClaim,
  machine,
  profile,
  server,
  user,
  first,
} from "@bb/connect-db";
import { type TestConnectDb, createTestConnectDb } from "../src/testing.js";

let database: TestConnectDb;
let db: ConnectDb;

beforeEach(async () => {
  database = await createTestConnectDb();
  db = database.db;
});

afterEach(async () => {
  await database.close();
});

async function query(text: string, params: unknown[]): Promise<unknown[]> {
  return (await database.pglite.query(text, params)).rows;
}

async function seedUser(id = "u1"): Promise<void> {
  const now = new Date();
  await db.insert(user).values({
    id,
    name: "Test",
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
}

describe("migration matches the drizzle schema", () => {
  it("drizzle inserts/reads round-trip against the hand-written DDL", async () => {
    await seedUser();
    const now = new Date();
    await db
      .insert(profile)
      .values({ userId: "u1", handle: "sawyer", createdAt: now });
    await db.insert(server).values({
      id: "s1",
      userId: "u1",
      name: "default",
      subdomain: "sawyer",
      createdAt: now,
    });

    const rows = await db.select().from(server).where(eq(server.userId, "u1"));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("default");
    expect(rows[0].subdomain).toBe("sawyer");
    expect(rows[0].lastSeenAt).toBeNull();
    expect(rows[0].revokedAt).toBeNull();

    await db.insert(machine).values({
      id: "m1",
      userId: "u1",
      name: "laptop",
      subdomain: "sawyer-air",
      credentialHash: "machine-hash",
      createdAt: now,
    });
    expect((await first(db.select().from(machine).limit(1)))?.subdomain).toBe(
      "sawyer-air",
    );

    const p = await first(
      db.select().from(profile).where(eq(profile.handle, "sawyer")).limit(1),
    );
    expect(p?.userId).toBe("u1");
  });

  it("stores the github login on user (nullable for pre-migration rows)", async () => {
    await seedUser("u1");
    expect(
      (await first(db.select().from(user).where(eq(user.id, "u1")).limit(1)))
        ?.githubLogin,
    ).toBeNull();

    await db
      .update(user)
      .set({ githubLogin: "sawyerhood" })
      .where(eq(user.id, "u1"));
    expect(
      (await first(db.select().from(user).where(eq(user.id, "u1")).limit(1)))
        ?.githubLogin,
    ).toBe("sawyerhood");
  });

  it("atomically rejects claim-ignorant cross-namespace source writes", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const createdAt = new Date();
    await db
      .insert(profile)
      .values({ userId: "u1", handle: "shared-label", createdAt });
    await expect(
      db.insert(server).values({
        id: "claim-ignorant-server",
        userId: "u2",
        name: "default",
        subdomain: "shared-label",
        createdAt,
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/unique constraint/iu) },
    });
    await db.insert(machine).values({
      id: "claim-ignorant-machine",
      userId: "u2",
      credentialHash: "hash",
      createdAt,
    });
    await expect(
      db
        .update(machine)
        .set({ subdomain: "shared-label" })
        .where(eq(machine.id, "claim-ignorant-machine")),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/unique constraint/iu) },
    });
    expect(
      await db
        .select()
        .from(labelClaim)
        .where(eq(labelClaim.label, "shared-label")),
    ).toHaveLength(1);
    expect(
      await first(
        db
          .select()
          .from(server)
          .where(eq(server.id, "claim-ignorant-server"))
          .limit(1),
      ),
    ).toBeUndefined();
    expect(
      (
        await first(
          db
            .select()
            .from(machine)
            .where(eq(machine.id, "claim-ignorant-machine"))
            .limit(1),
        )
      )?.subdomain,
    ).toBeNull();
  });

  it("rolls back claim-ignorant profile and server updates on global collisions", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const createdAt = Date.now();
    await query(
      "INSERT INTO profile (user_id, handle, created_at) VALUES ($1, $2, $3)",
      ["u1", "owner-one", createdAt],
    );
    await query(
      "INSERT INTO profile (user_id, handle, created_at) VALUES ($1, $2, $3)",
      ["u2", "owner-two", createdAt],
    );
    await query(
      "INSERT INTO server (id, user_id, name, subdomain, created_at) VALUES ($1, $2, $3, $4, $5)",
      ["primary-one", "u1", "default", "owner-one", createdAt],
    );
    await query(
      "INSERT INTO server (id, user_id, name, subdomain, created_at) VALUES ($1, $2, $3, $4, $5)",
      ["secondary-two", "u2", "desktop", "server-two", createdAt],
    );
    expect(
      await query("SELECT kind, owner_id FROM label_claim WHERE label = $1", [
        "owner-one",
      ]),
    ).toEqual([{ kind: "handle", owner_id: "u1" }]);

    await expect(
      query("UPDATE profile SET handle = $1 WHERE user_id = $2", [
        "server-two",
        "u1",
      ]),
    ).rejects.toThrow(/unique constraint/iu);
    await expect(
      query("UPDATE server SET subdomain = $1 WHERE id = $2", [
        "owner-one",
        "secondary-two",
      ]),
    ).rejects.toThrow(/unique constraint/iu);

    expect(
      await query("SELECT handle FROM profile WHERE user_id = $1", ["u1"]),
    ).toEqual([{ handle: "owner-one" }]);
    expect(
      await query("SELECT subdomain FROM server WHERE id = $1", [
        "secondary-two",
      ]),
    ).toEqual([{ subdomain: "server-two" }]);
    expect(
      await query(
        "SELECT label, kind FROM label_claim WHERE label IN ($1, $2) ORDER BY label",
        ["owner-one", "server-two"],
      ),
    ).toEqual([
      { label: "owner-one", kind: "handle" },
      { label: "server-two", kind: "server" },
    ]);
  });
});

describe("constraints", () => {
  it("enforces unique handles", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const now = new Date();
    await db
      .insert(profile)
      .values({ userId: "u1", handle: "taken", createdAt: now });
    await expect(
      db
        .insert(profile)
        .values({ userId: "u2", handle: "taken", createdAt: now }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/UNIQUE/i) },
    });
  });

  it("allows nullable machine labels and enforces uniqueness when assigned", async () => {
    await seedUser("u1");
    const now = new Date();
    await db.insert(machine).values([
      {
        id: "m1",
        userId: "u1",
        subdomain: "sawyer-air",
        credentialHash: "h1",
        createdAt: now,
      },
      {
        id: "m2",
        userId: "u1",
        subdomain: null,
        credentialHash: "h2",
        createdAt: now,
      },
    ]);
    await expect(
      db.insert(machine).values({
        id: "m3",
        userId: "u1",
        subdomain: "sawyer-air",
        credentialHash: "h3",
        createdAt: now,
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/UNIQUE/iu) },
    });
  });

  it("enforces one server name per user but allows the same name across users", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const now = new Date();
    await db.insert(server).values({
      id: "s1",
      userId: "u1",
      name: "default",
      subdomain: "u1-default",
      createdAt: now,
    });
    await expect(
      db.insert(server).values({
        id: "s2",
        userId: "u1",
        name: "default",
        subdomain: "u1-second",
        createdAt: now,
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/UNIQUE/i) },
    });
    await db.insert(server).values({
      id: "s3",
      userId: "u2",
      name: "default",
      subdomain: "u2-default",
      createdAt: now,
    });
  });

  it("enforces globally-unique subdomains across servers", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const now = new Date();
    await db.insert(server).values({
      id: "s1",
      userId: "u1",
      name: "default",
      subdomain: "taken",
      createdAt: now,
    });
    await expect(
      db.insert(server).values({
        id: "s2",
        userId: "u2",
        name: "laptop",
        subdomain: "taken",
        createdAt: now,
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/UNIQUE/i) },
    });
  });

  it("lets one account own several servers, each with its own subdomain", async () => {
    await seedUser("u1");
    const now = new Date();
    await db
      .insert(profile)
      .values({ userId: "u1", handle: "sawyer", createdAt: now });
    await db.insert(server).values({
      id: "s1",
      userId: "u1",
      name: "default",
      subdomain: "sawyer",
      createdAt: now,
    });
    await db.insert(server).values({
      id: "s2",
      userId: "u1",
      name: "desktop",
      subdomain: "sawyer-desktop",
      createdAt: now,
    });
    expect(
      await db.select().from(server).where(eq(server.userId, "u1")),
    ).toHaveLength(2);
  });

  it("cascades connect codes and servers when a user is deleted", async () => {
    await seedUser();
    const now = new Date();
    await db
      .insert(profile)
      .values({ userId: "u1", handle: "sawyer", createdAt: now });
    await db.insert(server).values({
      id: "s1",
      userId: "u1",
      name: "default",
      subdomain: "sawyer",
      createdAt: now,
    });
    await db.insert(connectCode).values({
      code: "abc",
      userId: "u1",
      serverId: "s1",
      purpose: "server-pair",
      expiresAt: new Date(now.getTime() + CONNECT_CODE_TTL_MS),
      createdAt: now,
    });

    await db.delete(user).where(eq(user.id, "u1"));
    expect(await db.select().from(profile)).toHaveLength(0);
    expect(await db.select().from(server)).toHaveLength(0);
    expect(await db.select().from(connectCode)).toHaveLength(0);
    expect(await db.select().from(labelClaim)).toHaveLength(0);
  });
});

describe("checkLabelAvailability (all routing namespaces)", () => {
  it("reports a free, well-formed label available", async () => {
    await seedUser();
    expect(await checkLabelAvailability(db, "sawyer-desktop")).toEqual({
      available: true,
      label: "sawyer-desktop",
    });
  });

  it("trigger-claims handle and server rows written by an old web worker", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const now = new Date();
    await db
      .insert(profile)
      .values({ userId: "u1", handle: "legacy-handle", createdAt: now });
    await db.insert(server).values([
      {
        id: "legacy-primary",
        userId: "u1",
        name: "default",
        subdomain: "legacy-handle",
        createdAt: now,
      },
      {
        id: "legacy-secondary",
        userId: "u1",
        name: "desktop",
        subdomain: "legacy-server",
        createdAt: now,
      },
    ]);

    await expect(checkLabelAvailability(db, "legacy-handle")).resolves.toEqual({
      available: false,
      reason: "taken",
      namespace: "handle",
    });
    await db.insert(machine).values({
      id: "attacker-machine",
      userId: "u2",
      credentialHash: "hash",
      createdAt: now,
    });
    await expect(
      db
        .update(machine)
        .set({ subdomain: "legacy-server" })
        .where(eq(machine.id, "attacker-machine")),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/unique constraint/iu) },
    });
    await expect(checkLabelAvailability(db, "legacy-server")).resolves.toEqual({
      available: false,
      reason: "taken",
      namespace: "subdomain",
    });
    expect(
      await first(
        db
          .select({
            label: labelClaim.label,
            kind: labelClaim.kind,
            generation: labelClaim.generation,
          })
          .from(labelClaim)
          .where(eq(labelClaim.label, "legacy-server"))
          .limit(1),
      ),
    ).toEqual({
      label: "legacy-server",
      kind: "server",
      generation: expect.stringMatching(/^[a-f0-9]{32}$/u),
    });
  });

  it("normalizes case/whitespace before checking", async () => {
    const result = await checkLabelAvailability(db, "  Sawyer-Desktop  ");
    expect(result).toEqual({ available: true, label: "sawyer-desktop" });
  });

  it("rejects invalid labels with the grammar reason (reserved, `--`, charset)", async () => {
    expect(await checkLabelAvailability(db, "admin")).toEqual({
      available: false,
      reason: "invalid",
      error: "reserved",
    });
    expect(await checkLabelAvailability(db, "foo--bar")).toEqual({
      available: false,
      reason: "invalid",
      error: "invalid-format",
    });
    expect(await checkLabelAvailability(db, "ab")).toEqual({
      available: false,
      reason: "invalid",
      error: "too-short",
    });
  });

  it("reports a label taken by an existing machine subdomain", async () => {
    await seedUser("u1");
    const now = new Date();
    await db.insert(machine).values({
      id: "m1",
      userId: "u1",
      subdomain: "sawyer-air",
      credentialHash: "hash",
      createdAt: now,
    });
    expect(await checkLabelAvailability(db, "sawyer-air")).toEqual({
      available: false,
      reason: "taken",
      namespace: "machine",
    });
  });
});
