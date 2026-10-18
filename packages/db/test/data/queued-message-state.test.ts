import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID, type QueuedMessageWaitingOn } from "@bb/domain";
import { noopNotifier } from "../../src/notifier.js";
import {
  claimQueuedThreadMessageGroup,
  clearQueuedThreadMessageWaitingOn,
  createQueuedThreadMessage,
  getQueuedThreadMessage,
  releaseQueuedMessageClaim,
  releaseStaleQueuedMessageClaims,
  requeueClaimedQueuedThreadMessages,
  setQueuedThreadMessageFailureReason,
  setQueuedThreadMessageWaitingOn,
} from "../../src/data/queued-thread-messages.js";
import { createThread } from "../../src/data/threads.js";
import { createMigratedConnection } from "../../src/testing.js";

const RETRY_DELAYS_MS = [10, 20] as const;

function setup() {
  const db = createMigratedConnection();
  const thread = createThread(db, noopNotifier, {
    projectId: PERSONAL_PROJECT_ID,
    providerId: "codex",
    status: "idle",
  });
  const queue = (waitingOn: QueuedMessageWaitingOn | null, sendAt: number | null) =>
    createQueuedThreadMessage(db, noopNotifier, {
      threadId: thread.id,
      content: [{ type: "text", text: "hello", mentions: [] }],
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
      waitingOn,
      sendAt,
      payload: { kind: "inline" },
      systemNotice: null,
    });
  return { db, queue, threadId: thread.id };
}

describe("queued message state", () => {
  it("walks a row through every state its writers can reach", () => {
    const { db, queue, threadId } = setup();
    const row = queue(null, null);
    expect(row.state).toBe("queued");

    const scheduled = setQueuedThreadMessageWaitingOn(db, noopNotifier, {
      id: row.id,
      threadId,
      waitingOn: { kind: "time" },
      sendAt: 5_000,
    });
    expect(scheduled?.state).toBe("scheduled");

    const [claimed] =
      claimQueuedThreadMessageGroup(db, noopNotifier, row.id, {
        kind: "explicit-send",
      }) ?? [];
    expect(claimed?.state).toBe("claimed");

    const requeued = requeueClaimedQueuedThreadMessages(db, noopNotifier, {
      claims: [{ id: row.id, claimToken: claimed!.claimToken }],
      threadId,
      waitingOn: { kind: "plugin", pluginId: "limiter", reason: "full" },
      sendAt: null,
    });
    expect(requeued).toMatchObject({
      state: "waiting",
      waitHolder: "plugin:limiter",
      claimedAt: null,
    });

    const fail = () =>
      setQueuedThreadMessageFailureReason(db, noopNotifier, {
        id: row.id,
        threadId,
        failureReason: "Provider not ready",
        now: 1_000,
        retryDelaysMs: RETRY_DELAYS_MS,
      });
    expect(fail()).toMatchObject({
      state: "failed_retrying",
      failureCount: 1,
      nextAttemptAt: 1_010,
    });

    const [retrying] =
      claimQueuedThreadMessageGroup(db, noopNotifier, row.id, {
        kind: "automatic",
        isGroupEligible: () => true,
        retryingFailure: true,
      }) ?? [];
    expect(retrying?.state).toBe("claimed");
    expect(
      releaseQueuedMessageClaim(db, noopNotifier, {
        id: row.id,
        claimToken: retrying!.claimToken,
      }),
    ).toBe(true);
    expect(getQueuedThreadMessage(db, row.id)?.state).toBe("failed_retrying");

    fail();
    expect(fail()).toMatchObject({
      state: "failed_exhausted",
      failureCount: 3,
      nextAttemptAt: null,
    });

    expect(
      clearQueuedThreadMessageWaitingOn(db, noopNotifier, {
        id: row.id,
        threadId,
      }),
    ).toMatchObject({
      state: "failed_exhausted",
      waitingOn: null,
      waitHolder: null,
    });

    expect(
      setQueuedThreadMessageWaitingOn(db, noopNotifier, {
        id: row.id,
        threadId,
        waitingOn: { kind: "thread-busy" },
        sendAt: null,
      }),
    ).toMatchObject({
      state: "waiting",
      failureReason: null,
      failureCount: 0,
    });
  });

  it("releases a stale claim back to the state the row was claimed from", () => {
    const { db, queue } = setup();
    const scheduled = queue({ kind: "time" }, 5_000);
    const waiting = queue({ kind: "provisioning" }, null);
    for (const row of [scheduled, waiting]) {
      claimQueuedThreadMessageGroup(db, noopNotifier, row.id, {
        kind: "explicit-send",
      });
    }

    expect(
      releaseStaleQueuedMessageClaims(db, noopNotifier, {
        claimedBefore: Date.now() + 1,
        protectedClaimTokens: [],
      }),
    ).toBe(2);
    expect(getQueuedThreadMessage(db, scheduled.id)?.state).toBe("scheduled");
    expect(getQueuedThreadMessage(db, waiting.id)?.state).toBe("waiting");
  });

  it("refuses to create a scheduled row with no wait", () => {
    const { queue } = setup();
    expect(() => queue(null, 5_000)).toThrow(
      /queued_thread_messages_schedule_check/,
    );
  });

  it("rejects raw writes that leave a row no state can describe", () => {
    const { db, queue } = setup();
    const row = queue({ kind: "thread-busy" }, null);
    const write = (assignments: string) => () =>
      db.$client
        .prepare(`UPDATE queued_thread_messages SET ${assignments} WHERE id = ?`)
        .run(row.id);

    expect(write("claimed_at = 1")).toThrow(/CHECK constraint failed/);
    expect(write("claimed_at = 1, claim_token = 'c', state = 'waiting'")).toThrow(
      /queued_thread_messages_state_check/,
    );
    expect(write("failure_reason = 'x', state = 'failed_exhausted'")).toThrow(
      /queued_thread_messages_failure_check/,
    );
    expect(write("wait_holder = 'plugin:limiter'")).toThrow(
      /queued_thread_messages_wait_holder_check/,
    );
    expect(write("state = 'queued'")).toThrow(
      /queued_thread_messages_state_check/,
    );
    expect(write("state = 'paused'")).toThrow(
      /queued_thread_messages_state_check/,
    );
  });
});
