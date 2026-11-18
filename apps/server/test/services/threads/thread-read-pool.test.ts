import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { threadScope } from "@bb/domain";
import {
  bumpThreadEventRewriteGeneration,
  createConnection,
  createProject,
  createThread,
  getThreadEventRewriteGeneration,
  insertEvents,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { isThreadTimelineDelta } from "@bb/server-contract";
import { ApiError } from "../../../src/errors.js";
import {
  createThreadReadPool,
  threadReadPoolSize,
} from "../../../src/services/threads/read-pool/thread-read-pool.js";
import { createThreadTimelineWindows } from "../../../src/services/threads/thread-timeline-windows.js";
import { timelineRowHash } from "../../../src/services/threads/timeline-window-tag.js";
import { NotificationHub } from "../../../src/ws/hub.js";
import { withTestHarness } from "../../helpers/test-app.js";

function fixtureWorker(name: string): URL {
  return new URL(`../../fixtures/thread-read-workers/${name}`, import.meta.url);
}

function outlineRequest(threadId: string) {
  return {
    kind: "conversation-outline" as const,
    providers: {},
    rewriteGeneration: 0,
    threadId,
  };
}

function createOnDiskThread(messages: readonly string[]) {
  const dir = mkdtempSync(join(tmpdir(), "bb-thread-read-pool-"));
  const databasePath = join(dir, "bb.db");
  const db = createConnection(databasePath);
  migrate(db);
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  insertEvents(
    db,
    noopNotifier,
    messages.map((text, index) => ({
      threadId: thread.id,
      sequence: index + 1,
      type: "system/manager/user_message" as const,
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ text }),
    })),
  );
  return {
    databasePath,
    db,
    thread,
    cleanup() {
      db.$client.close();
      rmSync(dir, { force: true, recursive: true });
    },
  };
}

describe("thread read pool", () => {
  it("finishes a read on the main thread when its worker dies mid-read", async () => {
    const db = createMigratedConnection();
    const warnings: string[] = [];
    const pool = createThreadReadPool({
      databasePath: ":memory:",
      fallbackDb: db,
      logger: { warn: (_fields, message) => warnings.push(message) },
      pageCacheKib: 1_024,
      size: 1,
      workerUrl: fixtureWorker("exits-on-read.mjs"),
    });
    try {
      await expect(pool.run(outlineRequest("thr_missing"))).resolves.toEqual({
        kind: "conversation-outline",
        outline: null,
      });
      expect(warnings).toEqual([
        "Thread read worker stopped; running its reads on the main thread",
      ]);
      await expect(pool.run(outlineRequest("thr_missing"))).resolves.toEqual({
        kind: "conversation-outline",
        outline: null,
      });
    } finally {
      await pool.close();
      db.$client.close();
    }
  });

  it("rethrows a worker's API errors with their status and code", async () => {
    const db = createMigratedConnection();
    const pool = createThreadReadPool({
      databasePath: ":memory:",
      fallbackDb: db,
      logger: { warn: () => {} },
      pageCacheKib: 1_024,
      size: 1,
      workerUrl: fixtureWorker("rejects-reads.mjs"),
    });
    try {
      const error = await pool.run(outlineRequest("thr_any")).catch((e) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 404,
        body: { code: "thread_not_found", message: "Thread not found" },
      });
    } finally {
      await pool.close();
      db.$client.close();
    }
  });

  it("runs reads on the main thread when its workers cannot start", async () => {
    const db = createMigratedConnection();
    const reasons: unknown[] = [];
    const pool = createThreadReadPool({
      databasePath: join(tmpdir(), "bb-missing-thread-read-db", "bb.db"),
      fallbackDb: db,
      logger: { warn: (fields) => reasons.push(fields.reason) },
      pageCacheKib: 1_024,
      size: 1,
      workerUrl: fixtureWorker("source-worker.mjs"),
    });
    try {
      await expect(pool.run(outlineRequest("thr_missing"))).resolves.toEqual({
        kind: "conversation-outline",
        outline: null,
      });
      expect(reasons).toEqual([
        expect.stringContaining("Cannot open database"),
      ]);
    } finally {
      await pool.close();
      db.$client.close();
    }
  }, 30_000);

  it("drops a worker's cached window only when main's rewrite generation changes", async () => {
    const { databasePath, db, thread, cleanup } = createOnDiskThread([
      "Original message",
    ]);
    const pool = createThreadReadPool({
      databasePath,
      fallbackDb: db,
      logger: { warn: () => {} },
      pageCacheKib: 1_024,
      size: 1,
      workerUrl: fixtureWorker("source-worker.mjs"),
    });
    const readText = async () => {
      const { window } = await pool.run({
        kind: "timeline-window",
        eventBudget: 1_500,
        providers: {},
        rewriteGeneration: getThreadEventRewriteGeneration(thread.id),
        threadId: thread.id,
        window: {
          deferContent: false,
          includeNestedRows: false,
          page: { kind: "latest", segmentLimit: 20 },
        },
      });
      return JSON.stringify(window?.response.rows);
    };
    try {
      expect(await readText()).toContain("Original message");
      db.$client
        .prepare("UPDATE events SET data = ? WHERE thread_id = ?")
        .run(JSON.stringify({ text: "Rewritten message" }), thread.id);

      expect(await readText()).toContain("Original message");
      bumpThreadEventRewriteGeneration(thread.id);
      expect(await readText()).toContain("Rewritten message");
    } finally {
      await pool.close();
      cleanup();
    }
  }, 30_000);

  it("seeds main's row digests with the hashes of the rows a worker returns", async () => {
    await withTestHarness(async (harness) => {
      const { databasePath, db, thread, cleanup } = createOnDiskThread([
        "First message",
        "Second message",
        "Third message",
      ]);
      const pool = createThreadReadPool({
        databasePath,
        fallbackDb: db,
        logger: { warn: () => {} },
        pageCacheKib: 1_024,
        size: 1,
        workerUrl: fixtureWorker("source-worker.mjs"),
      });
      try {
        const windows = createThreadTimelineWindows({
          ...harness.deps,
          db,
          hub: new NotificationHub(),
          threadReads: pool,
        });
        const response = await windows.read(
          thread.id,
          {
            deferContent: false,
            includeNestedRows: false,
            page: { kind: "latest", segmentLimit: 20 },
          },
          undefined,
        );
        if (isThreadTimelineDelta(response)) {
          throw new Error("expected a full timeline window");
        }
        expect(response.rows.length).toBeGreaterThanOrEqual(3);
        for (const row of response.rows) {
          expect(timelineRowHash(row)).toBe(
            createHash("sha256")
              .update(JSON.stringify(row))
              .digest("base64url"),
          );
        }
      } finally {
        await pool.close();
        cleanup();
      }
    });
  }, 30_000);

  it("runs reads in-process without starting a worker at size 0", async () => {
    const db = createMigratedConnection();
    const warnings: string[] = [];
    const pool = createThreadReadPool({
      databasePath: ":memory:",
      fallbackDb: db,
      logger: { warn: (_fields, message) => warnings.push(message) },
      pageCacheKib: 1_024,
      size: 0,
      workerUrl: fixtureWorker("exits-on-read.mjs"),
    });
    try {
      await expect(pool.run(outlineRequest("thr_missing"))).resolves.toEqual({
        kind: "conversation-outline",
        outline: null,
      });
      expect(warnings).toEqual([]);
    } finally {
      await pool.close();
      db.$client.close();
    }
  });

  it.each([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 2],
    [8, 4],
    [16, 4],
  ])("sizes the pool for %i cores at %i workers", (cores, workers) => {
    expect(threadReadPoolSize(cores)).toBe(workers);
  });
});
