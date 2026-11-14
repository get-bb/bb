import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { DbTransaction } from "../../src/connection.js";
import { noopNotifier } from "../../src/notifier.js";
import { threadRunStates, threads } from "../../src/schema.js";
import { createThread, getThread } from "../../src/data/threads.js";
import {
  listThreadIdsAwaitingTurnRequestAnswers,
  readThreadRunState,
  writeThreadLifecycleStateInTransaction,
  type StoredThreadRunState,
} from "../../src/data/thread-run-state.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import { withWriteAfterFirstRead } from "../helpers/interleave.js";
import { createMigratedConnection } from "../../src/testing.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, host, project };
}

const EMPTY: StoredThreadRunState = {
  heldCompletion: null,
  requests: [],
  stop: null,
};

describe("writeThreadLifecycleStateInTransaction", () => {
  it("persists status, requests, a held completion and an owed stop, and clears them", () => {
    const { db, host, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "idle",
    });
    const sent: StoredThreadRunState = {
      heldCompletion: { status: "completed", turnId: "turn-1" },
      requests: [
        {
          hostId: host.id,
          kind: "new-turn",
          phase: "sent",
          requestId: "req-1",
          sentAt: 10,
          syncTitle: false,
        },
      ],
      stop: { ackedAt: null, reason: "manual-stop", requestedAt: 5, sentAt: null },
    };
    db.transaction((tx: DbTransaction) =>
      writeThreadLifecycleStateInTransaction(tx, {
        expectedStatus: "idle",
        next: { ...sent, status: "active" },
        previous: EMPTY,
        threadId: thread.id,
      }),
    );
    expect(getThread(db, thread.id)?.status).toBe("active");
    expect(readThreadRunState(db, thread.id)).toEqual(sent);
    expect(listThreadIdsAwaitingTurnRequestAnswers(db)).toEqual([thread.id]);

    db.transaction((tx: DbTransaction) =>
      writeThreadLifecycleStateInTransaction(tx, {
        expectedStatus: "active",
        next: { ...EMPTY, status: "idle" },
        previous: sent,
        threadId: thread.id,
      }),
    );
    expect(readThreadRunState(db, thread.id)).toEqual(EMPTY);
    expect(
      db
        .select()
        .from(threadRunStates)
        .where(eq(threadRunStates.threadId, thread.id))
        .all(),
    ).toEqual([]);
    expect(listThreadIdsAwaitingTurnRequestAnswers(db)).toEqual([]);
  });

  it("reports a conflict and writes nothing when the status moved under it", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "starting",
    });

    const result = db.transaction((tx: DbTransaction) => {
      const interleaved = withWriteAfterFirstRead(tx, () => {
        tx.update(threads)
          .set({ status: "idle" })
          .where(eq(threads.id, thread.id))
          .run();
      });
      return writeThreadLifecycleStateInTransaction(interleaved, {
        expectedStatus: "starting",
        next: { ...EMPTY, status: "active" },
        previous: EMPTY,
        threadId: thread.id,
      });
    });

    expect(result).toEqual({ kind: "conflict" });
    expect(getThread(db, thread.id)?.status).toBe("idle");
  });

  it("sets latestAttentionAt only on attention-worthy status changes", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const cases = [
        { attention: true, parent: false, from: "active", to: "idle" },
        { attention: false, parent: true, from: "active", to: "idle" },
        { attention: false, parent: false, from: "starting", to: "active" },
        { attention: true, parent: false, from: "starting", to: "error" },
      ] as const;
      let now = 1_000;
      for (const testCase of cases) {
        const parentThreadId = testCase.parent
          ? createThread(db, noopNotifier, {
              projectId: project.id,
              providerId: "codex",
            }).id
          : null;
        const thread = createThread(db, noopNotifier, {
          parentThreadId,
          projectId: project.id,
          providerId: "codex",
          status: testCase.from,
        });
        now += 1_000;
        vi.setSystemTime(now);
        const result = db.transaction((tx: DbTransaction) =>
          writeThreadLifecycleStateInTransaction(tx, {
            expectedStatus: testCase.from,
            next: { ...EMPTY, status: testCase.to },
            previous: EMPTY,
            threadId: thread.id,
          }),
        );
        expect(result.kind).toBe("written");
        if (result.kind !== "written") continue;
        expect(result.statusChanged).toBe(true);
        expect(result.thread.status).toBe(testCase.to);
        expect(result.thread.latestAttentionAt).toBe(
          testCase.attention ? now : thread.latestAttentionAt,
        );
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
