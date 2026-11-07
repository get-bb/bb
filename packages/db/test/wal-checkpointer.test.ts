import Database from "better-sqlite3";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConnection } from "../src/connection.js";
import {
  startWalCheckpointer,
  type WalCheckpointLogger,
} from "../src/wal-checkpointer.js";

const PAGE_SIZE = 512;

interface CheckpointRow {
  busy: number;
  log: number;
  checkpointed: number;
}

class CapturingLogger implements WalCheckpointLogger {
  readonly infos: string[] = [];
  readonly warnings: string[] = [];
  info(_fields: object, message: string): void {
    this.infos.push(message);
  }
  warn(_fields: object, message: string): void {
    this.warnings.push(message);
  }
}

async function withDatabase(
  run: (db: ReturnType<typeof createConnection>, path: string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bb-wal-checkpointer-"));
  const path = join(dir, "bb.db");
  const setup = new Database(path);
  setup.pragma(`page_size = ${PAGE_SIZE}`);
  setup.pragma("journal_mode = WAL");
  setup.exec("CREATE TABLE blobs (id INTEGER PRIMARY KEY, body BLOB NOT NULL)");
  setup.close();
  const db = createConnection(path);
  try {
    await run(db, path);
  } finally {
    if (db.$client.open) db.$client.close();
    rmSync(dir, { force: true, recursive: true });
  }
}

function walFileFrames(path: string): number {
  return (statSync(`${path}-wal`).size - 32) / (PAGE_SIZE + 24);
}

function walRestartCount(path: string): number {
  const header = Buffer.alloc(16);
  const fd = openSync(`${path}-wal`, "r");
  try {
    readSync(fd, header, 0, header.length, 0);
  } finally {
    closeSync(fd);
  }
  return header.readUInt32BE(12);
}

describe("startWalCheckpointer", () => {
  it("keeps the WAL bounded under back-to-back writes that never checkpoint inline", async () => {
    await withDatabase(async (db, path) => {
      const logger = new CapturingLogger();
      const checkpointer = startWalCheckpointer({ logger });
      try {
        checkpointer.attach(db.$client);
        await checkpointer.checkpoint(db.$client);
        expect(db.$client.pragma("wal_autocheckpoint", { simple: true })).toBe(
          0,
        );
        const insert = db.$client.prepare(
          `INSERT INTO blobs (body) VALUES (randomblob(${PAGE_SIZE / 2}))`,
        );
        const writeBatch = db.$client.transaction(() => {
          for (let row = 0; row < 32; row += 1) insert.run();
        });
        writeBatch();
        const restartsBefore = walRestartCount(path);
        const deadline = performance.now() + 10_000;
        while (
          walRestartCount(path) - restartsBefore < 3 &&
          performance.now() < deadline
        ) {
          writeBatch();
          await new Promise<void>((resolve) => setImmediate(resolve));
        }

        expect(walRestartCount(path) - restartsBefore).toBeGreaterThanOrEqual(
          3,
        );
        expect(logger.warnings).toEqual([]);
      } finally {
        await checkpointer.stop();
      }
    });
  });

  it("waits out a reader that pins the WAL instead of asking the main thread to checkpoint", async () => {
    await withDatabase(async (db, path) => {
      const logger = new CapturingLogger();
      const checkpointer = startWalCheckpointer({ logger });
      const reader = new Database(path, { readonly: true });
      try {
        checkpointer.attach(db.$client);
        await checkpointer.checkpoint(db.$client);
        const insert = db.$client.prepare(
          `INSERT INTO blobs (body) VALUES (randomblob(${PAGE_SIZE / 2}))`,
        );
        const writeBatch = db.$client.transaction(() => {
          for (let row = 0; row < 32; row += 1) insert.run();
        });
        writeBatch();
        reader.exec("BEGIN");
        reader.prepare("SELECT count(*) FROM blobs").get();
        const pinnedUntil = performance.now() + 10_000;
        while (
          walFileFrames(path) <= 32_768 &&
          performance.now() < pinnedUntil
        ) {
          writeBatch();
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        const [pinned] = db.$client.pragma(
          "wal_checkpoint(PASSIVE)",
        ) as CheckpointRow[];
        expect(pinned?.log).toBeGreaterThan(32_768);
        expect(pinned?.checkpointed).toBeLessThan(pinned?.log ?? 0);

        expect(logger.infos).not.toContain(
          "Sustained writes outpaced the WAL checkpoint worker; checkpointed the WAL tail between tasks",
        );

        reader.exec("COMMIT");
        const restartsBefore = walRestartCount(path);
        const deadline = performance.now() + 10_000;
        while (
          walRestartCount(path) === restartsBefore &&
          performance.now() < deadline
        ) {
          writeBatch();
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
        }
        expect(walRestartCount(path)).toBeGreaterThan(restartsBefore);
      } finally {
        if (reader.inTransaction) reader.exec("COMMIT");
        reader.close();
        await checkpointer.stop();
      }
    });
  });

  it("checkpoints the remaining WAL on stop and hands checkpoints back to commits", async () => {
    await withDatabase(async (db) => {
      const checkpointer = startWalCheckpointer({
        logger: new CapturingLogger(),
      });
      checkpointer.attach(db.$client);
      await checkpointer.checkpoint(db.$client);
      const insert = db.$client.prepare(
        "INSERT INTO blobs (body) VALUES (randomblob(400))",
      );
      for (let row = 0; row < 200; row += 1) insert.run();

      await checkpointer.stop();

      expect(db.$client.pragma("wal_autocheckpoint", { simple: true })).toBe(
        1000,
      );
      const [result] = db.$client.pragma(
        "wal_checkpoint(PASSIVE)",
      ) as CheckpointRow[];
      expect(result?.log).toBeGreaterThan(0);
      expect(result?.checkpointed).toBe(result?.log);
    });
  });

  it("releases the database files once detach resolves", async () => {
    await withDatabase(async (db, path) => {
      const checkpointer = startWalCheckpointer({
        logger: new CapturingLogger(),
      });
      try {
        checkpointer.attach(db.$client);
        await checkpointer.checkpoint(db.$client);
        db.$client
          .prepare("INSERT INTO blobs (body) VALUES (randomblob(400))")
          .run();
        db.$client.close();
        expect(existsSync(`${path}-wal`)).toBe(true);

        await checkpointer.detach(db.$client);

        expect(existsSync(`${path}-wal`)).toBe(false);
      } finally {
        await checkpointer.stop();
      }
    });
  });

  it.skipIf(process.platform === "win32")(
    "leaves commits checkpointing when the worker cannot open the database",
    async () => {
      await withDatabase(async (db, path) => {
        unlinkSync(path);
        const logger = new CapturingLogger();
        const checkpointer = startWalCheckpointer({ logger });
        try {
          checkpointer.attach(db.$client);

          await checkpointer.checkpoint(db.$client);

          expect(logger.warnings).toEqual([
            "WAL checkpoint worker dropped a database; its commits checkpoint the WAL",
          ]);
          expect(
            db.$client.pragma("wal_autocheckpoint", { simple: true }),
          ).toBe(1000);
        } finally {
          await checkpointer.stop();
        }
      });
    },
  );
});
