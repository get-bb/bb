import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createConnection,
  createProject,
  createThread,
  getThreadRewindCheckpoint,
  migrate,
  noopNotifier,
  resolveThreadRewindCheckpoint,
  threadRewindCheckpoints,
  upsertThreadRewindCheckpoint,
} from "../../src/index.js";
import { upsertHost } from "../../src/data/hosts.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "rewind-checkpoint-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "rewind checkpoint test",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/rewind-checkpoint",
    },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, thread };
}

describe("thread rewind checkpoints", () => {
  it("persists exact Codex anchors and is idempotent for duplicate events", () => {
    const { db, thread } = setup();
    const input = {
      anchor: { provider: "codex", turnId: "turn-before-2" } as const,
      branchId: "branch-1",
      createdAt: 100,
      providerThreadId: "codex-thread-1",
      sourceSequence: 20,
      threadId: thread.id,
      turnId: "bb-turn-2",
    };

    expect(upsertThreadRewindCheckpoint(db, input).outcome).toBe("created");
    const duplicate = upsertThreadRewindCheckpoint(db, input);
    expect(duplicate.outcome).toBe("existing");
    expect(duplicate.checkpoint.anchor).toEqual({
      provider: "codex",
      turnId: "turn-before-2",
    });
    expect(
      resolveThreadRewindCheckpoint(db, {
        branchId: "branch-1",
        sourceSequence: 20,
        threadId: thread.id,
      }),
    ).toMatchObject({ outcome: "eligible" });

    db.$client.close();
  });

  it("marks conflicting duplicate anchors ambiguous instead of guessing", () => {
    const { db, thread } = setup();
    const base = {
      branchId: "branch-1",
      providerThreadId: "claude-thread-1",
      sourceSequence: 20,
      threadId: thread.id,
      turnId: "bb-turn-2",
    };

    expect(
      upsertThreadRewindCheckpoint(db, {
        ...base,
        anchor: { messageId: "message-before-2", provider: "claude-code" },
      }).outcome,
    ).toBe("created");
    const conflict = upsertThreadRewindCheckpoint(db, {
      ...base,
      anchor: { messageId: "different-message", provider: "claude-code" },
    });
    expect(conflict.outcome).toBe("ambiguous");
    expect(conflict.checkpoint.status).toBe("ambiguous");
    expect(
      resolveThreadRewindCheckpoint(db, {
        branchId: "branch-1",
        sourceSequence: 20,
        threadId: thread.id,
      }),
    ).toEqual({
      outcome: "ineligible",
      reason: "ambiguous-provider-checkpoint",
    });

    db.$client.close();
  });

  it("keeps branch and provider session mappings separate", () => {
    const { db, thread } = setup();
    const first = upsertThreadRewindCheckpoint(db, {
      anchor: { provider: "codex", turnId: "turn-before-2" },
      branchId: "branch-1",
      providerThreadId: "codex-thread-1",
      sourceSequence: 20,
      threadId: thread.id,
      turnId: "bb-turn-2",
    });
    const second = upsertThreadRewindCheckpoint(db, {
      anchor: { provider: "codex", turnId: "turn-before-2-replayed" },
      branchId: "branch-2",
      providerThreadId: "codex-thread-2",
      sourceSequence: 20,
      threadId: thread.id,
      turnId: "bb-turn-2-replayed",
    });

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("created");
    expect(
      getThreadRewindCheckpoint(db, {
        branchId: "branch-1",
        sourceSequence: 20,
        threadId: thread.id,
      })?.providerThreadId,
    ).toBe("codex-thread-1");
    expect(
      getThreadRewindCheckpoint(db, {
        branchId: "branch-2",
        sourceSequence: 20,
        threadId: thread.id,
      })?.providerThreadId,
    ).toBe("codex-thread-2");

    db.$client.close();
  });

  it("treats missing and malformed persisted anchors as ineligible", () => {
    const { db, thread } = setup();
    expect(
      resolveThreadRewindCheckpoint(db, {
        branchId: "branch-1",
        sourceSequence: 20,
        threadId: thread.id,
      }),
    ).toEqual({
      outcome: "ineligible",
      reason: "missing-provider-checkpoint",
    });

    const inserted = upsertThreadRewindCheckpoint(db, {
      anchor: { provider: "codex", turnId: "turn-before-2" },
      branchId: "branch-1",
      providerThreadId: "codex-thread-1",
      sourceSequence: 20,
      threadId: thread.id,
      turnId: "bb-turn-2",
    });
    db
      .update(threadRewindCheckpoints)
      .set({ anchorKind: "claude-message-id" })
      .where(eq(threadRewindCheckpoints.id, inserted.checkpoint.id))
      .run();

    expect(
      resolveThreadRewindCheckpoint(db, {
        branchId: "branch-1",
        sourceSequence: 20,
        threadId: thread.id,
      }),
    ).toEqual({
      outcome: "ineligible",
      reason: "ambiguous-provider-checkpoint",
    });

    db.$client.close();
  });

  it("treats malformed persisted status as ineligible", () => {
    const { db, thread } = setup();
    const inserted = upsertThreadRewindCheckpoint(db, {
      anchor: { provider: "codex", turnId: "turn-before-2" },
      branchId: "branch-1",
      providerThreadId: "codex-thread-1",
      sourceSequence: 20,
      threadId: thread.id,
      turnId: "bb-turn-2",
    });
    db.$client
      .prepare(
        "UPDATE thread_rewind_checkpoints SET status = 'corrupt' WHERE id = ?",
      )
      .run(inserted.checkpoint.id);

    expect(
      resolveThreadRewindCheckpoint(db, {
        branchId: "branch-1",
        sourceSequence: 20,
        threadId: thread.id,
      }),
    ).toEqual({
      outcome: "ineligible",
      reason: "ambiguous-provider-checkpoint",
    });

    db.$client.close();
  });
});
