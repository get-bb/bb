import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  createConnection,
  migrate,
  noopNotifier,
  upsertHost,
  createProject,
  createThread,
  createReadConnection,
  insertEvents,
} from "@bb/db";
import { turnScope } from "@bb/domain";
import { DatabaseReadService } from "../../src/services/database/database-read-service.js";
import type { ReadTask } from "../../src/services/database/read-worker-contract.js";

const fixture = new URL(
  "../fixtures/slow-database-reader.mjs",
  import.meta.url,
);
const task = (query: string): ReadTask => ({
  kind: "search",
  query,
  limitPerGroup: 20,
  daemonSessions: [],
  planCommands: [],
});
const signal = () => new AbortController().signal;
async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const end = performance.now() + timeoutMs;
  while (!(await check())) {
    if (performance.now() > end)
      throw new Error("The test condition did not occur.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function harness(
  run: (context: {
    databasePath: string;
    db: ReturnType<typeof createConnection>;
    threadId: string;
    logs: Record<string, unknown>[];
    reader: DatabaseReadService;
  }) => Promise<void>,
  options: {
    executionTimeoutMs?: number;
    maxQueue?: number;
    queueTimeoutMs?: number;
    workerEntry?: URL;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "bb-reader-test-"));
  const databasePath = join(dir, "test.db");
  const db = createConnection(databasePath);
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test",
    source: { type: "local_path", hostId: host.id, path: dir },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    title: "before",
  });
  db.$client.pragma("wal_checkpoint(TRUNCATE)");
  const logs: Record<string, unknown>[] = [];
  const reader = new DatabaseReadService({
    databasePath,
    logger: {
      info: (fields: Record<string, unknown>) => {
        logs.push(fields);
      },
    },
    workerEntry: fixture,
    executionTimeoutMs: 700,
    ...options,
  });
  try {
    await run({ databasePath, db, threadId: thread.id, logs, reader });
  } finally {
    await reader.close();
    db.$client.close();
    await rm(dir, { recursive: true, force: true });
  }
}
async function ready(databasePath: string) {
  await waitUntil(async () => {
    try {
      await access(databasePath + ".reader-ready");
      return true;
    } catch {
      return false;
    }
  });
}

describe("database reader lifecycle", () => {
  it("survives native cancellation in an independent process", async () => {
    await harness(async ({ databasePath }) => {
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--conditions=source",
          "--import",
          "tsx",
          fileURLToPath(
            new URL("../fixtures/cancel-native-probe.mjs", import.meta.url),
          ),
          databasePath,
        ],
        { timeout: 10_000 },
      );
      expect(result.stdout).toContain(
        "native cancellation and replacement passed",
      );
      expect(result.stderr).not.toMatch(/FATAL|SIGSEGV|Segmentation fault/);
    });
  }, 15_000);

  it("keeps one snapshot during writes and observes new data in the next transaction", async () => {
    await harness(async ({ reader, db, threadId, databasePath }) => {
      const pending = reader.run(task("snapshot"), signal());
      await ready(databasePath);
      db.$client
        .prepare("UPDATE threads SET title=? WHERE id=?")
        .run("after", threadId);
      const result = JSON.parse((await pending).json);
      expect(result.before).toEqual([{ id: threadId, title: "before" }]);
      expect(result.after).toEqual(result.before);
      expect(
        JSON.parse((await reader.run(task("rows"), signal())).json).rows,
      ).toEqual([{ id: threadId, title: "after" }]);
    });
  });

  it("fails promptly under an exclusive rollback-journal lock and recovers after release", async () => {
    await harness(async ({ reader, db }) => {
      db.$client.pragma("journal_mode=DELETE");
      db.$client.exec("BEGIN EXCLUSIVE");
      const started = performance.now();
      try {
        await expect(reader.run(task("rows"), signal())).rejects.toMatchObject({
          status: 503,
          body: { retryable: true },
        });
      } finally {
        db.$client.exec("ROLLBACK");
      }
      expect(performance.now() - started).toBeLessThan(2000);
      expect(
        JSON.parse((await reader.run(task("rows"), signal())).json).rows,
      ).toHaveLength(1);
    });
  });

  it("rejects fractional deadlines that SQLite would truncate to zero", () => {
    expect(
      () =>
        new DatabaseReadService({
          databasePath: ":memory:",
          executionTimeoutMs: 0.5,
          logger: { info() {} },
        }),
    ).toThrow("Invalid database reader limits");
  });

  it("interrupts native SQL and releases a WAL snapshot after its deadline", async () => {
    await harness(async ({ reader, db, threadId, databasePath }) => {
      const started = performance.now();
      const result = reader.run(task("hold"), signal());
      const rejected = expect(result).rejects.toMatchObject({
        body: { code: "database_read_timeout" },
      });
      await ready(databasePath);
      const writeStart = performance.now();
      db.$client
        .prepare("UPDATE threads SET title=? WHERE id=?")
        .run("after", threadId);
      expect(performance.now() - writeStart).toBeLessThan(250);
      db.$client.pragma("busy_timeout=0");
      expect(db.$client.pragma("wal_checkpoint(TRUNCATE)")).toMatchObject([
        { busy: 1 },
      ]);
      await rejected;
      await reader.close();
      expect(performance.now() - started).toBeLessThan(2500);
      expect(db.$client.pragma("wal_checkpoint(TRUNCATE)")).toMatchObject([
        { busy: 0, log: 0, checkpointed: 0 },
      ]);
    });
  });

  it("bounds the queue, cancels queued and active requests, and replaces the reader", async () => {
    await harness(
      async ({ reader, databasePath, logs }) => {
        const activeAbort = new AbortController();
        const slow = reader.run(task("slow"), activeAbort.signal);
        const slowRejected = expect(slow).rejects.toMatchObject({
          body: { code: "database_read_canceled" },
        });
        await ready(databasePath);
        const queuedAbort = new AbortController();
        const queued = reader.run(task("rows"), queuedAbort.signal);
        const queuedRejected = expect(queued).rejects.toMatchObject({
          body: { code: "database_read_canceled" },
        });
        await expect(reader.run(task("rows"), signal())).rejects.toMatchObject({
          body: { code: "database_read_queue_full" },
        });
        queuedAbort.abort();
        await queuedRejected;
        activeAbort.abort();
        await slowRejected;
        expect(
          JSON.parse((await reader.run(task("rows"), signal())).json).rows,
        ).toHaveLength(1);
        expect(
          logs.filter((row) => row.outcome === "ok").at(-1)?.workerGeneration,
        ).toBe(2);
        expect(logs.filter((row) => row.outcome === "canceled")).toHaveLength(
          2,
        );
      },
      { maxQueue: 1 },
    );
  });

  it("expires queued work without executing it", async () => {
    await harness(
      async ({ reader, databasePath }) => {
        // Warm the reader so the queue deadline excludes its startup.
        await reader.run(task("rows"), signal());
        const slow = reader.run(task("slow"), signal());
        const slowRejected = expect(slow).rejects.toMatchObject({
          body: { code: "database_read_timeout" },
        });
        await ready(databasePath);
        await expect(reader.run(task("crash"), signal())).rejects.toMatchObject(
          { body: { code: "database_read_queue_timeout" } },
        );
        await slowRejected;
        expect(
          JSON.parse((await reader.run(task("rows"), signal())).json).rows,
        ).toHaveLength(1);
      },
      { queueTimeoutMs: 400 },
    );
  });

  it("rejects pending work after a crash and starts a new reader on demand", async () => {
    await harness(async ({ reader }) => {
      await reader.run(task("rows"), signal());
      const crashed = reader.run(task("crash"), signal());
      const queued = reader.run(task("rows"), signal());
      await expect(crashed).rejects.toMatchObject({
        body: { code: "database_read_failed" },
      });
      await expect(queued).rejects.toMatchObject({
        body: { code: "database_read_failed" },
      });
      expect(
        JSON.parse((await reader.run(task("rows"), signal())).json).rows,
      ).toHaveLength(1);
    });
  });

  it("rejects invalid worker messages and keeps failures private", async () => {
    await harness(async ({ reader, logs }) => {
      await expect(
        reader.run(task("malformed"), signal()),
      ).rejects.toMatchObject({ body: { code: "database_read_failed" } });
      await reader.run(task("rows"), signal());
      expect(JSON.stringify(logs)).not.toContain("malformed");
      expect(JSON.stringify(logs)).not.toContain("before");
      const complete = logs.find((row) => row.outcome === "ok");
      expect(complete).toEqual(
        expect.objectContaining({
          queueWaitMs: expect.any(Number),
          sqlMs: expect.any(Number),
          processingMs: expect.any(Number),
          serializationMs: expect.any(Number),
          totalMs: expect.any(Number),
        }),
      );
    });
  });

  it("rejects startup failures and shutdown work without leaving pending promises", async () => {
    const reader = new DatabaseReadService({
      databasePath: "/missing/bb-reader.db",
      workerEntry: fixture,
      logger: { info() {} },
      startupTimeoutMs: 500,
    });
    try {
      await expect(reader.run(task("rows"), signal())).rejects.toMatchObject({
        body: { code: "database_read_failed" },
      });
    } finally {
      await reader.close();
    }
    await expect(reader.run(task("rows"), signal())).rejects.toMatchObject({
      body: { code: "database_read_closed" },
    });
    await harness(async ({ reader, databasePath }) => {
      const result = reader.run(task("slow"), signal());
      const rejected = expect(result).rejects.toMatchObject({
        body: { code: "database_read_closed" },
      });
      await ready(databasePath);
      const one = reader.close();
      const two = reader.close();
      expect(one).toBe(two);
      await rejected;
      await one;
    });
  });

  it("opens readers without creating files or changing the schema", async () => {
    await harness(async ({ db, databasePath }) => {
      const version = db.$client.pragma("schema_version", { simple: true });
      const reader = createReadConnection(databasePath);
      try {
        expect(reader.$client.readonly).toBe(true);
        expect(reader.$client.pragma("journal_mode", { simple: true })).toBe(
          "wal",
        );
        expect(reader.$client.pragma("query_only", { simple: true })).toBe(1);
        expect(() =>
          reader.$client.exec("CREATE TABLE forbidden(id)"),
        ).toThrow();
      } finally {
        reader.$client.close();
      }
      expect(db.$client.pragma("schema_version", { simple: true })).toBe(
        version,
      );
      expect(() => createReadConnection(databasePath + ".missing")).toThrow();
    });
  });
});

describe("retention worker transactions", () => {
  it("rolls back interrupted outputs and cursors, then commits a successful retry", async () => {
    await harness(async ({ db, databasePath, threadId }) => {
      const maintenance = new DatabaseReadService({
        databasePath,
        mode: "maintenance",
        executionTimeoutMs: 100,
        logger: { info() {} },
        workerEntry: new URL(
          "../../dist/database-read-worker.js",
          import.meta.url,
        ),
        extensionPath: new URL(
          "../../dist/database-native/sqlite-query-deadline.so",
          import.meta.url,
        ).pathname,
      });
      try {
        insertEvents(db, noopNotifier, [
          {
            threadId,
            sequence: 1,
            type: "item/completed",
            scope: turnScope("turn-1"),
            providerThreadId: "provider-1",
            itemId: "command-1",
            itemKind: "commandExecution",
            parentToolCallId: null,
            data: JSON.stringify({
              item: {
                id: "command-1",
                type: "commandExecution",
                aggregatedOutput: "x".repeat(100_000),
              },
            }),
          },
        ]);
        const before = db.$client
          .prepare("SELECT data FROM events WHERE thread_id=?")
          .all(threadId);
        const cursorsBefore = db.$client
          .prepare("SELECT * FROM maintenance_scan_cursors")
          .all();
        db.$client.exec(
          "CREATE TRIGGER slow_retention BEFORE UPDATE OF data ON events BEGIN SELECT (WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n<100000000) SELECT sum(n) FROM x); END",
        );
        const args = {
          createdBefore: Date.now() + 1,
          truncatedAt: Date.now(),
          limit: 250,
        };
        await expect(maintenance.truncateOutputs(args)).rejects.toMatchObject({
          body: { code: "database_read_timeout" },
        });
        // Waiting for a following read also proves the write connection released its lock.
        expect(
          db.$client
            .prepare("SELECT data FROM events WHERE thread_id=?")
            .all(threadId),
        ).toEqual(before);
        expect(
          db.$client.prepare("SELECT * FROM maintenance_scan_cursors").all(),
        ).toEqual(cursorsBefore);
        db.$client.exec("DROP TRIGGER slow_retention");
        const result = await maintenance.truncateOutputs(args);
        expect(result.commandExecutionOutputs).toBe(1);
        expect(
          db.$client
            .prepare(
              "SELECT length(data) AS size FROM events WHERE thread_id=?",
            )
            .get(threadId),
        ).toMatchObject({ size: expect.any(Number) });
        expect(
          db.$client
            .prepare("SELECT data FROM events WHERE thread_id=?")
            .all(threadId),
        ).not.toEqual(before);
        expect(
          db.$client.prepare("SELECT * FROM maintenance_scan_cursors").all(),
        ).not.toEqual(cursorsBefore);
      } finally {
        await maintenance.close();
      }
    });
  });
});
