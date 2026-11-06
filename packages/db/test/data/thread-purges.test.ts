import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { threadScope } from "@bb/domain";
import { createEnvironment } from "../../src/data/environments.js";
import { insertEvents } from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  deleteThreadPurgeBatch,
  nextThreadPurge,
  requestThreadPurge,
} from "../../src/data/thread-purges.js";
import { createThread, getThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { promptHistoryEntries, threads } from "../../src/schema.js";
import { createMigratedConnection } from "../../src/testing.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    path: "/tmp/environment",
    providerOwnsPath: false,
    status: "ready",
    environmentProvider: null,
  });
  return { db, environment, project };
}

function seedThread(
  context: ReturnType<typeof setup>,
  args: { eventBytes: number[]; lifecycleOwnerThreadId: string | null },
) {
  const thread = createThread(context.db, noopNotifier, {
    projectId: context.project.id,
    providerId: "codex",
    environmentId: context.environment.id,
    status: "idle",
    lifecycleOwnerThreadId: args.lifecycleOwnerThreadId,
  });
  insertEvents(
    context.db,
    noopNotifier,
    args.eventBytes.map((bytes, index) => ({
      threadId: thread.id,
      environmentId: context.environment.id,
      providerThreadId: "provider-thread-1",
      scope: threadScope(),
      sequence: index + 1,
      type: "thread/identity",
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ text: "x".repeat(bytes) }),
    })),
  );
  return thread;
}

function countRows(
  db: ReturnType<typeof setup>["db"],
  table: string,
  threadId: string,
): number {
  return (
    db.get<{ count: number }>(
      sql`SELECT count(*) AS count FROM ${sql.identifier(table)} WHERE thread_id = ${threadId}`,
    )?.count ?? 0
  );
}

describe("thread purges", () => {
  it("deletes a thread's events in row- and byte-capped batches, then its other rows, and never the thread row", () => {
    const context = setup();
    const thread = seedThread(context, {
      eventBytes: [100, 2000, 100, 100, 100],
      lifecycleOwnerThreadId: null,
    });
    const other = seedThread(context, {
      eventBytes: [100],
      lifecycleOwnerThreadId: null,
    });
    context.db
      .insert(promptHistoryEntries)
      .values(
        [1, 2, 3].map((requestSequence) => ({
          createdAt: requestSequence,
          id: `prompt-${requestSequence}`,
          input: "[]",
          projectId: context.project.id,
          requestSequence,
          scope: "thread" as const,
          threadId: thread.id,
        })),
      )
      .run();
    const batch = () =>
      deleteThreadPurgeBatch(context.db, {
        maxEventBytes: 1000,
        maxEventRows: 3,
        maxRows: 2,
        threadId: thread.id,
      });

    expect([batch(), batch(), batch()]).toEqual([1, 1, 3]);
    expect(countRows(context.db, "events", thread.id)).toBe(0);
    expect(countRows(context.db, "prompt_history_entries", thread.id)).toBe(3);
    expect([batch(), batch(), batch()]).toEqual([2, 1, 0]);
    expect(countRows(context.db, "prompt_history_entries", thread.id)).toBe(0);
    expect(getThread(context.db, thread.id)).not.toBeNull();
    expect(countRows(context.db, "events", other.id)).toBe(1);
  });

  it("purges the oldest request first, skips excluded threads, and holds an owner until the threads it owns are gone", () => {
    const context = setup();
    const owner = seedThread(context, {
      eventBytes: [],
      lifecycleOwnerThreadId: null,
    });
    const owned = seedThread(context, {
      eventBytes: [],
      lifecycleOwnerThreadId: owner.id,
    });
    const later = seedThread(context, {
      eventBytes: [],
      lifecycleOwnerThreadId: null,
    });
    requestThreadPurge(context.db, { now: 1, threadId: owner.id });
    requestThreadPurge(context.db, { now: 2, threadId: owned.id });
    requestThreadPurge(context.db, { now: 3, threadId: later.id });

    expect(nextThreadPurge(context.db, { excludedThreadIds: new Set() })).toBe(
      owned.id,
    );
    expect(
      nextThreadPurge(context.db, { excludedThreadIds: new Set([owned.id]) }),
    ).toBe(later.id);
    context.db
      .delete(threads)
      .where(sql`${threads.id} = ${owned.id}`)
      .run();
    expect(nextThreadPurge(context.db, { excludedThreadIds: new Set() })).toBe(
      owner.id,
    );
    context.db
      .delete(threads)
      .where(sql`${threads.id} = ${owner.id}`)
      .run();
    expect(nextThreadPurge(context.db, { excludedThreadIds: new Set() })).toBe(
      later.id,
    );
    context.db
      .delete(threads)
      .where(sql`${threads.id} = ${later.id}`)
      .run();
    expect(
      nextThreadPurge(context.db, { excludedThreadIds: new Set() }),
    ).toBeNull();
  });
});
