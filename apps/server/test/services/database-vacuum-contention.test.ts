import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createConnection,
  getDatabaseFreelistStats,
  startWalCheckpointer,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import {
  runDatabaseMaintenanceSweep,
  runPluginDatabaseMaintenanceSweep,
} from "../../src/services/system/periodic-sweeps.js";

describe.each(["core", "plugin"] as const)(
  "%s vacuum contention",
  (surface) => {
    it.each(["first chunk", "later chunk", "unexpected error"] as const)(
      "reports %s without losing the outcome",
      async (failure) => {
        const directory = mkdtempSync(join(tmpdir(), "bb-vacuum-contention-"));
        const databasePath = join(directory, "maintenance.db");
        const template = createMigratedConnection();
        try {
          await template.$client.backup(databasePath);
        } finally {
          template.$client.close();
        }
        const db = createConnection(databasePath);
        const writer = new Database(databasePath);
        const logger = {
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        };
        const checkpointer = startWalCheckpointer({ logger });
        checkpointer.attach(db.$client);
        let interrupted = false;
        try {
          db.$client.exec("CREATE TABLE vacuum_payload (payload BLOB)");
          const insert = db.$client.prepare(
            "INSERT INTO vacuum_payload VALUES (zeroblob(8192))",
          );
          db.$client.transaction(() => {
            for (let row = 0; row < 1200; row += 1) insert.run();
          })();
          db.$client.exec("DELETE FROM vacuum_payload");
          const before = getDatabaseFreelistStats(db.$client);
          expect(before.freelistCount).toBeGreaterThan(1024);
          if (failure === "first chunk") writer.exec("BEGIN IMMEDIATE");
          const unexpectedError = new Error("Checkpoint interrupted");
          const walCheckpointer = {
            ...checkpointer,
            async checkpoint(database: Database.Database): Promise<void> {
              await checkpointer.checkpoint(database);
              if (
                failure !== "first chunk" &&
                !interrupted &&
                getDatabaseFreelistStats(database).freelistCount <
                  before.freelistCount
              ) {
                interrupted = true;
                if (failure === "unexpected error") throw unexpectedError;
                writer.exec("BEGIN IMMEDIATE");
              }
            },
          };

          if (surface === "core") {
            await runDatabaseMaintenanceSweep({ db, logger, walCheckpointer });
          } else {
            await runPluginDatabaseMaintenanceSweep({
              logger,
              walCheckpointer,
              plugins: {
                listOpenPluginDatabases: () => [
                  { database: db.$client, pluginId: "contention-test" },
                ],
              },
            });
          }

          const after = getDatabaseFreelistStats(db.$client);
          expect(after.freelistCount).toBeGreaterThan(0);
          if (failure === "first chunk") {
            expect(after).toEqual(before);
          } else {
            expect(interrupted).toBe(true);
            expect(after.freelistCount).toBeLessThan(before.freelistCount);
          }
          if (writer.inTransaction) writer.exec("ROLLBACK");
          expect(db.$client.pragma("integrity_check", { simple: true })).toBe(
            "ok",
          );
          expect(logger.info).not.toHaveBeenCalled();
          expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              ...(surface === "plugin" ? { pluginId: "contention-test" } : {}),
              err:
                failure === "unexpected error"
                  ? unexpectedError
                  : expect.objectContaining({ code: "SQLITE_BUSY" }),
              ...(failure === "later chunk"
                ? { result: { before, after } }
                : {}),
            }),
            failure === "later chunk"
              ? "Incremental database vacuum stopped early"
              : "Incremental database vacuum failed",
          );
        } finally {
          if (writer.inTransaction) writer.exec("ROLLBACK");
          writer.close();
          await checkpointer.stop();
          db.$client.close();
          rmSync(directory, { recursive: true, force: true });
        }
      },
    );
  },
);
