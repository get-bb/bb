import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  acquireProjectAttachmentOwnership,
  claimProjectAttachments,
  createPromptHistoryEntry,
  deleteQueuedThreadMessage,
  ensureProjectAttachmentBackfill,
  events,
  getProjectAttachment,
  insertEvents,
  PROJECT_ATTACHMENT_GRACE_MS,
  projectAttachmentBackfills,
  projectAttachments,
  projectAttachmentThreads,
  promptHistoryEntries,
  queuedThreadMessages,
  threads,
  updateQueuedThreadMessage,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  canonicalProjectAttachmentPath,
  threadScope,
  type PromptInput,
} from "@bb/domain";
import {
  copyProjectAttachments,
  storeAttachment,
  validatePromptAttachmentReferences,
} from "../../src/services/projects/attachments.js";
import {
  pruneProjectAttachments,
  runProjectAttachmentBackfill,
} from "../../src/services/projects/attachment-maintenance.js";
import {
  seedQueuedMessage,
  seedThread,
  seedThreadFixture,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const input = (path: string): PromptInput[] => [{ type: "localFile", path }];

async function completeBackfill(h: TestAppHarness, projectId: string) {
  for (let count = 0; count < 200; count += 1) {
    await runProjectAttachmentBackfill(h.deps);
    const state = h.db
      .select()
      .from(projectAttachmentBackfills)
      .where(eq(projectAttachmentBackfills.projectId, projectId))
      .get();
    if (state?.error) throw new Error(state.error);
    if (state?.phase === "done") return;
  }
  throw new Error("Backfill did not complete");
}

async function upload(
  h: TestAppHarness,
  projectId: string,
  name = "notes.txt",
) {
  return storeAttachment(
    h.db,
    h.config.dataDir,
    projectId,
    new File([name], name, { type: "text/plain" }),
  );
}

function ageUploads(h: TestAppHarness, projectId: string) {
  h.db
    .update(projectAttachments)
    .set({ createdAt: Date.now() - PROJECT_ATTACHMENT_GRACE_MS - 1000 })
    .where(eq(projectAttachments.projectId, projectId))
    .run();
}

describe("project attachment accounting", () => {
  it("retries after a failure selecting the next backfill project", async () => {
    await withTestHarness(async (h) => {
      const { project } = seedThreadFixture(h);
      h.db.$client.exec(
        "ALTER TABLE project_attachment_backfills RENAME TO unavailable_attachment_backfills",
      );
      try {
        await expect(
          runProjectAttachmentBackfill(h.deps),
        ).resolves.toBeUndefined();
      } finally {
        h.db.$client.exec(
          "ALTER TABLE unavailable_attachment_backfills RENAME TO project_attachment_backfills",
        );
      }
      await completeBackfill(h, project.id);
    });
  });

  it("retains original and edited queue attachments until the last owning thread is hard-deleted", async () => {
    await withTestHarness(async (h) => {
      const { project, thread } = seedThreadFixture(h);
      const a = await upload(h, project.id, "a.txt");
      const b = await upload(h, project.id, "b.txt");
      const queued = seedQueuedMessage(h.deps, {
        threadId: thread.id,
        content: input(a.path),
        sendAt: Date.now() + 30 * 24 * 3600_000,
      });
      const result = updateQueuedThreadMessage(h.db, h.hub, {
        id: queued.id,
        threadId: thread.id,
        expectedUpdatedAt: queued.updatedAt,
        content: input(b.path),
      });
      expect(result.kind).toBe("updated");
      acquireProjectAttachmentOwnership(h.db, thread.id, input(`./${b.path}`));
      expect(h.db.select().from(projectAttachmentThreads).all()).toHaveLength(
        2,
      );
      expect(
        updateQueuedThreadMessage(h.db, h.hub, {
          id: queued.id,
          threadId: thread.id,
          expectedUpdatedAt: queued.updatedAt,
          content: input("missing.txt"),
        }).kind,
      ).toBe("stale");
      deleteQueuedThreadMessage(h.db, h.hub, queued.id);
      const fork = seedThread(h.deps, {
        projectId: project.id,
        sourceThreadId: thread.id,
        originKind: "fork",
      });
      h.db
        .update(threads)
        .set({ deletedAt: Date.now() })
        .where(eq(threads.id, thread.id))
        .run();
      await completeBackfill(h, project.id);
      ageUploads(h, project.id);
      expect(
        (await pruneProjectAttachments(h.deps, project.id)).reclaimedCount,
      ).toBe(0);
      h.db.delete(threads).where(eq(threads.id, thread.id)).run();
      expect(
        (await pruneProjectAttachments(h.deps, project.id)).reclaimedCount,
      ).toBe(0);
      h.db.delete(threads).where(eq(threads.id, fork.id)).run();
      expect(
        (await pruneProjectAttachments(h.deps, project.id)).reclaimedCount,
      ).toBe(2);
      expect(h.db.select().from(projectAttachments).all()).toHaveLength(0);
    });
  });

  it("acquires ownership through event/history persistence and keeps it after pruning", async () => {
    await withTestHarness(async (h) => {
      const { project, thread } = seedThreadFixture(h);
      const file = await upload(h, project.id);
      insertEvents(h.db, h.hub, [
        {
          threadId: thread.id,
          sequence: 1,
          type: "client/turn/requested",
          data: JSON.stringify({ input: input(file.path) }),
          scope: threadScope(),
          environmentId: null,
          providerThreadId: null,
          itemId: null,
          itemKind: null,
          parentToolCallId: null,
        },
      ]);
      createPromptHistoryEntry(h.db, {
        projectId: project.id,
        threadId: thread.id,
        scope: "thread",
        requestSequence: 1,
        input: input(file.path),
      });
      h.db.delete(events).where(eq(events.threadId, thread.id)).run();
      h.db
        .delete(promptHistoryEntries)
        .where(eq(promptHistoryEntries.threadId, thread.id))
        .run();
      await completeBackfill(h, project.id);
      ageUploads(h, project.id);
      expect(
        (await pruneProjectAttachments(h.deps, project.id)).reclaimedCount,
      ).toBe(0);
      const before = h.db.select().from(events).all().length;
      expect(() =>
        insertEvents(h.db, h.hub, [
          {
            threadId: thread.id,
            sequence: 2,
            type: "client/turn/requested",
            data: JSON.stringify({ input: input("missing.txt") }),
            scope: threadScope(),
            environmentId: null,
            providerThreadId: null,
            itemId: null,
            itemKind: null,
            parentToolCallId: null,
          },
        ]),
      ).toThrow("not uploaded");
      expect(h.db.select().from(events).all()).toHaveLength(before);
    });
  });

  it("serializes deletion against ownership and prevents copy from overwriting a claimed file", async () => {
    await withTestHarness(async (h) => {
      const { project, thread } = seedThreadFixture(h);
      const survivor = await upload(h, project.id, "survivor.txt");
      const doomed = await upload(h, project.id, "doomed.txt");
      const source = seedThreadFixture(h);
      await mkdir(join(h.config.dataDir, "attachments", source.project.id), {
        recursive: true,
      });
      await writeFile(
        join(h.config.dataDir, "attachments", source.project.id, doomed.path),
        "replacement",
      );
      await completeBackfill(h, project.id);
      ageUploads(h, project.id);
      acquireProjectAttachmentOwnership(h.db, thread.id, input(survivor.path));
      const claimed = claimProjectAttachments(h.db, project.id, Date.now());
      expect(claimed.map((row) => row.storedPath)).toEqual([doomed.path]);
      expect(() =>
        seedQueuedMessage(h.deps, {
          threadId: thread.id,
          content: input(doomed.path),
        }),
      ).toThrow("expired");
      expect(h.db.select().from(queuedThreadMessages).all()).toHaveLength(0);
      await expect(
        copyProjectAttachments(
          h.db,
          h.config.dataDir,
          source.project.id,
          project.id,
          [doomed.path],
        ),
      ).rejects.toThrow("expired");
      expect(
        await readFile(
          join(h.config.dataDir, "attachments", project.id, doomed.path),
          "utf8",
        ),
      ).toBe("doomed.txt");
      expect(
        (await pruneProjectAttachments(h.deps, project.id)).reclaimedCount,
      ).toBe(1);
      expect(
        await readFile(
          join(h.config.dataDir, "attachments", project.id, survivor.path),
          "utf8",
        ),
      ).toBe("survivor.txt");
    });
  });

  it("resumes claimed deletion after unlink failure and tolerates already removed bytes", async () => {
    await withTestHarness(async (h) => {
      const { project } = seedThreadFixture(h);
      const file = await upload(h, project.id);
      await completeBackfill(h, project.id);
      ageUploads(h, project.id);
      const path = join(h.config.dataDir, "attachments", project.id, file.path);
      await rm(path);
      await mkdir(path);
      await writeFile(join(path, "child"), "force unlink failure");
      const failed = await pruneProjectAttachments(h.deps, project.id);
      expect(failed.failedCount).toBe(1);
      expect(
        getProjectAttachment(h.db, project.id, file.path)?.deletionClaimedAt,
      ).not.toBeNull();
      await rm(path, { recursive: true });
      expect(
        (await pruneProjectAttachments(h.deps, project.id)).reclaimedCount,
      ).toBe(1);
      expect(getProjectAttachment(h.db, project.id, file.path)).toBeUndefined();
    });
  });

  it("backfills legacy events, queues, and both history scopes while keeping cleanup gated", async () => {
    await withTestHarness(async (h) => {
      const { project, thread } = seedThreadFixture(h);
      const paths = [
        "event.txt",
        "queue.txt",
        "history-thread.txt",
        "history-project.txt",
        "orphan.txt",
      ];
      const dir = join(h.config.dataDir, "attachments", project.id);
      await mkdir(dir, { recursive: true });
      for (const path of paths) await writeFile(join(dir, path), path);
      h.db
        .insert(events)
        .values({
          id: "legacy-event",
          threadId: thread.id,
          sequence: 1,
          scopeKind: "thread",
          type: "client/turn/requested",
          data: JSON.stringify({ input: input("event.txt") }),
          createdAt: 1,
        })
        .run();
      const queued = seedQueuedMessage(h.deps, {
        threadId: thread.id,
        content: [{ type: "text", text: "legacy", mentions: [] }],
      });
      h.db
        .update(queuedThreadMessages)
        .set({ content: JSON.stringify(input("queue.txt")) })
        .where(eq(queuedThreadMessages.id, queued.id))
        .run();
      for (const [i, scope] of (["thread", "project"] as const).entries())
        h.db
          .insert(promptHistoryEntries)
          .values({
            id: `legacy-${scope}`,
            projectId: project.id,
            threadId: thread.id,
            scope,
            requestSequence: i + 1,
            input: JSON.stringify(input(`history-${scope}.txt`)),
            createdAt: 1,
          })
          .run();
      expect((await pruneProjectAttachments(h.deps, project.id)).status).toBe(
        "backfill-pending",
      );
      await validatePromptAttachmentReferences({
        db: h.db,
        dataDir: h.config.dataDir,
        projectId: project.id,
        input: input("./event.txt"),
      });
      await completeBackfill(h, project.id);
      expect(h.db.select().from(projectAttachmentThreads).all()).toHaveLength(
        4,
      );
      ageUploads(h, project.id);
      expect(
        (await pruneProjectAttachments(h.deps, project.id)).reclaimedCount,
      ).toBe(1);
      expect(
        h.db
          .select({ path: projectAttachments.storedPath })
          .from(projectAttachments)
          .all()
          .map((row) => row.path)
          .sort(),
      ).toEqual(paths.slice(0, 4).sort());
    });
  });

  it("completes backfill when legacy input references bytes that are gone", async () => {
    await withTestHarness(async (h) => {
      const { project, thread } = seedThreadFixture(h);
      const orphan = await upload(h, project.id, "orphan.txt");
      h.db
        .insert(events)
        .values({
          id: "vanished-legacy",
          threadId: thread.id,
          sequence: 1,
          scopeKind: "thread",
          type: "client/turn/requested",
          data: JSON.stringify({ input: input("vanished.txt") }),
          createdAt: 1,
        })
        .run();
      await completeBackfill(h, project.id);
      expect(
        ensureProjectAttachmentBackfill(h.db, project.id).error,
      ).toBeNull();
      expect(
        getProjectAttachment(h.db, project.id, "vanished.txt"),
      ).toBeUndefined();
      ageUploads(h, project.id);
      const pruned = await pruneProjectAttachments(h.deps, project.id);
      expect(pruned.status).toBe("complete");
      expect(pruned.reclaimedCount).toBe(1);
      expect(
        getProjectAttachment(h.db, project.id, orphan.path),
      ).toBeUndefined();
    });
  });

  it("completes backfill when legacy input references an unresolvable path", async () => {
    await withTestHarness(async (h) => {
      const { project, thread } = seedThreadFixture(h);
      const orphan = await upload(h, project.id, "orphan.txt");
      h.db
        .insert(events)
        .values({
          id: "traversal-legacy",
          threadId: thread.id,
          sequence: 1,
          scopeKind: "thread",
          type: "client/turn/requested",
          data: JSON.stringify({ input: input("../escape.txt") }),
          createdAt: 1,
        })
        .run();
      await completeBackfill(h, project.id);
      ageUploads(h, project.id);
      expect(
        (await pruneProjectAttachments(h.deps, project.id)).reclaimedCount,
      ).toBe(1);
      expect(
        getProjectAttachment(h.db, project.id, orphan.path),
      ).toBeUndefined();
      await expect(
        validatePromptAttachmentReferences({
          db: h.db,
          dataDir: h.config.dataDir,
          projectId: project.id,
          input: input("../escape.txt"),
        }),
      ).rejects.toThrow("escapes project directory");
    });
  });

  it("blocks reclamation on malformed legacy input and preserves young unowned uploads", async () => {
    await withTestHarness(async (h) => {
      const { project, thread } = seedThreadFixture(h);
      const file = await upload(h, project.id);
      h.db
        .insert(events)
        .values({
          id: "bad-legacy",
          threadId: thread.id,
          sequence: 1,
          scopeKind: "thread",
          type: "client/turn/requested",
          data: "{}",
          createdAt: 1,
        })
        .run();
      for (let count = 0; count < 10; count += 1)
        await runProjectAttachmentBackfill(h.deps);
      const state = ensureProjectAttachmentBackfill(h.db, project.id);
      expect(state.error).not.toBeNull();
      expect((await pruneProjectAttachments(h.deps, project.id)).status).toBe(
        "backfill-pending",
      );
      h.db
        .update(events)
        .set({ data: JSON.stringify({ input: [] }) })
        .where(eq(events.id, "bad-legacy"))
        .run();
      h.db
        .update(projectAttachmentBackfills)
        .set({ error: null })
        .where(eq(projectAttachmentBackfills.projectId, project.id))
        .run();
      await completeBackfill(h, project.id);
      expect(
        (await pruneProjectAttachments(h.deps, project.id)).reclaimedCount,
      ).toBe(0);
      expect(
        getProjectAttachment(h.db, project.id, file.path)?.readyAt,
      ).not.toBeNull();
    });
  });

  it("normalizes aliases, rejects traversal, and excludes runtime paths", async () => {
    await withTestHarness(async (h) => {
      const { project, thread } = seedThreadFixture(h);
      const file = await upload(h, project.id);
      expect(canonicalProjectAttachmentPath(`folder\\..\\${file.path}`)).toBe(
        file.path,
      );
      acquireProjectAttachmentOwnership(
        h.db,
        thread.id,
        input(`folder/../${file.path}`),
      );
      acquireProjectAttachmentOwnership(h.db, thread.id, [
        ...input("/tmp/local.txt"),
        ...input("C:\\tmp\\local.txt"),
        ...input("https://example.test/file"),
      ]);
      expect(h.db.select().from(projectAttachmentThreads).all()).toHaveLength(
        1,
      );
      expect(() =>
        acquireProjectAttachmentOwnership(
          h.db,
          thread.id,
          input("../outside.txt"),
        ),
      ).toThrow("escapes");
      const other = seedThreadFixture(h);
      expect(() =>
        acquireProjectAttachmentOwnership(
          h.db,
          other.thread.id,
          input(file.path),
        ),
      ).toThrow("not uploaded");
    });
  });
  it("reclaims interrupted upload staging and bounds oversized legacy payload reads", async () => {
    await withTestHarness(async (h) => {
      const { project, thread } = seedThreadFixture(h);
      const file = await upload(h, project.id);
      const row = getProjectAttachment(h.db, project.id, file.path);
      if (!row) throw new Error("Missing uploaded inventory");
      const pending = join(
        h.config.dataDir,
        "attachments",
        project.id,
        ".pending",
        row.id,
      );
      await mkdir(
        join(h.config.dataDir, "attachments", project.id, ".pending"),
        { recursive: true },
      );
      await writeFile(pending, "interrupted bytes");
      h.db
        .update(projectAttachments)
        .set({ readyAt: null })
        .where(eq(projectAttachments.id, row.id))
        .run();
      await completeBackfill(h, project.id);
      ageUploads(h, project.id);
      expect(
        (await pruneProjectAttachments(h.deps, project.id)).reclaimedCount,
      ).toBe(1);
      await expect(readFile(pending)).rejects.toMatchObject({ code: "ENOENT" });
      h.db
        .insert(events)
        .values({
          id: "oversized-legacy",
          threadId: thread.id,
          sequence: 1,
          scopeKind: "thread",
          type: "client/turn/requested",
          data: JSON.stringify({
            input: [],
            padding: "x".repeat(4 * 1024 * 1024),
          }),
          createdAt: 1,
        })
        .run();
      h.db
        .update(projectAttachmentBackfills)
        .set({
          phase: "events",
          threadCursor: "",
          inputCursor: 0,
          inputId: "",
          inputSequence: 0,
        })
        .where(eq(projectAttachmentBackfills.projectId, project.id))
        .run();
      for (
        let count = 0;
        count < 10 &&
        ensureProjectAttachmentBackfill(h.db, project.id).error === null;
        count += 1
      )
        await runProjectAttachmentBackfill(h.deps);
      expect(ensureProjectAttachmentBackfill(h.db, project.id).error).toContain(
        "4 MiB",
      );
      expect((await pruneProjectAttachments(h.deps, project.id)).status).toBe(
        "backfill-pending",
      );
    });
  });

  it("bounds backfill work on large histories while accepting queued messages", async () => {
    await withTestHarness(async (h) => {
      const { project, thread } = seedThreadFixture(h, {
        thread: { status: "active" },
      });
      const file = await upload(h, project.id);
      const output = JSON.stringify({ message: "x".repeat(4096) });
      const request = JSON.stringify({
        input: input(file.path),
        direction: "outbound",
        requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        target: { kind: "new-turn" },
        request: { method: "turn/start", params: {} },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      });
      const insert = h.db.$client.prepare(
        "INSERT INTO events (id, thread_id, scope_kind, sequence, type, data, created_at) VALUES (?, ?, 'thread', ?, ?, ?, 1)",
      );
      h.db.$client.transaction(() => {
        for (let n = 1; n <= 20_000; n += 1)
          insert.run(
            `perf-${n}`,
            thread.id,
            n,
            n % 20 === 0 ? "client/turn/requested" : "system/error",
            n % 20 === 0 ? request : output,
          );
      })();
      const plan = h.db.$client
        .prepare(
          "EXPLAIN QUERY PLAN SELECT data, sequence FROM events WHERE thread_id = ? AND type = 'client/turn/requested' AND sequence > ? ORDER BY sequence LIMIT 1",
        )
        .all(thread.id, 0);
      expect(JSON.stringify(plan)).toContain("events_thread_type_sequence_idx");
      const batchMs: number[] = [];
      const queueMs: number[] = [];
      let yields = 0;
      const timer = setInterval(() => {
        yields += 1;
      }, 1);
      try {
        for (let n = 0; n < 200; n += 1) {
          const started = performance.now();
          await runProjectAttachmentBackfill(h.deps);
          batchMs.push(performance.now() - started);
          const queueStarted = performance.now();
          const response = await h.app.request(
            `/api/v1/threads/${thread.id}/queued-messages`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ input: input(file.path) }),
            },
          );
          expect(response.status, await response.text()).toBe(201);
          queueMs.push(performance.now() - queueStarted);
          if (
            ensureProjectAttachmentBackfill(h.db, project.id).phase === "done"
          )
            break;
        }
      } finally {
        clearInterval(timer);
      }
      expect(ensureProjectAttachmentBackfill(h.db, project.id).phase).toBe(
        "done",
      );
      expect(batchMs.length).toBeGreaterThan(30);
      expect(yields).toBeGreaterThan(0);
      expect(h.db.select().from(projectAttachmentThreads).all()).toHaveLength(
        1,
      );
      const p95 = (values: number[]) =>
        [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
      console.log(
        JSON.stringify({
          attachmentBackfillBenchmark: {
            events: 20_000,
            inputEvents: 1000,
            outputBytes: output.length * 19_000,
            batches: batchMs.length,
            batchP95Ms: p95(batchMs),
            batchMaxMs: Math.max(...batchMs),
            queueP95Ms: p95(queueMs),
            queueMaxMs: Math.max(...queueMs),
            timerYields: yields,
          },
        }),
      );
    });
  });
});
