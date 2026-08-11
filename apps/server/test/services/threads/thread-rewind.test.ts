import { describe, expect, it, vi } from "vitest";
import {
  applyThreadLifecycleEvent,
  archiveThread,
  createPendingInteraction,
  createTerminalSession,
  events,
  getActiveThreadBranch,
  getStoredThreadTabs,
  getThreadSourceBranchId,
  listRewindRolloutMetrics,
  listPendingThreadBranchCleanup,
  listThreadBranches,
  listTerminalSessionsByThread,
  markThreadDeleted,
  pluginKv,
  replaceStoredThreadTabs,
  stageThreadBranch,
  threadSearchSegments,
  threads,
  updateThread,
  updateThreadBranchCleanupResult,
  upsertThreadSearchSegments,
  upsertThreadRewindCheckpoint,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type ClientTurnRequestId,
} from "@bb/domain";
import { and, desc, eq } from "drizzle-orm";
import {
  commitThreadRewind,
  previewThreadRewind,
  reconcileThreadRewindOperations,
  restoreThreadRewindBranch,
  type ThreadRewindProviderTransport,
} from "../../../src/services/threads/thread-rewind.js";
import {
  seedEvent,
  seedQueuedMessage,
  seedThread,
  seedThreadFixture,
} from "../../helpers/seed.js";
import { createTestAppHarness } from "../../helpers/test-app.js";

const requestId = (value: number): ClientTurnRequestId =>
  encodeClientTurnRequestIdNumber({ value });

function seedCompletedTurn(
  harness: Parameters<typeof seedEvent>[0],
  args: {
    environmentId: string;
    providerThreadId: string;
    requestNumber: number;
    sequence: number;
    text: string;
    threadId: string;
    turnId: string;
    target: "thread-start" | "new-turn";
  },
): number {
  const clientRequestId = requestId(args.requestNumber);
  seedEvent(harness, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    sequence: args.sequence,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      source: "tell",
      initiator: "user",
      request: { method: "turn/start", params: {} },
      requestId: clientRequestId,
      senderThreadId: null,
      input: [{ type: "text", text: args.text, mentions: [] }],
      target: { kind: args.target },
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
    },
  });
  seedEvent(harness, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    sequence: args.sequence + 1,
    type: "turn/started",
    scope: turnScope(args.turnId),
    data: { providerThreadId: args.providerThreadId },
  });
  seedEvent(harness, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    sequence: args.sequence + 2,
    type: "turn/input/accepted",
    scope: turnScope(args.turnId),
    data: { clientRequestId },
  });
  seedEvent(harness, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    sequence: args.sequence + 3,
    type: "turn/completed",
    scope: turnScope(args.turnId),
    data: { providerThreadId: args.providerThreadId, status: "completed" },
  });
  return args.sequence + 4;
}

async function makeFixture(
  args: {
    thread?: Omit<
      Parameters<typeof seedThread>[1],
      "projectId" | "environmentId"
    >;
  } = {},
) {
  const harness = await createTestAppHarness();
  const { environment, thread } = seedThreadFixture(harness, {
    thread: { providerId: "codex", status: "idle", ...args.thread },
  });
  const root = getActiveThreadBranch(harness.db, thread.id);
  if (!root) throw new Error("Expected active root branch");
  let nextSequence = seedCompletedTurn(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "provider-root",
    requestNumber: 1,
    sequence: 1,
    text: "original first message",
    threadId: thread.id,
    turnId: "turn-1",
    target: "thread-start",
  });
  nextSequence = seedCompletedTurn(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "provider-root",
    requestNumber: 2,
    sequence: nextSequence,
    text: "later message",
    threadId: thread.id,
    turnId: "turn-2",
    target: "new-turn",
  });
  upsertThreadRewindCheckpoint(harness.db, {
    anchor: { provider: "codex", turnId: "before-turn-1" },
    branchId: root.id,
    providerThreadId: "provider-root",
    sourceSequence: 1,
    threadId: thread.id,
    turnId: "turn-1",
  });
  return {
    cleanup: harness.cleanup,
    deps: harness.deps,
    db: harness.db,
    nextSequence,
    rootBranchId: root.id,
    target: {
      branchId: root.id,
      sourceSequence: 1,
      turnId: "turn-1",
    },
    thread,
  };
}

function request(target: Awaited<ReturnType<typeof makeFixture>>["target"]) {
  return {
    editedInput: [
      { type: "text" as const, text: "edited first message", mentions: [] },
    ],
    mode: "conversation-only" as const,
    target,
  };
}

function successfulTransport(): ThreadRewindProviderTransport {
  return {
    createBranch: vi.fn(async () => ({ providerThreadId: "provider-rewind" })),
    submitTurn: vi.fn(async () => undefined),
  };
}

describe("thread rewind orchestration", () => {
  it("previews and commits a native branch without changing the BB thread id", async () => {
    const fixture = await makeFixture();
    try {
      const preview = await previewThreadRewind(fixture.deps, {
        target: fixture.target,
      });
      expect(preview).toMatchObject({
        displacedTurnCount: 1,
        eligibility: { status: "eligible" },
        provider: "codex",
        startsFreshProviderSession: false,
      });
      const transport = successfulTransport();
      const result = await commitThreadRewind(fixture.deps, {
        idempotencyKey: "rewind-1",
        preview,
        request: request(fixture.target),
        transport,
      });
      expect(result.submission).toBe("submitted");
      expect(result.result.threadId).toBe(fixture.thread.id);
      expect(result.previousBranchId).toBe(fixture.rootBranchId);
      expect(getActiveThreadBranch(fixture.db, fixture.thread.id)?.id).toBe(
        result.newBranchId,
      );
      expect(
        listThreadBranches(fixture.db, { threadId: fixture.thread.id }).find(
          (branch) => branch.id === fixture.rootBranchId,
        )?.lifecycle,
      ).toBe("available");
      expect(
        (transport.createBranch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
      ).toMatchObject({
        sourceProviderThreadId: "provider-root",
        anchor: { provider: "codex", turnId: "before-turn-1" },
      });
      expect(
        fixture.db
          .select({ branchId: events.branchId, type: events.type })
          .from(events)
          .where(eq(events.threadId, fixture.thread.id))
          .all()
          .filter((row) => row.branchId === result.newBranchId)
          .map((row) => row.type),
      ).toEqual(
        expect.arrayContaining(["system/operation", "client/turn/requested"]),
      );
      // A successful cycle records no failure counters.
      expect(listRewindRolloutMetrics(fixture.db)).toEqual({});
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps the original branch active when provider branching fails", async () => {
    const fixture = await makeFixture();
    try {
      const transport: ThreadRewindProviderTransport = {
        createBranch: vi.fn(async () => {
          throw new Error("provider unavailable");
        }),
        submitTurn: vi.fn(async () => undefined),
      };
      await expect(
        commitThreadRewind(fixture.deps, {
          idempotencyKey: "rewind-provider-failure",
          request: request(fixture.target),
          transport,
        }),
      ).rejects.toMatchObject({ body: { code: "provider-branch-failed" } });
      expect(getActiveThreadBranch(fixture.db, fixture.thread.id)?.id).toBe(
        fixture.rootBranchId,
      );
      const branches = listThreadBranches(fixture.db, {
        threadId: fixture.thread.id,
      });
      // The staged rewind branch is retained as a durable abandoned record
      // (cleanup-pending) rather than deleted, so a later maintenance pass can
      // retry provider cleanup after a crash; it never becomes the active
      // branch.
      expect(branches).toHaveLength(2);
      const abandoned = branches.find(
        (branch) => branch.id !== fixture.rootBranchId,
      );
      expect(abandoned).toMatchObject({
        lifecycle: "abandoned",
        // Provider branching failed before a session was bound, so there is
        // no provider session to clean up; the branch is retained only as a
        // durable abandoned record.
        cleanupStatus: "not-needed",
        parentBranchId: fixture.rootBranchId,
      });
      expect(listRewindRolloutMetrics(fixture.db).provider_branch_failure).toBe(
        1,
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("leaves an idle rewound branch and returns the draft when submission fails", async () => {
    const fixture = await makeFixture();
    try {
      const transport: ThreadRewindProviderTransport = {
        createBranch: vi.fn(async () => ({
          providerThreadId: "provider-rewind",
        })),
        submitTurn: vi.fn(async () => {
          throw new Error("submit unavailable");
        }),
      };
      const result = await commitThreadRewind(fixture.deps, {
        idempotencyKey: "rewind-submit-failure",
        request: request(fixture.target),
        transport,
      });
      expect(result.submission).toBe("draft-recovery");
      expect(result.draft).toEqual(request(fixture.target).editedInput);
      expect(getActiveThreadBranch(fixture.db, fixture.thread.id)?.id).toBe(
        result.newBranchId,
      );
      expect(
        fixture.db
          .select({ status: threads.status })
          .from(threads)
          .where(eq(threads.id, fixture.thread.id))
          .get()?.status,
      ).toBe("idle");
      expect(listRewindRolloutMetrics(fixture.db).edited_turn_failure).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a preview after the thread revision changes", async () => {
    const fixture = await makeFixture();
    try {
      const preview = await previewThreadRewind(fixture.deps, {
        target: fixture.target,
      });
      seedEvent(fixture.deps, {
        threadId: fixture.thread.id,
        environmentId: null,
        sequence: fixture.nextSequence,
        type: "system/operation",
        scope: threadScope(),
        data: {
          operation: "unrelated_operation",
          operationId: "unrelated",
          status: "completed",
          message: "changed",
        },
      });
      await expect(
        commitThreadRewind(fixture.deps, {
          idempotencyKey: "rewind-stale",
          preview,
          request: request(fixture.target),
          transport: successfulTransport(),
        }),
      ).rejects.toMatchObject({ body: { code: "stale-preview" } });
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns the persisted result on an idempotent retry", async () => {
    const fixture = await makeFixture();
    try {
      const transport = successfulTransport();
      const first = await commitThreadRewind(fixture.deps, {
        idempotencyKey: "rewind-idempotent",
        request: request(fixture.target),
        transport,
      });
      const secondTransport = successfulTransport();
      const second = await commitThreadRewind(fixture.deps, {
        idempotencyKey: "rewind-idempotent",
        request: request(fixture.target),
        transport: secondTransport,
      });
      expect(second).toEqual(first);
      expect(secondTransport.createBranch).not.toHaveBeenCalled();
      expect(secondTransport.submitTurn).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it("reconciles an accepted edited turn if restart left the operation activated", async () => {
    const fixture = await makeFixture();
    try {
      const transport = successfulTransport();
      const first = await commitThreadRewind(fixture.deps, {
        idempotencyKey: "rewind-restart-accepted",
        request: request(fixture.target),
        transport,
      });
      expect(first.submission).toBe("submitted");

      const operationRow = fixture.db
        .select({ data: events.data, id: events.id })
        .from(events)
        .where(eq(events.threadId, fixture.thread.id))
        .all()
        .reverse()
        .find((row) => {
          const data = JSON.parse(row.data) as Record<string, unknown>;
          return (
            data.operation === "thread_rewind" &&
            data.operationId === "rewind-restart-accepted"
          );
        });
      if (!operationRow) throw new Error("Expected rewind operation event");
      const operationData = JSON.parse(operationRow.data) as Record<
        string,
        unknown
      >;
      fixture.db
        .update(events)
        .set({
          data: JSON.stringify({ ...operationData, status: "activated" }),
        })
        .where(eq(events.id, operationRow.id))
        .run();

      const active = getActiveThreadBranch(fixture.db, fixture.thread.id);
      if (!active) throw new Error("Expected active rewind branch");
      const nextSequence =
        Math.max(
          ...fixture.db
            .select({ sequence: events.sequence })
            .from(events)
            .where(eq(events.threadId, fixture.thread.id))
            .all()
            .map((row) => row.sequence),
        ) + 1;
      seedEvent(fixture.deps, {
        threadId: fixture.thread.id,
        environmentId: fixture.thread.environmentId,
        providerThreadId: "provider-rewind",
        sequence: nextSequence,
        type: "turn/started",
        scope: turnScope("rewind-turn"),
        data: { providerThreadId: "provider-rewind" },
      });
      seedEvent(fixture.deps, {
        threadId: fixture.thread.id,
        environmentId: fixture.thread.environmentId,
        providerThreadId: "provider-rewind",
        sequence: nextSequence + 1,
        type: "turn/input/accepted",
        scope: turnScope("rewind-turn"),
        data: { clientRequestId: first.requestId },
      });

      const retryTransport = successfulTransport();
      const retry = await commitThreadRewind(fixture.deps, {
        idempotencyKey: "rewind-restart-accepted",
        request: request(fixture.target),
        transport: retryTransport,
      });
      expect(retry).toEqual(first);
      expect(retryTransport.createBranch).not.toHaveBeenCalled();
      expect(retryTransport.submitTurn).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("thread rewind failure injection and recovery", () => {
  it("recovers from a provider-branch failure with an idempotent retry", async () => {
    const fixture = await makeFixture();
    try {
      const transport: ThreadRewindProviderTransport = {
        createBranch: vi.fn(async () => {
          throw new Error("provider unavailable");
        }),
        submitTurn: vi.fn(async () => undefined),
      };
      await expect(
        commitThreadRewind(fixture.deps, {
          idempotencyKey: "rewind-retry-after-failure",
          request: request(fixture.target),
          transport,
        }),
      ).rejects.toMatchObject({ body: { code: "provider-branch-failed" } });
      expect(getActiveThreadBranch(fixture.db, fixture.thread.id)?.id).toBe(
        fixture.rootBranchId,
      );
      expect(
        fixture.db
          .select({ status: threads.status })
          .from(threads)
          .where(eq(threads.id, fixture.thread.id))
          .get()?.status,
      ).toBe("idle");

      const retry = successfulTransport();
      const result = await commitThreadRewind(fixture.deps, {
        idempotencyKey: "rewind-retry-after-failure",
        request: request(fixture.target),
        transport: retry,
      });
      expect(result.submission).toBe("submitted");
      expect(
        (transport.createBranch as ReturnType<typeof vi.fn>).mock.calls,
      ).toHaveLength(1);
      expect(
        (retry.createBranch as ReturnType<typeof vi.fn>).mock.calls,
      ).toHaveLength(1);
      const active = getActiveThreadBranch(fixture.db, fixture.thread.id);
      // Provider session and active BB branch always agree.
      expect(active?.id).toBe(result.newBranchId);
      expect(active?.providerThreadId).toBe("provider-rewind");
      const branches = listThreadBranches(fixture.db, {
        threadId: fixture.thread.id,
      });
      expect(
        branches.filter((branch) => branch.lifecycle === "active"),
      ).toHaveLength(1);
      expect(
        branches.filter((branch) => branch.lifecycle === "abandoned"),
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("abandons a bound staged branch when activation fails and a retry succeeds", async () => {
    const fixture = await makeFixture();
    try {
      const transport: ThreadRewindProviderTransport = {
        createBranch: vi.fn(async () => {
          // Simulate a concurrent change landing between provider creation and
          // BB activation: the reservation's revision check must fail and the
          // bound provider session must be abandoned cleanup-pending.
          const latest = fixture.db
            .select({ sequence: events.sequence })
            .from(events)
            .where(eq(events.threadId, fixture.thread.id))
            .orderBy(desc(events.sequence))
            .limit(1)
            .get()?.sequence;
          seedEvent(fixture.deps, {
            threadId: fixture.thread.id,
            environmentId: null,
            sequence: (latest ?? 0) + 1,
            type: "system/operation",
            scope: threadScope(),
            data: {
              operation: "concurrent_operation",
              operationId: "concurrent",
              status: "completed",
              message: "changed during rewind",
            },
          });
          return { providerThreadId: "provider-rewind" };
        }),
        submitTurn: vi.fn(async () => undefined),
      };
      await expect(
        commitThreadRewind(fixture.deps, {
          idempotencyKey: "rewind-activation-failure",
          request: request(fixture.target),
          transport,
        }),
      ).rejects.toMatchObject({ body: { code: "stale-preview" } });
      expect(getActiveThreadBranch(fixture.db, fixture.thread.id)?.id).toBe(
        fixture.rootBranchId,
      );
      const branches = listThreadBranches(fixture.db, {
        threadId: fixture.thread.id,
      });
      expect(branches).toHaveLength(2);
      const abandoned = branches.find(
        (branch) => branch.id !== fixture.rootBranchId,
      );
      expect(abandoned).toMatchObject({
        lifecycle: "abandoned",
        cleanupStatus: "pending",
        providerThreadId: "provider-rewind",
        parentBranchId: fixture.rootBranchId,
      });
      expect(abandoned?.cleanupError).toMatch(
        /thread changed before branch activation/u,
      );
      expect(
        listPendingThreadBranchCleanup(fixture.db).map((row) => row.id),
      ).toContain(abandoned?.id);
      expect(
        fixture.db
          .select({ status: threads.status })
          .from(threads)
          .where(eq(threads.id, fixture.thread.id))
          .get()?.status,
      ).toBe("idle");
      expect(listRewindRolloutMetrics(fixture.db).activation_failure).toBe(1);

      // The maintenance seam can complete the abandoned provider cleanup.
      if (!abandoned) throw new Error("Expected abandoned branch");
      updateThreadBranchCleanupResult(fixture.db, {
        branchId: abandoned.id,
        status: "completed",
      });
      expect(
        listThreadBranches(fixture.db, { threadId: fixture.thread.id }).find(
          (branch) => branch.id === abandoned.id,
        )?.cleanupStatus,
      ).toBe("completed");

      const retry = successfulTransport();
      const result = await commitThreadRewind(fixture.deps, {
        idempotencyKey: "rewind-activation-failure",
        request: request(fixture.target),
        transport: retry,
      });
      expect(result.submission).toBe("submitted");
      const active = getActiveThreadBranch(fixture.db, fixture.thread.id);
      expect(active?.id).toBe(result.newBranchId);
      expect(active?.providerThreadId).toBe("provider-rewind");
    } finally {
      await fixture.cleanup();
    }
  });

  it("resumes a staged bound reservation after a simulated restart without re-forking", async () => {
    const fixture = await makeFixture();
    try {
      const prepared = applyThreadLifecycleEvent(fixture.db, fixture.deps.hub, {
        event: { type: "run.preparing" },
        threadId: fixture.thread.id,
      });
      if (!prepared.applied) throw new Error("Expected run.preparing applied");
      const staged = stageThreadBranch(fixture.db, {
        cutoffSequence: 0,
        creationReason: "rewind",
        parentBranchId: fixture.rootBranchId,
        providerId: "codex",
        providerThreadId: "provider-crash",
        threadId: fixture.thread.id,
      });
      const crashRequestId = requestId(900);
      const stageRevision = fixture.nextSequence;
      seedEvent(fixture.deps, {
        threadId: fixture.thread.id,
        environmentId: null,
        sequence: stageRevision,
        type: "system/operation",
        scope: threadScope(),
        data: {
          operation: "thread_rewind",
          operationId: "rewind-crash-resume",
          status: "provider-branch-pending",
          message: "Rewind provider branch creation is pending",
          metadata: {
            displacedTurnCount: 1,
            editedInput: request(fixture.target).editedInput,
            mode: "conversation-only",
            newBranchId: staged.id,
            previousBranchId: fixture.rootBranchId,
            requestId: crashRequestId,
            sourceSequence: 1,
            stageRevision,
            threadId: fixture.thread.id,
          },
        },
      });

      const transport = successfulTransport();
      const result = await commitThreadRewind(fixture.deps, {
        idempotencyKey: "rewind-crash-resume",
        request: request(fixture.target),
        transport,
      });
      expect(result.submission).toBe("submitted");
      expect(result.newBranchId).toBe(staged.id);
      expect(result.requestId).toBe(crashRequestId);
      expect(
        (transport.createBranch as ReturnType<typeof vi.fn>).mock.calls,
      ).toHaveLength(0);
      expect(
        (transport.submitTurn as ReturnType<typeof vi.fn>).mock.calls,
      ).toHaveLength(1);
      const active = getActiveThreadBranch(fixture.db, fixture.thread.id);
      expect(active?.id).toBe(staged.id);
      expect(active?.providerThreadId).toBe("provider-crash");
      expect(
        fixture.db
          .select({ status: threads.status })
          .from(threads)
          .where(eq(threads.id, fixture.thread.id))
          .get()?.status,
      ).toBe("active");
    } finally {
      await fixture.cleanup();
    }
  });

  it("reconciles orphaned staged branches and cleans their provider sessions", async () => {
    const fixture = await makeFixture();
    try {
      const orphan = stageThreadBranch(fixture.db, {
        cutoffSequence: 0,
        creationReason: "rewind",
        parentBranchId: fixture.rootBranchId,
        providerId: "codex",
        providerThreadId: "provider-orphan",
        threadId: fixture.thread.id,
      });
      const cleanupBranch = vi.fn(async () => undefined);
      const reconciled = await reconcileThreadRewindOperations(fixture.deps, {
        threadId: fixture.thread.id,
        transport: {
          cleanupBranch,
          createBranch: vi.fn(async () => ({ providerThreadId: "unused" })),
          submitTurn: vi.fn(async () => undefined),
        },
      });
      expect(reconciled).toBe(1);
      expect(cleanupBranch).toHaveBeenCalledWith(
        expect.objectContaining({ providerThreadId: "provider-orphan" }),
      );
      const branch = listThreadBranches(fixture.db, {
        threadId: fixture.thread.id,
      }).find((row) => row.id === orphan.id);
      expect(branch).toMatchObject({
        lifecycle: "abandoned",
        cleanupStatus: "completed",
        providerThreadId: "provider-orphan",
      });
      expect(getActiveThreadBranch(fixture.db, fixture.thread.id)?.id).toBe(
        fixture.rootBranchId,
      );
      expect(listRewindRolloutMetrics(fixture.db).orphan_cleanup).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("thread rewind state coverage", () => {
  it("blocks rewinds while the thread is busy, awaiting input, archived, deleted, or compacted", async () => {
    const busy = await makeFixture();
    try {
      applyThreadLifecycleEvent(busy.db, busy.deps.hub, {
        event: { type: "run.started" },
        threadId: busy.thread.id,
      });
      const busyPreview = await previewThreadRewind(busy.deps, {
        target: busy.target,
      });
      expect(busyPreview.eligibility).toEqual({
        reason: "thread-not-idle",
        status: "ineligible",
      });
      expect(listRewindRolloutMetrics(busy.db).preview_denied).toBe(1);
      await expect(
        commitThreadRewind(busy.deps, {
          idempotencyKey: "rewind-busy",
          request: request(busy.target),
          transport: successfulTransport(),
        }),
      ).rejects.toMatchObject({ body: { code: "thread-not-idle" } });
    } finally {
      await busy.cleanup();
    }

    const pending = await makeFixture();
    try {
      createPendingInteraction(pending.db, {
        originKind: "provider",
        payload: JSON.stringify({
          kind: "approval",
          subject: {
            kind: "command",
            itemId: "item_1",
            command: "ls",
            cwd: "/tmp",
            actions: [
              { type: "read", command: "ls", name: "ls", path: "/tmp" },
            ],
            sessionGrant: null,
          },
          reason: null,
          availableDecisions: ["allow_once", "deny"],
        }),
        providerId: "codex",
        providerRequestId: "req-1",
        providerThreadId: "provider-root",
        threadId: pending.thread.id,
        turnId: "turn-1",
      });
      const pendingPreview = await previewThreadRewind(pending.deps, {
        target: pending.target,
      });
      expect(pendingPreview.eligibility).toEqual({
        reason: "pending-interaction",
        status: "ineligible",
      });
      await expect(
        commitThreadRewind(pending.deps, {
          idempotencyKey: "rewind-pending-interaction",
          request: request(pending.target),
          transport: successfulTransport(),
        }),
      ).rejects.toMatchObject({ body: { code: "pending-interaction" } });
    } finally {
      await pending.cleanup();
    }

    const queued = await makeFixture();
    try {
      seedQueuedMessage(queued.deps, {
        threadId: queued.thread.id,
        content: [{ type: "text", text: "queued input", mentions: [] }],
      });
      const queuedPreview = await previewThreadRewind(queued.deps, {
        target: queued.target,
      });
      expect(queuedPreview.eligibility).toEqual({
        reason: "queued-input",
        status: "ineligible",
      });
      await expect(
        commitThreadRewind(queued.deps, {
          idempotencyKey: "rewind-queued-input",
          request: request(queued.target),
          transport: successfulTransport(),
        }),
      ).rejects.toMatchObject({ body: { code: "queued-input" } });
    } finally {
      await queued.cleanup();
    }

    const archived = await makeFixture();
    try {
      archiveThread(archived.db, archived.deps.hub, archived.thread.id);
      const archivedPreview = await previewThreadRewind(archived.deps, {
        target: archived.target,
      });
      expect(archivedPreview.eligibility).toEqual({
        reason: "archived-thread",
        status: "ineligible",
      });
      await expect(
        commitThreadRewind(archived.deps, {
          idempotencyKey: "rewind-archived",
          request: request(archived.target),
          transport: successfulTransport(),
        }),
      ).rejects.toMatchObject({ body: { code: "target-ineligible" } });
    } finally {
      await archived.cleanup();
    }

    const deleted = await makeFixture();
    try {
      markThreadDeleted(deleted.db, deleted.deps.hub, {
        threadId: deleted.thread.id,
      });
      await expect(
        previewThreadRewind(deleted.deps, { target: deleted.target }),
      ).rejects.toMatchObject({ body: { code: "thread_not_found" } });
      await expect(
        commitThreadRewind(deleted.deps, {
          idempotencyKey: "rewind-deleted",
          request: request(deleted.target),
          transport: successfulTransport(),
        }),
      ).rejects.toMatchObject({ body: { code: "thread_not_found" } });
    } finally {
      await deleted.cleanup();
    }

    const compacted = await makeFixture();
    try {
      seedEvent(compacted.deps, {
        threadId: compacted.thread.id,
        environmentId: compacted.thread.environmentId,
        providerThreadId: "provider-root",
        sequence: compacted.nextSequence,
        type: "thread/compacted",
        scope: turnScope("compaction-turn"),
        data: {},
      });
      const compactedPreview = await previewThreadRewind(compacted.deps, {
        target: compacted.target,
      });
      expect(compactedPreview.eligibility).toEqual({
        reason: "compaction-boundary",
        status: "ineligible",
      });
      await expect(
        commitThreadRewind(compacted.deps, {
          idempotencyKey: "rewind-compacted",
          request: request(compacted.target),
          transport: successfulTransport(),
        }),
      ).rejects.toMatchObject({ body: { code: "target-ineligible" } });
    } finally {
      await compacted.cleanup();
    }
  });

  it("rejects fork and side-chat threads in preview", async () => {
    const forkFixture = await makeFixture({
      thread: { originKind: "fork", providerId: "codex", status: "idle" },
    });
    try {
      const preview = await previewThreadRewind(forkFixture.deps, {
        target: forkFixture.target,
      });
      expect(preview.eligibility).toEqual({
        reason: "fork-thread",
        status: "ineligible",
      });
    } finally {
      await forkFixture.cleanup();
    }

    const sideChat = await makeFixture({
      thread: {
        originPluginId: "side-chat",
        providerId: "codex",
        status: "idle",
      },
    });
    try {
      const preview = await previewThreadRewind(sideChat.deps, {
        target: sideChat.target,
      });
      expect(preview.eligibility).toEqual({
        reason: "fork-thread",
        status: "ineligible",
      });
    } finally {
      await sideChat.cleanup();
    }
  });

  it("preserves environment, tabs, terminals, search segments, goals, rate limits, task links, and fork provenance", async () => {
    const fixture = await makeFixture();
    try {
      const movedEnvironment = seedThreadFixture(
        { deps: fixture.deps },
        {},
      ).environment;
      updateThread(fixture.db, fixture.deps.hub, fixture.thread.id, {
        environmentId: movedEnvironment.id,
      });
      replaceStoredThreadTabs(fixture.db, {
        expectedRevision: 0,
        tabsJson: JSON.stringify(["chat", "workspace"]),
        threadId: fixture.thread.id,
      });
      createTerminalSession(fixture.db, {
        threadId: fixture.thread.id,
        environmentId: movedEnvironment.id,
        hostId: movedEnvironment.hostId,
        daemonSessionId: null,
        title: "rewind terminal",
        initialCwd: "/tmp",
        cols: 80,
        rows: 24,
        status: "running",
      });
      upsertThreadSearchSegments(fixture.db, {
        segments: [
          {
            threadId: fixture.thread.id,
            sourceKind: "user_message",
            sourceKey: "seq:1",
            sourceSeq: 1,
            text: "original first message",
          },
          {
            threadId: fixture.thread.id,
            sourceKind: "user_message",
            sourceKey: "seq:5",
            sourceSeq: 5,
            text: "later message",
          },
        ],
      });
      seedEvent(fixture.deps, {
        threadId: fixture.thread.id,
        environmentId: movedEnvironment.id,
        providerThreadId: "provider-root",
        sequence: fixture.nextSequence,
        type: "thread/goal/updated",
        scope: threadScope(),
        data: {
          objective: "finish the rewind",
          status: "active",
          tokenBudget: null,
          tokensUsed: 10,
          timeUsedSeconds: 5,
        },
      });
      seedEvent(fixture.deps, {
        threadId: fixture.thread.id,
        environmentId: movedEnvironment.id,
        providerThreadId: "provider-root",
        sequence: fixture.nextSequence + 1,
        type: "provider/rateLimits/updated",
        scope: threadScope(),
        data: {
          rateLimits: {
            providerId: "codex",
            status: "allowed",
            kind: "credits",
            windows: [],
            reachedReason: null,
            overageStatus: null,
            overageReason: null,
          },
        },
      });
      fixture.db
        .insert(pluginKv)
        .values({
          pluginId: "tasks",
          key: `task-link:${fixture.thread.id}`,
          value: JSON.stringify({ title: "Rewind task" }),
          updatedAt: Date.now(),
        })
        .run();
      const child = seedThread(fixture.deps, {
        projectId: fixture.thread.projectId,
        providerId: "codex",
        parentThreadId: fixture.thread.id,
        originKind: "fork",
        status: "idle",
      });
      const childSourceBranchId = getThreadSourceBranchId(fixture.db, child.id);

      const result = await commitThreadRewind(fixture.deps, {
        idempotencyKey: "rewind-survivors",
        request: request(fixture.target),
        transport: successfulTransport(),
      });
      expect(result.submission).toBe("submitted");
      expect(result.result.threadId).toBe(fixture.thread.id);
      expect(
        fixture.db
          .select({ environmentId: threads.environmentId })
          .from(threads)
          .where(eq(threads.id, fixture.thread.id))
          .get()?.environmentId,
      ).toBe(movedEnvironment.id);
      expect(getStoredThreadTabs(fixture.db, fixture.thread.id)).toMatchObject({
        tabsJson: JSON.stringify(["chat", "workspace"]),
      });
      expect(
        listTerminalSessionsByThread(fixture.db, fixture.thread.id),
      ).toHaveLength(1);
      expect(
        fixture.db
          .select({ text: threadSearchSegments.text })
          .from(threadSearchSegments)
          .where(eq(threadSearchSegments.threadId, fixture.thread.id))
          .all()
          .map((row) => row.text),
      ).toEqual(
        expect.arrayContaining(["original first message", "later message"]),
      );
      expect(
        fixture.db
          .select({ type: events.type })
          .from(events)
          .where(eq(events.threadId, fixture.thread.id))
          .all()
          .map((row) => row.type),
      ).toEqual(
        expect.arrayContaining([
          "thread/goal/updated",
          "provider/rateLimits/updated",
        ]),
      );
      expect(
        fixture.db
          .select({ value: pluginKv.value })
          .from(pluginKv)
          .where(eq(pluginKv.key, `task-link:${fixture.thread.id}`))
          .get(),
      ).toMatchObject({ value: JSON.stringify({ title: "Rewind task" }) });
      expect(
        fixture.db
          .select({ id: threads.id, sourceThreadId: threads.sourceThreadId })
          .from(threads)
          .where(eq(threads.id, child.id))
          .get(),
      ).toMatchObject({ id: child.id, sourceThreadId: fixture.thread.id });
      expect(getThreadSourceBranchId(fixture.db, child.id)).toBe(
        childSourceBranchId,
      );
      expect(getThreadSourceBranchId(fixture.db, child.id)).toBe(
        fixture.rootBranchId,
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps events gapless and branch-consistent across repeated rewinds and a restore", async () => {
    const fixture = await makeFixture();
    try {
      const first = await commitThreadRewind(fixture.deps, {
        idempotencyKey: "rewind-cycle-1",
        request: request(fixture.target),
        transport: successfulTransport(),
      });
      expect(first.submission).toBe("submitted");

      // Complete the edited turn so it becomes a valid rewind target.
      const editedRequestSequence =
        fixture.db
          .select({ sequence: events.sequence })
          .from(events)
          .where(
            and(
              eq(events.threadId, fixture.thread.id),
              eq(events.type, "client/turn/requested"),
            ),
          )
          .all()
          .map((row) => row.sequence)
          .at(-1) ?? 0;
      upsertThreadRewindCheckpoint(fixture.db, {
        anchor: { provider: "codex", turnId: "before-rewind-turn" },
        branchId: first.newBranchId,
        providerThreadId: "provider-rewind",
        sourceSequence: editedRequestSequence,
        threadId: fixture.thread.id,
        turnId: "rewind-turn-1",
      });
      const firstTurnSequence =
        Math.max(
          ...fixture.db
            .select({ sequence: events.sequence })
            .from(events)
            .where(eq(events.threadId, fixture.thread.id))
            .all()
            .map((row) => row.sequence),
        ) + 1;
      seedEvent(fixture.deps, {
        threadId: fixture.thread.id,
        environmentId: fixture.thread.environmentId,
        providerThreadId: "provider-rewind",
        sequence: firstTurnSequence,
        type: "turn/started",
        scope: turnScope("rewind-turn-1"),
        data: { providerThreadId: "provider-rewind" },
      });
      seedEvent(fixture.deps, {
        threadId: fixture.thread.id,
        environmentId: fixture.thread.environmentId,
        providerThreadId: "provider-rewind",
        sequence: firstTurnSequence + 1,
        type: "turn/input/accepted",
        scope: turnScope("rewind-turn-1"),
        data: { clientRequestId: first.requestId },
      });
      seedEvent(fixture.deps, {
        threadId: fixture.thread.id,
        environmentId: fixture.thread.environmentId,
        providerThreadId: "provider-rewind",
        sequence: firstTurnSequence + 2,
        type: "turn/completed",
        scope: turnScope("rewind-turn-1"),
        data: { providerThreadId: "provider-rewind", status: "completed" },
      });
      applyThreadLifecycleEvent(fixture.db, fixture.deps.hub, {
        event: { type: "run.succeeded" },
        threadId: fixture.thread.id,
      });

      const secondTarget = {
        branchId: first.newBranchId,
        sourceSequence: editedRequestSequence,
        turnId: "rewind-turn-1",
      };
      const second = await commitThreadRewind(fixture.deps, {
        idempotencyKey: "rewind-cycle-2",
        request: request(secondTarget),
        transport: successfulTransport(),
      });
      expect(second.submission).toBe("submitted");
      applyThreadLifecycleEvent(fixture.db, fixture.deps.hub, {
        event: { type: "run.succeeded" },
        threadId: fixture.thread.id,
      });

      const restored = restoreThreadRewindBranch(fixture.deps, {
        branchId: fixture.rootBranchId,
        expectedActiveBranchId: second.newBranchId,
        threadId: fixture.thread.id,
      });
      expect(restored.activeBranchId).toBe(fixture.rootBranchId);

      const allEvents = fixture.db
        .select({ sequence: events.sequence, branchId: events.branchId })
        .from(events)
        .where(eq(events.threadId, fixture.thread.id))
        .orderBy(events.sequence)
        .all();
      expect(allEvents.map((row) => row.sequence)).toEqual(
        Array.from({ length: allEvents.length }, (_, index) => index + 1),
      );
      const branches = listThreadBranches(fixture.db, {
        threadId: fixture.thread.id,
      });
      expect(
        branches.filter((branch) => branch.lifecycle === "active"),
      ).toHaveLength(1);
      expect(
        branches.filter((branch) => branch.lifecycle === "available"),
      ).toHaveLength(2);
      const active = getActiveThreadBranch(fixture.db, fixture.thread.id);
      expect(active?.id).toBe(fixture.rootBranchId);
      const metrics = listRewindRolloutMetrics(fixture.db);
      expect(metrics.restore).toBe(1);
      expect(metrics.provider_branch_failure).toBeUndefined();
      expect(metrics.activation_failure).toBeUndefined();
      expect(metrics.edited_turn_failure).toBeUndefined();
      const branchIds = new Set(branches.map((branch) => branch.id));
      expect(
        allEvents
          .map((row) => row.branchId)
          .every((branchId) => branchIds.has(branchId ?? "")),
      ).toBe(true);
      // The edited message of the first rewind keeps its branch provenance.
      expect(
        allEvents.find((row) => row.sequence === editedRequestSequence)
          ?.branchId,
      ).toBe(first.newBranchId);
    } finally {
      await fixture.cleanup();
    }
  });
});
