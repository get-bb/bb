import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ConnectDb,
  aiRequestLog,
  aiUsageDay,
  connectCode,
  resolveServerCredential,
  server,
  sha256Hex,
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

async function seedUser(id: string): Promise<void> {
  const now = new Date();
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
}

describe("account link and AI usage tables", () => {
  it("stores unowned server-link rows and rejects duplicate device codes", async () => {
    const now = new Date();
    const row = {
      purpose: "server-link" as const,
      deviceCodeHash: "hash-1",
      clientName: "laptop",
      expiresAt: now,
      createdAt: now,
    };
    await db.insert(connectCode).values({ code: "AAAA-AAAA", ...row });
    expect(
      await first(
        db
          .select({ userId: connectCode.userId })
          .from(connectCode)
          .where(eq(connectCode.code, "AAAA-AAAA"))
          .limit(1),
      ),
    ).toEqual({ userId: null });
    await expect(
      db.insert(connectCode).values({ code: "BBBB-BBBB", ...row }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/unique constraint/iu) },
    });
  });

  it("keys per-user usage by user and UTC day and cascades with the user", async () => {
    await seedUser("u1");
    await db.insert(aiUsageDay).values({ userId: "u1", day: "2026-09-22" });
    await db
      .insert(aiUsageDay)
      .values({ userId: "u1", day: "2026-09-23", spentMicros: 5 });
    await expect(
      db.insert(aiUsageDay).values({ userId: "u1", day: "2026-09-22" }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/unique constraint/iu) },
    });
    await db.insert(aiRequestLog).values({
      id: "r1",
      userId: "u1",
      serverId: null,
      model: null,
      latencyMs: 3,
      outcome: "ok",
      createdAt: new Date(),
    });
    await db.delete(user).where(eq(user.id, "u1"));
    expect(await db.select().from(aiUsageDay)).toHaveLength(0);
    expect(await db.select().from(aiRequestLog)).toHaveLength(0);
  });

  it("never stores prompt or completion text columns", async () => {
    const { rows } = await database.pglite.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_request_log' ORDER BY ordinal_position",
    );
    expect(rows.map((row) => row.column_name)).toEqual([
      "id",
      "user_id",
      "server_id",
      "model",
      "prompt_tokens",
      "completion_tokens",
      "cost_micros",
      "latency_ms",
      "outcome",
      "created_at",
    ]);
  });
});

describe("resolveServerCredential", () => {
  it("resolves live credentials and rejects revoked or unknown ones", async () => {
    await seedUser("u1");
    const now = new Date();
    await db.insert(server).values({
      id: "s1",
      userId: "u1",
      name: "default",
      subdomain: "sawyer",
      credentialHash: await sha256Hex("bbcred_live"),
      createdAt: now,
    });
    await db.insert(server).values({
      id: "s2",
      userId: "u1",
      name: "old",
      subdomain: "sawyer-old",
      credentialHash: await sha256Hex("bbcred_revoked"),
      revokedAt: now,
      createdAt: now,
    });

    const live = await resolveServerCredential(db, " bbcred_live ");
    expect(live?.userId).toBe("u1");
    expect(live?.server.id).toBe("s1");
    expect(live?.server.subdomain).toBe("sawyer");
    await expect(
      resolveServerCredential(db, "bbcred_revoked"),
    ).resolves.toBeNull();
    await expect(
      resolveServerCredential(db, "bbcred_unknown"),
    ).resolves.toBeNull();
    await expect(resolveServerCredential(db, "  ")).resolves.toBeNull();
  });
});
