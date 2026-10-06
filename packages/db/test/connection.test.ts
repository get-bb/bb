import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createConnection,
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_CACHE_SIZE_KIB,
  SQLITE_MMAP_SIZE_BYTES,
  type SlowDbQueryLogger,
  type SlowDbQueryLogFields,
} from "../src/connection.js";
import { migrate } from "../src/migrate.js";
import { hosts } from "../src/schema.js";

interface LoggedInfo {
  fields: SlowDbQueryLogFields;
  message: string;
}

class CapturingSlowQueryLogger implements SlowDbQueryLogger {
  readonly infoLogs: LoggedInfo[] = [];

  info(fields: SlowDbQueryLogFields, message: string): void {
    this.infoLogs.push({ fields, message });
  }

  clear(): void {
    this.infoLogs.length = 0;
  }
}

function getOnlyInfoLog(logger: CapturingSlowQueryLogger): LoggedInfo {
  expect(logger.infoLogs).toHaveLength(1);
  const infoLog = logger.infoLogs[0];
  if (!infoLog) {
    throw new Error("Expected slow query info log");
  }
  return infoLog;
}

describe("createConnection", () => {
  it("distinguishes time waiting inside SQLite from CPU work", () => {
    const logger = new CapturingSlowQueryLogger();
    const db = createConnection(":memory:", {
      slowQueryLogger: logger,
      slowQueryThresholdMs: 0,
    });
    migrate(db);
    try {
      const signal = new Int32Array(new SharedArrayBuffer(4));
      db.$client.function("wait_for_io", () => {
        Atomics.wait(signal, 0, 0, 100);
        return 7;
      });
      logger.clear();
      expect(db.$client.prepare("SELECT wait_for_io() AS value").get()).toEqual(
        { value: 7 },
      );
      const { fields } = getOnlyInfoLog(logger);
      expect(fields.durationMs).toBeGreaterThanOrEqual(90);
      expect(fields.cpuDurationMs).toBeGreaterThanOrEqual(0);
      expect(fields.durationMs - fields.cpuDurationMs).toBeGreaterThan(50);
    } finally {
      db.$client.close();
    }
  });

  it("applies live thresholds to statements prepared before the setting changed", () => {
    const logger = new CapturingSlowQueryLogger();
    let thresholdMs = Infinity;
    const db = createConnection(":memory:", {
      slowQueryLogger: logger,
      slowQueryThresholdMs: () => thresholdMs,
    });
    migrate(db);
    try {
      const statement = db.$client.prepare("SELECT 1");
      statement.get();
      expect(logger.infoLogs).toHaveLength(0);
      thresholdMs = 0;
      statement.get();
      expect(getOnlyInfoLog(logger).fields.thresholdMs).toBe(0);
      logger.clear();
      thresholdMs = Infinity;
      statement.get();
      expect(logger.infoLogs).toHaveLength(0);
    } finally {
      db.$client.close();
    }
  });

  it.each(["default", "deferred", "immediate", "exclusive"] as const)(
    "times complete %s transactions and exec while preserving rollback and receivers",
    (mode) => {
      const logger = new CapturingSlowQueryLogger();
      const db = createConnection(":memory:", {
        slowQueryLogger: logger,
        slowQueryThresholdMs: 0,
      });
      migrate(db);
      try {
        db.$client.exec("CREATE TABLE diagnostic_values (value TEXT)");
        logger.clear();
        expect(
          db.$client.exec(
            "INSERT INTO diagnostic_values VALUES ('private-value')",
          ),
        ).toBe(db.$client);
        expect(getOnlyInfoLog(logger).fields).toMatchObject({
          operation: "exec",
          sql: "INSERT INTO diagnostic_values VALUES ('?')",
        });
        const nested = db.$client.transaction(() => {
          db.$client.exec(
            "INSERT INTO diagnostic_values VALUES ('rolled-back')",
          );
          throw new Error("rollback nested transaction");
        });
        const transaction = db.$client.transaction(function (
          this: { prefix: string },
          value: string,
        ) {
          db.$client
            .prepare("INSERT INTO diagnostic_values VALUES (?)")
            .run(value);
          expect(() => nested()).toThrow("rollback nested transaction");
          return this.prefix + value;
        });
        logger.clear();
        expect(transaction[mode].call({ prefix: "result:" }, "committed")).toBe(
          "result:committed",
        );
        const transactions = logger.infoLogs.filter(
          (log) => log.fields.operation === "transaction",
        );
        expect(transactions.map((log) => log.fields.sql)).toEqual([
          "TRANSACTION DEFAULT",
          `TRANSACTION ${mode.toUpperCase()}`,
        ]);
        expect(transactions[1]?.fields).toMatchObject({
          bindingArgumentCount: 1,
          cpuDurationMs: expect.any(Number),
          durationMs: expect.any(Number),
        });
        expect(
          db.$client
            .prepare("SELECT value FROM diagnostic_values ORDER BY value")
            .all(),
        ).toEqual([{ value: "committed" }, { value: "private-value" }]);
        expect(transaction.default).toBe(transaction);
        expect(Reflect.get(transaction[mode], "database")).toBe(db.$client);
      } finally {
        db.$client.close();
      }
    },
  );

  it("logs slow prepared statement executions without parameter values", () => {
    const logger = new CapturingSlowQueryLogger();
    const db = createConnection(":memory:", {
      slowQueryLogger: logger,
      slowQueryThresholdMs: 0,
    });

    db.$client.prepare("SELECT ? AS value").get("sensitive-value");

    const infoLog = getOnlyInfoLog(logger);
    expect(infoLog.message).toBe("Slow DB query");
    expect(infoLog.fields.operation).toBe("get");
    expect(infoLog.fields.bindingArgumentCount).toBe(1);
    expect(infoLog.fields.sql).toBe("SELECT ? AS value");
    expect(infoLog.fields.sql).not.toContain("sensitive-value");

    db.$client.close();
  });

  it("redacts SQL string literals in slow query logs", () => {
    const logger = new CapturingSlowQueryLogger();
    const db = createConnection(":memory:", {
      slowQueryLogger: logger,
      slowQueryThresholdMs: 0,
    });

    db.$client.prepare("SELECT 'sensitive-literal' AS value").get();

    const infoLog = getOnlyInfoLog(logger);
    expect(infoLog.fields.sql).toBe("SELECT '?' AS value");
    expect(infoLog.fields.sql).not.toContain("sensitive-literal");

    db.$client.close();
  });

  it("logs slow drizzle ORM statement executions", () => {
    const logger = new CapturingSlowQueryLogger();
    const db = createConnection(":memory:", {
      slowQueryLogger: logger,
      slowQueryThresholdMs: 0,
    });
    migrate(db);
    db.insert(hosts)
      .values({
        createdAt: 1,
        id: "host-drizzle",
        name: "Drizzle Host",
        type: "persistent",
        updatedAt: 1,
      })
      .run();
    logger.clear();

    const row = db
      .select()
      .from(hosts)
      .where(eq(hosts.id, "host-drizzle"))
      .get();

    expect(row?.name).toBe("Drizzle Host");
    const infoLog = getOnlyInfoLog(logger);
    expect(infoLog.message).toBe("Slow DB query");
    expect(infoLog.fields.operation).toBe("get");
    expect(infoLog.fields.bindingArgumentCount).toBe(1);
    expect(infoLog.fields.sql).toContain("from");
    expect(infoLog.fields.sql).toContain("hosts");
    expect(infoLog.fields.sql).not.toContain("host-drizzle");

    db.$client.close();
  });

  it("keeps truncated slow query SQL within the logged length limit", () => {
    const logger = new CapturingSlowQueryLogger();
    const db = createConnection(":memory:", {
      slowQueryLogger: logger,
      slowQueryThresholdMs: 0,
    });
    const longSql = `SELECT '${"x".repeat(1_200)}' AS value, ${"1 OR ".repeat(
      300,
    )} 1`;

    db.$client.prepare(longSql).get();

    const infoLog = getOnlyInfoLog(logger);
    expect(infoLog.fields.sql).toHaveLength(1_000);
    expect(infoLog.fields.sql.endsWith("...")).toBe(true);

    db.$client.close();
  });

  it("applies the hot-path sqlite pragmas on a file database", () => {
    const directory = mkdtempSync(join(tmpdir(), "bb-db-pragmas-"));
    const db = createConnection(join(directory, "bb.db"));

    try {
      expect(
        db.$client.prepare("PRAGMA cache_size").get() as {
          cache_size: number;
        },
      ).toEqual({ cache_size: -SQLITE_CACHE_SIZE_KIB });
      expect(
        db.$client.prepare("PRAGMA synchronous").get() as {
          synchronous: number;
        },
      ).toEqual({ synchronous: 1 });
      expect(
        db.$client.prepare("PRAGMA mmap_size").get() as { mmap_size: number },
      ).toEqual({ mmap_size: SQLITE_MMAP_SIZE_BYTES });
      expect(
        db.$client.prepare("PRAGMA busy_timeout").get() as { timeout: number },
      ).toEqual({ timeout: SQLITE_BUSY_TIMEOUT_MS });
      expect(
        db.$client.prepare("PRAGMA journal_mode").get() as {
          journal_mode: string;
        },
      ).toEqual({ journal_mode: "wal" });
    } finally {
      db.$client.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
