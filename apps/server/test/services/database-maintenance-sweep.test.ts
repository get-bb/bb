import Database from "better-sqlite3";
import { closeSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import {
  createConnection,
  createProject,
  createThread,
  DATABASE_MAINTENANCE_BUSY_TIMEOUT_MS,
  type DbConnection,
  type SlowDbQueryLogFields,
  type SlowDbQueryLogger,
  getDatabaseAutoVacuumMode,
  getDatabaseFreelistStats,
  listDeferredLegacyTables,
  migrate,
  noopNotifier,
  startWalCheckpointer,
  upsertHost,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { ServerLogger } from "../../src/types.js";
import {
  runDatabaseMaintenanceSweep,
  runPluginDatabaseMaintenanceSweep,
} from "../../src/services/system/periodic-sweeps.js";
import { testLogger } from "../helpers/test-app.js";

const FREELIST_ROW_COUNT = 1_200;
const SQLITE_BUSY_HEADROOM_MS = 1_000;
const TEST_DEFERRED_LEGACY_TABLE_NAMES = [
  "client_turn_requests",
  "environment_operations",
  "host_daemon_command_attempts",
  "host_daemon_commands",
  "project_operations",
  "thread_operations",
];

interface TempDatabasePath {
  dbPath: string;
  cleanup(): void;
}

class CapturingSlowQueryLogger implements SlowDbQueryLogger {
  debugLogs: SlowDbQueryLogFields[] = [];

  info(fields: SlowDbQueryLogFields): void {
    this.debugLogs.push(fields);
  }

  clear(): void {
    this.debugLogs = [];
  }
}

function createCapturingServerLogger() {
  const warnMessages: string[] = [];
  const logger: ServerLogger = {
    debug(): void {},
    error(): void {},
    info(): void {},
    warn(): void {
      warnMessages.push("warn");
    },
  };

  return { logger, warnMessages };
}

function createTempDatabasePath(): TempDatabasePath {
  const dir = mkdtempSync(join(tmpdir(), "bb-server-db-maintenance-"));
  return {
    cleanup(): void {
      rmSync(dir, { force: true, recursive: true });
    },
    dbPath: join(dir, "bb.db"),
  };
}

function createLegacyDatabaseFile(dbPath: string): void {
  const rawDb = new Database(dbPath);
  try {
    rawDb.exec("PRAGMA journal_mode = WAL");
    rawDb.exec(
      "CREATE TABLE legacy_seed (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
    );
    rawDb
      .prepare("INSERT INTO legacy_seed (id, value) VALUES (1, ?)")
      .run("legacy-data");
  } finally {
    rawDb.close();
  }
}

function walRestartCount(dbPath: string): number {
  const header = Buffer.alloc(16);
  const fd = openSync(`${dbPath}-wal`, "r");
  try {
    readSync(fd, header, 0, header.length, 0);
  } finally {
    closeSync(fd);
  }
  return header.readUInt32BE(12);
}

async function runSweepWithCheckpointer(
  db: DbConnection,
  logger: ServerLogger = testLogger,
): Promise<void> {
  const walCheckpointer = startWalCheckpointer({ logger });
  walCheckpointer.attach(db.$client);
  try {
    await runDatabaseMaintenanceSweep({ db, logger, walCheckpointer });
  } finally {
    await walCheckpointer.stop();
  }
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function createDeferredLegacyTables(db: DbConnection): void {
  for (const tableName of TEST_DEFERRED_LEGACY_TABLE_NAMES) {
    db.$client
      .prepare(
        `CREATE TABLE ${quoteSqlIdentifier(tableName)} (id TEXT PRIMARY KEY)`,
      )
      .run();
  }
}

function markDatabaseBusy(db: DbConnection): void {
  const host = upsertHost(db, noopNotifier, {
    name: "maintenance-host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "maintenance-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/project" },
  });
  createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "active",
  });
}

function buildFreelist(db: DbConnection): void {
  db.$client.exec(
    "CREATE TABLE scratch_blobs (id INTEGER PRIMARY KEY, blob TEXT)",
  );
  const insert = db.$client.prepare(
    "INSERT INTO scratch_blobs (blob) VALUES (?)",
  );
  const blob = "x".repeat(8 * 1024);
  const insertMany = db.$client.transaction((count: number) => {
    for (let index = 0; index < count; index += 1) {
      insert.run(blob);
    }
  });
  insertMany(FREELIST_ROW_COUNT);
  db.$client.exec("DELETE FROM scratch_blobs");
}

function setupBusyDatabaseWithFreelist() {
  const db = createMigratedConnection();
  markDatabaseBusy(db);
  buildFreelist(db);

  return { db };
}

function setupBusyFileDatabaseWithFreelist(tempDatabase: TempDatabasePath) {
  const db = createConnection(tempDatabase.dbPath);
  migrate(db);
  markDatabaseBusy(db);
  buildFreelist(db);

  return { db };
}

describe("runDatabaseMaintenanceSweep", () => {
  it("drops deferred legacy tables on an idle maintenance pass", async () => {
    const db = createMigratedConnection();
    createDeferredLegacyTables(db);
    expect(listDeferredLegacyTables(db)).toEqual(
      [...TEST_DEFERRED_LEGACY_TABLE_NAMES].sort(),
    );

    await runSweepWithCheckpointer(db);

    expect(listDeferredLegacyTables(db)).toEqual([]);
  });

  it("skips deferred legacy table cleanup while app work is active", async () => {
    const { db } = setupBusyDatabaseWithFreelist();
    createDeferredLegacyTables(db);

    await runSweepWithCheckpointer(db);

    expect(listDeferredLegacyTables(db)).toEqual(
      [...TEST_DEFERRED_LEGACY_TABLE_NAMES].sort(),
    );
  });

  it("leaves idle auto_vacuum=NONE databases untouched without scanning pages", async () => {
    const tempDatabase = createTempDatabasePath();
    try {
      createLegacyDatabaseFile(tempDatabase.dbPath);
      const slowQueryLogger = new CapturingSlowQueryLogger();
      const db = createConnection(tempDatabase.dbPath, {
        slowQueryLogger,
        slowQueryThresholdMs: 0,
      });
      try {
        migrate(db);
        expect(getDatabaseAutoVacuumMode(db.$client)).toBe("none");
        buildFreelist(db);
        const before = getDatabaseFreelistStats(db.$client);
        slowQueryLogger.clear();

        await runSweepWithCheckpointer(db);

        expect(getDatabaseAutoVacuumMode(db.$client)).toBe("none");
        expect(getDatabaseFreelistStats(db.$client)).toEqual(before);
        expect(
          slowQueryLogger.debugLogs.some((log) => log.sql.includes("dbstat")),
        ).toBe(false);
      } finally {
        db.$client.close();
      }
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("vacuums in chunks and yields to the event loop between them", async () => {
    const { db } = setupBusyDatabaseWithFreelist();
    const before = getDatabaseFreelistStats(db.$client);
    expect(before.freelistCount).toBeGreaterThan(512);
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });

    await runSweepWithCheckpointer(db);

    expect(yielded).toBe(true);
    expect(getDatabaseFreelistStats(db.$client).freelistCount).toBeLessThan(
      before.freelistCount - 256,
    );
  });

  it("lets the WAL restart between vacuum chunks without checkpointing on the main connection", async () => {
    const tempDatabase = createTempDatabasePath();
    try {
      const { db } = setupBusyFileDatabaseWithFreelist(tempDatabase);
      try {
        const before = getDatabaseFreelistStats(db.$client);
        expect(before.freelistCount).toBeGreaterThan(256 * 4);
        const restartsBefore = walRestartCount(tempDatabase.dbPath);

        await runSweepWithCheckpointer(db);

        expect(getDatabaseFreelistStats(db.$client).freelistCount).toBe(0);
        expect(
          walRestartCount(tempDatabase.dbPath) - restartsBefore,
        ).toBeGreaterThanOrEqual(3);
      } finally {
        db.$client.close();
      }
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("does not wait on a WAL reader during incremental maintenance", async () => {
    const tempDatabase = createTempDatabasePath();
    try {
      const { db } = setupBusyFileDatabaseWithFreelist(tempDatabase);
      const readerDb = new Database(tempDatabase.dbPath, { readonly: true });
      let readerTransactionOpen = false;
      try {
        readerDb.exec("BEGIN");
        readerTransactionOpen = true;
        readerDb.prepare("SELECT COUNT(*) FROM scratch_blobs").get();
        const before = getDatabaseFreelistStats(db.$client);
        const startedAt = performance.now();

        await runSweepWithCheckpointer(db);

        const elapsedMs = performance.now() - startedAt;
        expect(elapsedMs).toBeLessThan(
          DATABASE_MAINTENANCE_BUSY_TIMEOUT_MS + SQLITE_BUSY_HEADROOM_MS,
        );
        expect(getDatabaseFreelistStats(db.$client).freelistCount).toBeLessThan(
          before.freelistCount,
        );
      } finally {
        if (readerTransactionOpen) {
          readerDb.exec("ROLLBACK");
        }
        readerDb.close();
        db.$client.close();
      }
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("returns quickly when a WAL writer blocks incremental maintenance", async () => {
    const tempDatabase = createTempDatabasePath();
    try {
      const { db } = setupBusyFileDatabaseWithFreelist(tempDatabase);
      const writerDb = new Database(tempDatabase.dbPath);
      let writerTransactionOpen = false;
      try {
        writerDb.exec("BEGIN IMMEDIATE");
        writerTransactionOpen = true;
        const before = getDatabaseFreelistStats(db.$client);
        const { logger, warnMessages } = createCapturingServerLogger();
        const startedAt = performance.now();

        await runSweepWithCheckpointer(db, logger);

        const elapsedMs = performance.now() - startedAt;
        expect(elapsedMs).toBeLessThan(
          DATABASE_MAINTENANCE_BUSY_TIMEOUT_MS + SQLITE_BUSY_HEADROOM_MS,
        );
        expect(warnMessages).toHaveLength(1);
        expect(getDatabaseFreelistStats(db.$client).freelistCount).toBe(
          before.freelistCount,
        );
      } finally {
        if (writerTransactionOpen) {
          writerDb.exec("ROLLBACK");
        }
        writerDb.close();
        db.$client.close();
      }
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("reports the pages already reclaimed when a WAL writer blocks a later chunk", async () => {
    const tempDatabase = createTempDatabasePath();
    try {
      const { db } = setupBusyFileDatabaseWithFreelist(tempDatabase);
      const writerDb = new Database(tempDatabase.dbPath);
      const logger = {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      };
      const checkpointer = startWalCheckpointer({ logger: testLogger });
      checkpointer.attach(db.$client);
      try {
        const before = getDatabaseFreelistStats(db.$client);
        expect(before.freelistCount).toBeGreaterThan(256 * 2);

        await runDatabaseMaintenanceSweep({
          db,
          logger,
          walCheckpointer: {
            ...checkpointer,
            async checkpoint(database) {
              await checkpointer.checkpoint(database);
              if (
                !writerDb.inTransaction &&
                getDatabaseFreelistStats(database).freelistCount <
                  before.freelistCount
              ) {
                writerDb.exec("BEGIN IMMEDIATE");
              }
            },
          },
        });

        const after = getDatabaseFreelistStats(db.$client);
        expect(after.freelistCount).toBe(before.freelistCount - 256);
        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
          {
            err: expect.objectContaining({ code: "SQLITE_BUSY" }),
            result: { before, after },
          },
          "Incremental database vacuum stopped early",
        );
      } finally {
        if (writerDb.inTransaction) {
          writerDb.exec("ROLLBACK");
        }
        writerDb.close();
        await checkpointer.stop();
        db.$client.close();
      }
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("returns free pages of incremental plugin databases and never converts auto_vacuum=NONE ones", async () => {
    const tempDatabase = createTempDatabasePath();
    try {
      const open = (name: string, incremental: boolean) => {
        const database = new Database(join(tempDatabase.dbPath, "..", name));
        if (incremental) database.pragma("auto_vacuum = INCREMENTAL");
        database.pragma("journal_mode = WAL");
        database.exec("CREATE TABLE blobs (value BLOB NOT NULL)");
        const insert = database.prepare("INSERT INTO blobs VALUES (?)");
        database.transaction(() => {
          for (let i = 0; i < 2_000; i++) insert.run(Buffer.alloc(4_096));
        })();
        database.exec("DELETE FROM blobs");
        return database;
      };
      const incremental = open("incremental.db", true);
      const none = open("none.db", false);
      const walCheckpointer = startWalCheckpointer({ logger: testLogger });
      walCheckpointer.attach(incremental);
      try {
        const noneFreelist = getDatabaseFreelistStats(none).freelistCount;
        expect(
          getDatabaseFreelistStats(incremental).freelistCount,
        ).toBeGreaterThan(1_024);

        await runPluginDatabaseMaintenanceSweep({
          logger: testLogger,
          walCheckpointer,
          plugins: {
            listOpenPluginDatabases: () => [
              { database: incremental, pluginId: "incremental" },
              { database: none, pluginId: "none" },
            ],
          },
        });

        expect(getDatabaseFreelistStats(incremental).freelistCount).toBe(0);
        expect(getDatabaseAutoVacuumMode(none)).toBe("none");
        expect(getDatabaseFreelistStats(none).freelistCount).toBe(noneFreelist);
      } finally {
        await walCheckpointer.stop();
        incremental.close();
        none.close();
      }
    } finally {
      tempDatabase.cleanup();
    }
  });
});
