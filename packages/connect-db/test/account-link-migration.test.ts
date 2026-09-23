import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  aiGlobalUsageDay,
  aiRequestLog,
  aiUsageDay,
  connectCode,
  schema,
  server,
  sha256Hex,
  user,
  resolveServerCredential,
  serverCredentialFromHeaders,
} from "../src/index.js";
import {
  connectDbMigrationFiles,
  readConnectDbMigration,
} from "../src/testing.js";

function migrate(sqlite: Database.Database, files: string[]): void {
  for (const file of files) sqlite.exec(readConnectDbMigration(file));
}

function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite, connectDbMigrationFiles());
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function seedUser(db: ReturnType<typeof freshDb>["db"], id: string): void {
  const now = new Date();
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

describe("0006 account link and AI usage", () => {
  it("keeps existing connect codes while making the owner nullable", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    try {
      const files = connectDbMigrationFiles();
      migrate(
        sqlite,
        files.filter((file) => file < "0006"),
      );
      const now = Date.now();
      sqlite
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        )
        .run("u1", "Test", "u1@example.com", 1, now, now);
      sqlite
        .prepare(
          "INSERT INTO server (id, user_id, name, subdomain, created_at) VALUES (?,?,?,?,?)",
        )
        .run("s1", "u1", "default", "sawyer", now);
      sqlite
        .prepare(
          "INSERT INTO connect_code (code, user_id, server_id, purpose, expires_at, consumed_at, created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run("ABCD-EFGH", "u1", "s1", "server-pair", now + 1000, null, now);

      migrate(
        sqlite,
        files.filter((file) => file >= "0006"),
      );

      const db = drizzle(sqlite, { schema });
      expect(db.select().from(connectCode).all()).toEqual([
        {
          code: "ABCD-EFGH",
          userId: "u1",
          serverId: "s1",
          purpose: "server-pair",
          deviceCodeHash: null,
          clientName: null,
          polledAt: null,
          approvedAt: null,
          deniedAt: null,
          expiresAt: new Date(now + 1000),
          consumedAt: null,
          createdAt: new Date(now),
        },
      ]);

      db.delete(user).where(eq(user.id, "u1")).run();
      expect(db.select().from(connectCode).all()).toHaveLength(0);
    } finally {
      sqlite.close();
    }
  });

  it("stores unowned server-link rows and rejects duplicate device codes", () => {
    const { sqlite, db } = freshDb();
    try {
      const now = new Date();
      const row = {
        purpose: "server-link" as const,
        deviceCodeHash: "hash-1",
        clientName: "laptop",
        expiresAt: now,
        createdAt: now,
      };
      db.insert(connectCode)
        .values({ code: "AAAA-AAAA", ...row })
        .run();
      expect(
        db
          .select({ userId: connectCode.userId })
          .from(connectCode)
          .where(eq(connectCode.code, "AAAA-AAAA"))
          .get(),
      ).toEqual({ userId: null });
      expect(() =>
        db
          .insert(connectCode)
          .values({ code: "BBBB-BBBB", ...row })
          .run(),
      ).toThrow(/UNIQUE/u);
    } finally {
      sqlite.close();
    }
  });

  it("keys per-user usage by user and UTC day and cascades with the user", () => {
    const { sqlite, db } = freshDb();
    try {
      seedUser(db, "u1");
      db.insert(aiUsageDay).values({ userId: "u1", day: "2026-09-22" }).run();
      db.insert(aiUsageDay)
        .values({ userId: "u1", day: "2026-09-23", spentMicros: 5 })
        .run();
      expect(() =>
        db.insert(aiUsageDay).values({ userId: "u1", day: "2026-09-22" }).run(),
      ).toThrow(/UNIQUE|PRIMARY/u);
      db.insert(aiGlobalUsageDay).values({ day: "2026-09-22" }).run();
      db.insert(aiRequestLog)
        .values({
          id: "r1",
          userId: "u1",
          serverId: null,
          model: null,
          latencyMs: 3,
          outcome: "ok",
          createdAt: new Date(),
        })
        .run();
      db.delete(user).where(eq(user.id, "u1")).run();
      expect(db.select().from(aiUsageDay).all()).toHaveLength(0);
      expect(db.select().from(aiRequestLog).all()).toHaveLength(0);
      expect(db.select().from(aiGlobalUsageDay).all()).toHaveLength(1);
    } finally {
      sqlite.close();
    }
  });

  it("never stores prompt or completion text columns", () => {
    const { sqlite } = freshDb();
    try {
      const columns = (
        sqlite.prepare("PRAGMA table_info(ai_request_log)").all() as {
          name: string;
        }[]
      ).map((column) => column.name);
      expect(columns).toEqual([
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
    } finally {
      sqlite.close();
    }
  });
});

describe("resolveServerCredential", () => {
  it("resolves live credentials and rejects revoked or unknown ones", async () => {
    const { sqlite, db } = freshDb();
    try {
      seedUser(db, "u1");
      const now = new Date();
      db.insert(server)
        .values({
          id: "s1",
          userId: "u1",
          name: "default",
          subdomain: "sawyer",
          credentialHash: await sha256Hex("bbcred_live"),
          createdAt: now,
        })
        .run();
      db.insert(server)
        .values({
          id: "s2",
          userId: "u1",
          name: "old",
          subdomain: "sawyer-old",
          credentialHash: await sha256Hex("bbcred_revoked"),
          revokedAt: now,
          createdAt: now,
        })
        .run();

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
    } finally {
      sqlite.close();
    }
  });
});

describe("serverCredentialFromHeaders", () => {
  it("reads either the bearer token or the machine header", () => {
    expect(
      serverCredentialFromHeaders(
        new Headers({ authorization: "Bearer bbcred_a" }),
      ),
    ).toBe("bbcred_a");
    expect(
      serverCredentialFromHeaders(
        new Headers({ "x-bb-connect-machine": "bbcred_b" }),
      ),
    ).toBe("bbcred_b");
    expect(
      serverCredentialFromHeaders(
        new Headers({
          authorization: "Bearer bbcred_a",
          "x-bb-connect-machine": "bbcred_a",
        }),
      ),
    ).toBe("bbcred_a");
    expect(
      serverCredentialFromHeaders(new Headers({ authorization: "Basic abc" })),
    ).toBe("");
    expect(serverCredentialFromHeaders(new Headers())).toBe("");
  });
});
