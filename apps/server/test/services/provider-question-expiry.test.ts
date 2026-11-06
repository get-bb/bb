import { expect, it, vi } from "vitest";
import { createPendingInteraction } from "@bb/db";
import type { PendingInteractionCreate } from "@bb/domain";
import { hostDaemonServerWsMessageSchema } from "@bb/host-daemon-contract";
import { PendingInteractionLifecycle } from "../../src/services/interactions/pending-interactions.js";
import {
  SERVER_MOVE_FROZEN_RETRY_MS,
  setServerMoveFrozen,
} from "../../src/services/server-move/freeze-state.js";
import {
  createCommandApprovalPayload,
  createUserAnswerResolution,
  createUserQuestionPayload,
} from "../helpers/pending-interactions.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedQuestion(harness: TestAppHarness) {
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "claude-code",
  });
  const socket = createMockHubSocket();
  harness.deps.hub.registerDaemon(session.id, host.id, socket);
  const request: PendingInteractionCreate = {
    threadId: thread.id,
    turnId: "turn-expiry-regression",
    providerId: "claude-code",
    providerThreadId: "provider-thread-expiry-regression",
    providerRequestId: "request-expiry-regression",
    payload: createUserQuestionPayload(),
  };
  seedTurnStarted(harness.deps, request);
  const endedRequests = () =>
    socket.messages
      .map((message) =>
        hostDaemonServerWsMessageSchema.parse(JSON.parse(message)),
      )
      .filter((message) => message.type === "interactive-requests.end");
  const register = () => {
    const created = harness.deps.pendingInteractions.registerPendingInteraction(
      {
        interaction: request,
      },
    );
    if (created.outcome === "rejected") throw new Error(created.reason);
    return created.interaction;
  };
  return { thread, request, endedRequests, register };
}

async function withQuestionClock(
  run: (harness: TestAppHarness) => Promise<void>,
) {
  await withTestHarness(async (harness) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      await run(harness);
    } finally {
      setServerMoveFrozen(harness.db, false);
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
}

it("releases an unanswered native provider question after thirty minutes", async () => {
  await withQuestionClock(async (harness) => {
    const { thread, request, endedRequests, register } = seedQuestion(harness);
    const interaction = register();
    const settled = vi.fn();
    harness.deps.pendingInteractions.setThreadInteractionSettledListener(
      settled,
    );
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    expect(
      harness.deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(
        thread.id,
      ),
    ).toBe(true);
    register();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(
      harness.deps.pendingInteractions.getThreadInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
      }),
    ).toMatchObject({ status: "interrupted", resolution: null });
    expect(
      harness.deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(
        thread.id,
      ),
    ).toBe(false);
    expect(settled).toHaveBeenCalledExactlyOnceWith(thread.id);
    expect(endedRequests()).toEqual([
      {
        type: "interactive-requests.end",
        requests: [
          {
            threadId: thread.id,
            providerId: request.providerId,
            providerThreadId: request.providerThreadId,
            providerRequestId: request.providerRequestId,
          },
        ],
        reason: expect.stringContaining("30 minutes"),
      },
    ]);
  });
});

it("does not interrupt an answer already being delivered at the deadline", async () => {
  await withQuestionClock(async (harness) => {
    const { thread, endedRequests, register } = seedQuestion(harness);
    const interaction = register();
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    harness.deps.pendingInteractions.resolvePendingInteraction({
      threadId: thread.id,
      interactionId: interaction.id,
      resolution: createUserAnswerResolution(),
    });
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(
      harness.deps.pendingInteractions.getThreadInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
      }),
    ).toMatchObject({
      status: "resolving",
      resolution: createUserAnswerResolution(),
    });
    expect(endedRequests()).toEqual([]);
  });
});

it("keeps native approvals pending instead of treating them as questions", async () => {
  await withQuestionClock(async (harness) => {
    const { thread, request, endedRequests, register } = seedQuestion(harness);
    request.payload = createCommandApprovalPayload();
    const interaction = register();
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    expect(
      harness.deps.pendingInteractions.getThreadInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
      }),
    ).toMatchObject({ status: "pending" });
    expect(
      harness.deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(
        thread.id,
      ),
    ).toBe(true);
    expect(endedRequests()).toEqual([]);
  });
});

it("recovers an existing question without a stored deadline after restart", async () => {
  await withQuestionClock(async (harness) => {
    const { thread, request, endedRequests } = seedQuestion(harness);
    const row = createPendingInteraction(harness.db, {
      ...request,
      payload: JSON.stringify(request.payload),
      expiresAt: null,
    });
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    const restarted = new PendingInteractionLifecycle(harness.deps);
    restarted.start();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(
      restarted.getThreadInteraction({
        threadId: thread.id,
        interactionId: row.id,
      }),
    ).toMatchObject({ status: "interrupted" });
    expect(restarted.hasTurnBoundPendingThreadInteraction(thread.id)).toBe(
      false,
    );
    expect(endedRequests()).toHaveLength(1);
  });
});

it("defers question expiry while the server is moving", async () => {
  await withQuestionClock(async (harness) => {
    const { thread, register, endedRequests } = seedQuestion(harness);
    register();
    setServerMoveFrozen(harness.db, true);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(
      harness.deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(
        thread.id,
      ),
    ).toBe(true);
    expect(endedRequests()).toEqual([]);
    setServerMoveFrozen(harness.db, false);
    await vi.advanceTimersByTimeAsync(SERVER_MOVE_FROZEN_RETRY_MS);
    expect(
      harness.deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(
        thread.id,
      ),
    ).toBe(false);
    expect(endedRequests()).toHaveLength(1);
  });
});
