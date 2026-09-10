import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, migrate } from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import { startDatabaseCheckpointWorker } from "../../src/services/system/database-checkpoint.js";

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bb-checkpoint-"));
  const databasePath = join(directory, "bb.db");
  const db = createConnection(databasePath);
  migrate(db);
  return {
    db,
    databasePath,
    directory,
    logger: { info: vi.fn(), warn: vi.fn() },
  };
}

describe("background database checkpoints", () => {
  it("checkpoints committed writes and restores the writer setting on shutdown", async () => {
    const args = setup();
    const original = args.db.$client.pragma("wal_autocheckpoint", {
      simple: true,
    });
    const worker = await startDatabaseCheckpointWorker(args);
    try {
      expect(worker).not.toBeNull();
      expect(
        args.db.$client.pragma("wal_autocheckpoint", { simple: true }),
      ).toBe(0);
      args.db.$client.exec(
        "CREATE TABLE checkpoint_fixture (id INTEGER PRIMARY KEY, payload BLOB)",
      );
      args.db.$client
        .prepare("INSERT INTO checkpoint_fixture VALUES (1, zeroblob(?))")
        .run(4 * 1024 * 1024);
      const pending = worker!.checkpoint();
      expect(worker!.checkpoint()).toBe(pending);
      const result = await pending;
      expect(result.log).toBeGreaterThan(1000);
      expect(result.checkpointed).toBe(result.log);
      expect(result.busy).toBe(0);
      await worker!.stop();
      await worker!.stop();
      expect(
        args.db.$client.pragma("wal_autocheckpoint", { simple: true }),
      ).toBe(original);
      await expect(worker!.checkpoint()).rejects.toThrow("unavailable");
      expect(args.logger.warn).not.toHaveBeenCalled();
    } finally {
      await worker?.stop();
      args.db.$client.close();
      rmSync(args.directory, { recursive: true, force: true });
    }
  });

  it("retries a partial checkpoint after a reader releases its snapshot", async () => {
    const args = setup();
    args.db.$client.exec(
      "CREATE TABLE checkpoint_fixture (id INTEGER PRIMARY KEY, payload BLOB)",
    );
    args.db.$client.exec(
      "INSERT INTO checkpoint_fixture VALUES (1, zeroblob(4096))",
    );
    const worker = await startDatabaseCheckpointWorker(args);
    const reader = new Database(args.databasePath, { readonly: true });
    try {
      expect(worker).not.toBeNull();
      await worker!.checkpoint();
      reader.exec("BEGIN");
      reader.prepare("SELECT payload FROM checkpoint_fixture").get();
      args.db.$client.exec(
        "UPDATE checkpoint_fixture SET payload = zeroblob(8192)",
      );
      const blocked = await worker!.checkpoint();
      expect(blocked.checkpointed).toBeLessThan(blocked.log);
      reader.exec("ROLLBACK");
      const retried = await worker!.checkpoint();
      expect(retried.checkpointed).toBe(retried.log);
      expect(args.logger.warn).not.toHaveBeenCalled();
    } finally {
      reader.close();
      await worker?.stop();
      args.db.$client.close();
      rmSync(args.directory, { recursive: true, force: true });
    }
  });

  it("keeps automatic checkpoints when the worker cannot open the database", async () => {
    const args = setup();
    const original = args.db.$client.pragma("wal_autocheckpoint", {
      simple: true,
    });
    try {
      const worker = await startDatabaseCheckpointWorker({
        ...args,
        databasePath: join(args.directory, "missing.db"),
      });
      expect(worker).toBeNull();
      expect(
        args.db.$client.pragma("wal_autocheckpoint", { simple: true }),
      ).toBe(original);
      expect(args.logger.warn).toHaveBeenCalledOnce();
    } finally {
      args.db.$client.close();
      rmSync(args.directory, { recursive: true, force: true });
    }
  });
});
