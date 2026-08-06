import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import type { DbConnection } from "../../src/connection.js";
import { consumePrincipalAssertionReplay } from "../../src/data/principal-assertion-replays.js";
import { migrate } from "../../src/migrate.js";
import { principalAssertionReplays } from "../../src/schema.js";

const JTI_A = "11111111-1111-4111-8111-111111111111";
const JTI_B = "22222222-2222-4222-8222-222222222222";
const JTI_C = "33333333-3333-4333-8333-333333333333";

interface TempDatabasePath {
  cleanup(): void;
  dbPath: string;
}

function setup(): DbConnection {
  const db = createConnection(":memory:");
  migrate(db);
  return db;
}

function closeConnection(db: DbConnection): void {
  db.$client.close();
}

function createTempDatabasePath(): TempDatabasePath {
  const dir = mkdtempSync(join(tmpdir(), "bb-db-principal-assertion-replay-"));
  return {
    cleanup(): void {
      rmSync(dir, { force: true, recursive: true });
    },
    dbPath: join(dir, "bb.db"),
  };
}

function countReplayRows(db: DbConnection): number {
  return (
    db.select({ value: count() }).from(principalAssertionReplays).get()
      ?.value ?? 0
  );
}

describe("consumePrincipalAssertionReplay", () => {
  it("consumes a jti on first use", () => {
    const db = setup();
    try {
      expect(
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 2_000,
          jti: JTI_A,
          maxEntries: 10,
          nowMs: 1_000,
        }),
      ).toBe("consumed");
      expect(countReplayRows(db)).toBe(1);
    } finally {
      closeConnection(db);
    }
  });

  it("returns replayed for an identical jti", () => {
    const db = setup();
    try {
      expect(
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 2_000,
          jti: JTI_A,
          maxEntries: 10,
          nowMs: 1_000,
        }),
      ).toBe("consumed");
      expect(
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 3_000,
          jti: JTI_A,
          maxEntries: 10,
          nowMs: 1_500,
        }),
      ).toBe("replayed");
      expect(countReplayRows(db)).toBe(1);
    } finally {
      closeConnection(db);
    }
  });

  it("consumes distinct jtis independently", () => {
    const db = setup();
    try {
      expect(
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 2_000,
          jti: JTI_A,
          maxEntries: 10,
          nowMs: 1_000,
        }),
      ).toBe("consumed");
      expect(
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 2_000,
          jti: JTI_B,
          maxEntries: 10,
          nowMs: 1_000,
        }),
      ).toBe("consumed");
      expect(countReplayRows(db)).toBe(2);
    } finally {
      closeConnection(db);
    }
  });

  it("prunes at the expiry boundary and allows jti reuse after prune", () => {
    const db = setup();
    try {
      expect(
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 2_000,
          jti: JTI_A,
          maxEntries: 10,
          nowMs: 1_000,
        }),
      ).toBe("consumed");

      expect(
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 3_000,
          jti: JTI_B,
          maxEntries: 10,
          nowMs: 2_000,
        }),
      ).toBe("consumed");
      expect(countReplayRows(db)).toBe(1);

      expect(
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 4_000,
          jti: JTI_A,
          maxEntries: 10,
          nowMs: 2_500,
        }),
      ).toBe("consumed");
      expect(countReplayRows(db)).toBe(2);
    } finally {
      closeConnection(db);
    }
  });

  it("fails closed at capacity without evicting unexpired rows", () => {
    const db = setup();
    try {
      expect(
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 5_000,
          jti: JTI_A,
          maxEntries: 2,
          nowMs: 1_000,
        }),
      ).toBe("consumed");
      expect(
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 5_000,
          jti: JTI_B,
          maxEntries: 2,
          nowMs: 1_000,
        }),
      ).toBe("consumed");
      expect(
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 5_000,
          jti: JTI_C,
          maxEntries: 2,
          nowMs: 1_000,
        }),
      ).toBe("capacity_exhausted");
      expect(countReplayRows(db)).toBe(2);

      const rows = db.select().from(principalAssertionReplays).all();
      expect(rows.map((row) => row.jti).sort()).toEqual([JTI_A, JTI_B].sort());
    } finally {
      closeConnection(db);
    }
  });

  it("rejects invalid inputs without writing and without echoing jti", () => {
    const db = setup();
    try {
      const invalidJti = "NOT-A-UUID-VALUE-THAT-MUST-NOT-ECHO";

      expect(() =>
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 2_000,
          jti: invalidJti,
          maxEntries: 10,
          nowMs: 1_000,
        }),
      ).toThrow(/Invalid principal assertion replay jti/u);

      expect(() =>
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 2_000,
          jti: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          maxEntries: 10,
          nowMs: 1_000,
        }),
      ).toThrow(/Invalid principal assertion replay jti/u);

      expect(() =>
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 1_000,
          jti: JTI_A,
          maxEntries: 10,
          nowMs: 1_000,
        }),
      ).toThrow(/Invalid principal assertion replay timestamps/u);

      expect(() =>
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 2_000,
          jti: JTI_A,
          maxEntries: 10,
          nowMs: -1,
        }),
      ).toThrow(/Invalid principal assertion replay timestamps/u);

      expect(() =>
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: Number.POSITIVE_INFINITY,
          jti: JTI_A,
          maxEntries: 10,
          nowMs: 1_000,
        }),
      ).toThrow(/Invalid principal assertion replay timestamps/u);

      expect(() =>
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 2_000,
          jti: JTI_A,
          maxEntries: 0,
          nowMs: 1_000,
        }),
      ).toThrow(/Invalid principal assertion replay maxEntries/u);

      expect(() =>
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 2_000,
          jti: JTI_A,
          maxEntries: 100_001,
          nowMs: 1_000,
        }),
      ).toThrow(/Invalid principal assertion replay maxEntries/u);

      expect(countReplayRows(db)).toBe(0);

      try {
        consumePrincipalAssertionReplay({
          db,
          expiresAtMs: 2_000,
          jti: invalidJti,
          maxEntries: 10,
          nowMs: 1_000,
        });
        expect.unreachable("expected invalid jti to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(invalidJti);
      }
    } finally {
      closeConnection(db);
    }
  });

  it("persists consumed jtis across close, reopen, and migrate", () => {
    const tempDatabase = createTempDatabasePath();
    try {
      const db = createConnection(tempDatabase.dbPath);
      try {
        migrate(db);
        expect(
          consumePrincipalAssertionReplay({
            db,
            expiresAtMs: 5_000,
            jti: JTI_A,
            maxEntries: 10,
            nowMs: 1_000,
          }),
        ).toBe("consumed");
      } finally {
        closeConnection(db);
      }

      const reopenedDb = createConnection(tempDatabase.dbPath);
      try {
        migrate(reopenedDb);
        expect(
          consumePrincipalAssertionReplay({
            db: reopenedDb,
            expiresAtMs: 6_000,
            jti: JTI_A,
            maxEntries: 10,
            nowMs: 1_500,
          }),
        ).toBe("replayed");
        expect(countReplayRows(reopenedDb)).toBe(1);
      } finally {
        closeConnection(reopenedDb);
      }
    } finally {
      tempDatabase.cleanup();
    }
  });
});
