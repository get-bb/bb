import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createConnection,
  DEFAULT_SQLITE_CACHE_SIZE_KIB,
  DEFAULT_SQLITE_MMAP_SIZE_BYTES,
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_CACHE_SIZE_KIB_ENV_VAR,
  SQLITE_MMAP_SIZE_BYTES_ENV_VAR,
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
      ).toEqual({ cache_size: -DEFAULT_SQLITE_CACHE_SIZE_KIB });
      expect(
        db.$client.prepare("PRAGMA synchronous").get() as {
          synchronous: number;
        },
      ).toEqual({ synchronous: 1 });
      expect(
        db.$client.prepare("PRAGMA mmap_size").get() as { mmap_size: number },
      ).toEqual({ mmap_size: DEFAULT_SQLITE_MMAP_SIZE_BYTES });
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

  it("honors env overrides for the cache and mmap budgets and ignores malformed values", () => {
    const originalCache = process.env[SQLITE_CACHE_SIZE_KIB_ENV_VAR];
    const originalMmap = process.env[SQLITE_MMAP_SIZE_BYTES_ENV_VAR];
    const directory = mkdtempSync(join(tmpdir(), "bb-db-pragma-env-"));

    function readMemoryPragmas(db: ReturnType<typeof createConnection>): {
      cacheSize: number;
      mmapSize: number;
    } {
      const cacheRow = db.$client.prepare("PRAGMA cache_size").get() as {
        cache_size: number;
      };
      const mmapRow = db.$client.prepare("PRAGMA mmap_size").get() as {
        mmap_size: number;
      };
      return { cacheSize: cacheRow.cache_size, mmapSize: mmapRow.mmap_size };
    }

    try {
      process.env[SQLITE_CACHE_SIZE_KIB_ENV_VAR] = "65536";
      process.env[SQLITE_MMAP_SIZE_BYTES_ENV_VAR] = "0";
      const overridden = createConnection(join(directory, "override.db"));
      try {
        expect(readMemoryPragmas(overridden)).toEqual({
          cacheSize: -65_536,
          mmapSize: 0,
        });
      } finally {
        overridden.$client.close();
      }

      process.env[SQLITE_CACHE_SIZE_KIB_ENV_VAR] = "not-a-number";
      process.env[SQLITE_MMAP_SIZE_BYTES_ENV_VAR] = "-5";
      const malformed = createConnection(join(directory, "malformed.db"));
      try {
        expect(readMemoryPragmas(malformed)).toEqual({
          cacheSize: -DEFAULT_SQLITE_CACHE_SIZE_KIB,
          mmapSize: DEFAULT_SQLITE_MMAP_SIZE_BYTES,
        });
      } finally {
        malformed.$client.close();
      }
    } finally {
      if (originalCache === undefined) {
        delete process.env[SQLITE_CACHE_SIZE_KIB_ENV_VAR];
      } else {
        process.env[SQLITE_CACHE_SIZE_KIB_ENV_VAR] = originalCache;
      }
      if (originalMmap === undefined) {
        delete process.env[SQLITE_MMAP_SIZE_BYTES_ENV_VAR];
      } else {
        process.env[SQLITE_MMAP_SIZE_BYTES_ENV_VAR] = originalMmap;
      }
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
