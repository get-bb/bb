import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import type { DbConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  dropDeferredLegacyTables,
  getDatabaseAutoVacuumMode,
  getDatabaseFreelistStats,
  getDatabaseMaintenanceActivity,
  isDatabaseMaintenanceIdle,
  listDeferredLegacyTables,
  runIncrementalVacuum,
} from "../../src/data/maintenance.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread, markThreadDeleted } from "../../src/data/threads.js";
import { createMigratedConnection } from "../../src/testing.js";

const TEST_INCREMENTAL_VACUUM_MAX_PAGES = 128;

interface TempDatabasePath {
  dbPath: string;
  cleanup(): void;
}

interface ProjectNameRow {
  name: string;
}

const TEST_DEFERRED_LEGACY_TABLE_NAMES = [
  "client_turn_requests",
  "environment_operations",
  "host_daemon_command_attempts",
  "host_daemon_commands",
  "project_operations",
  "thread_operations",
];

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "maintenance-host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "maintenance-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/project" },
  });
  return { db, host, project };
}

function createTempDatabasePath(): TempDatabasePath {
  const dir = mkdtempSync(join(tmpdir(), "bb-db-maintenance-"));
  return {
    cleanup(): void {
      rmSync(dir, { force: true, recursive: true });
    },
    dbPath: join(dir, "bb.db"),
  };
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

function readProjectName(
  db: DbConnection,
  projectId: string,
): string | undefined {
  return db.$client
    .prepare<[string], ProjectNameRow>("SELECT name FROM projects WHERE id = ?")
    .get(projectId)?.name;
}

describe("database maintenance", () => {
  it("detects active work that should block maintenance", () => {
    const { db, project } = setup();
    const idleActivity = getDatabaseMaintenanceActivity(db);
    expect(isDatabaseMaintenanceIdle(idleActivity)).toBe(true);

    const activeThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });
    const threadActivity = getDatabaseMaintenanceActivity(db);
    expect(threadActivity.activeThreadCount).toBe(1);
    expect(isDatabaseMaintenanceIdle(threadActivity)).toBe(false);

    markThreadDeleted(db, noopNotifier, { threadId: activeThread.id });
    expect(isDatabaseMaintenanceIdle(getDatabaseMaintenanceActivity(db))).toBe(
      true,
    );
  });

  it("drops deferred legacy queue tables without touching current data", () => {
    const { db, project } = setup();
    createDeferredLegacyTables(db);
    expect(listDeferredLegacyTables(db)).toEqual(
      [...TEST_DEFERRED_LEGACY_TABLE_NAMES].sort(),
    );

    const result = dropDeferredLegacyTables(db);

    expect(result.droppedTables).toEqual(
      [...TEST_DEFERRED_LEGACY_TABLE_NAMES].sort(),
    );
    expect(listDeferredLegacyTables(db)).toEqual([]);
    expect(readProjectName(db, project.id)).toBe("maintenance-project");
  });

  it("keeps fresh file-backed databases in incremental auto-vacuum mode after reopen", () => {
    const tempDatabase = createTempDatabasePath();
    try {
      const db = createConnection(tempDatabase.dbPath);
      try {
        migrate(db);
        expect(getDatabaseAutoVacuumMode(db.$client)).toBe("incremental");
      } finally {
        db.$client.close();
      }

      const reopenedDb = createConnection(tempDatabase.dbPath);
      try {
        migrate(reopenedDb);
        expect(getDatabaseAutoVacuumMode(reopenedDb.$client)).toBe("incremental");
      } finally {
        reopenedDb.$client.close();
      }
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("reclaims freed pages incrementally without a full VACUUM", () => {
    const { db } = setup();
    expect(getDatabaseAutoVacuumMode(db.$client)).toBe("incremental");

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
    insertMany(3_000);
    db.$client.exec("DELETE FROM scratch_blobs");

    const before = getDatabaseFreelistStats(db.$client);
    expect(before.freelistCount).toBeGreaterThan(0);

    const preparedSql: string[] = [];
    const raw = db.$client;
    const originalPrepare = raw.prepare.bind(raw);
    Object.defineProperty(raw, "prepare", {
      configurable: true,
      value: (source: string) => {
        preparedSql.push(source);
        return originalPrepare(source);
      },
      writable: true,
    });
    let result: ReturnType<typeof runIncrementalVacuum>;
    try {
      result = runIncrementalVacuum(db.$client, {
        maxPages: TEST_INCREMENTAL_VACUUM_MAX_PAGES,
      });
    } finally {
      Object.defineProperty(raw, "prepare", {
        configurable: true,
        value: originalPrepare,
        writable: true,
      });
    }
    const reclaimedPages =
      result.before.freelistCount - result.after.freelistCount;

    expect(result.before.freelistCount).toBe(before.freelistCount);
    expect(result.after.freelistCount).toBeLessThan(before.freelistCount);
    expect(reclaimedPages).toBeLessThanOrEqual(
      TEST_INCREMENTAL_VACUUM_MAX_PAGES,
    );
    expect(getDatabaseFreelistStats(db.$client).freelistCount).toBeLessThan(
      before.freelistCount,
    );
    expect(preparedSql.some((source) => source.includes("dbstat"))).toBe(false);
    expect(getDatabaseAutoVacuumMode(db.$client)).toBe("incremental");
  });
});
