import type { ClientTurnRequestId } from "@bb/domain";
import {
  afterCommit,
  getThread,
  telemetryMessages,
  telemetryOrigins,
  telemetryThreads,
} from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendClientTurnEventInTransaction } from "../../src/services/threads/thread-events.js";
import { applyLoggedThreadLifecycleEventInTransaction } from "../../src/services/threads/lifecycle-outcome.js";
import { recordQueuedMessageWait } from "../../src/services/threads/queue-waits.js";
import {
  analyticsThreadProperties,
  withMessageOrigin,
} from "../../src/services/system/work-telemetry.js";
import { setTurnTelemetryDeps } from "../../src/services/system/turn-telemetry.js";
import type { TelemetryService } from "../../src/services/system/telemetry.js";
import { createTestAppHarness } from "../helpers/test-app.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import { createUserQuestionPayload } from "../helpers/pending-interactions.js";
import { textInput } from "../helpers/prompt-input.js";

afterEach(() => {
  setTurnTelemetryDeps(undefined);
  vi.restoreAllMocks();
});

async function setup() {
  const harness = await createTestAppHarness();
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
  });
  const capture = vi.fn<TelemetryService["capture"]>();
  let enabled = true;
  harness.deps.telemetry = {
    capture,
    isEnabled: () => enabled,
    setEnabled: (value) => {
      enabled = value;
    },
  };
  setTurnTelemetryDeps(harness.deps);
  const execution = {
    model: "test-model",
    reasoningLevel: "medium",
    permissionMode: "full" as const,
    serviceTier: "default",
    source: "client/turn/requested" as const,
  };
  const request = (
    options: {
      queuedIds?: string[];
      retry?: ClientTurnRequestId;
      steer?: boolean;
    } = {},
  ) =>
    withMessageOrigin(
      {
        threadId: thread.id,
        source: "thread_send",
        trigger: "person",
        captureMessage: !options.queuedIds && !options.retry,
        ...(options.queuedIds ? { queuedIds: options.queuedIds } : {}),
        ...(options.retry ? { retryRequestId: options.retry } : {}),
      },
      () =>
        harness.db.transaction((db) => {
          const accepted = appendClientTurnEventInTransaction(db, {
            threadId: thread.id,
            environmentId: environment.id,
            type: "client/turn/requested",
            input: textInput("private work"),
            execution,
            initiator: options.retry ? "system" : "user",
            senderThreadId: null,
            requestMethod: "turn/start",
            source: "tell",
            target: options.steer
              ? { kind: "steer", expectedTurnId: "live-turn" }
              : { kind: "new-turn" },
            ...(options.retry
              ? { retryOf: { requestId: options.retry, attempt: 2 } }
              : {}),
          });
          if (!options.steer)
            applyLoggedThreadLifecycleEventInTransaction(
              { db, logger: harness.deps.logger },
              { threadId: thread.id, event: { type: "run.started" } },
            );
          return accepted;
        }),
    );
  const settle = (type: "run.succeeded" | "run.failed") =>
    harness.db.transaction((db) =>
      applyLoggedThreadLifecycleEventInTransaction(
        { db, logger: harness.deps.logger },
        { threadId: thread.id, event: { type } },
      ),
    );
  const queue = (beforeAccept?: () => void) =>
    withMessageOrigin(
      {
        threadId: thread.id,
        source: "queued_message",
        trigger: "person",
        captureMessage: true,
      },
      () => {
        beforeAccept?.();
        return recordQueuedMessageWait(harness.deps, {
          thread,
          claimed: null,
          sendAt: null,
          waitingOn: { kind: "thread-busy" },
          message: {
            input: textInput("private queued work"),
            execution,
            senderThreadId: null,
            origin: null,
            originPluginId: null,
            requestedBy: null,
            payload: { kind: "inline" },
            systemNotice: null,
          },
        })!;
      },
    );
  return { harness, thread, capture, request, settle, queue };
}

describe("work analytics lineage", () => {
  it("preserves grouped accepted messages and their timestamps through a retry, without attributing steering", async () => {
    const { harness, thread, capture, request, settle, queue } = await setup();
    try {
      const now = vi.spyOn(Date, "now").mockReturnValue(1_799_999_940_000);
      const first = queue(() => now.mockReturnValue(1_800_000_000_000));
      now.mockReturnValue(1_800_086_400_001);
      const second = queue();
      const messages = capture.mock.calls.filter(
        ([event]) => event.name === "user_message_sent",
      );
      expect(messages.map(([, time]) => time)).toEqual([
        1_800_000_000_000, 1_800_086_400_001,
      ]);
      const tokens = messages.map(([event]) =>
        event.name === "user_message_sent"
          ? event.properties.request_analytics_id
          : undefined,
      );
      expect(new Set(tokens).size).toBe(2);
      expect(
        tokens.every(
          (id) => typeof id === "string" && /^[0-9a-f]{32}$/.test(id),
        ),
      ).toBe(true);
      const original = request({ queuedIds: [first.id, second.id] });
      request({ steer: true });
      settle("run.failed");
      request({ retry: original.requestId });
      settle("run.succeeded");
      const outcomes = capture.mock.calls
        .map(([event]) => event)
        .filter((event) => event.name === "turn_finished");
      expect(outcomes).toHaveLength(2);
      expect(outcomes[0]?.properties).toMatchObject({
        request_link: "grouped",
        request_analytics_ids: tokens,
        attempt_kind: "initial",
        outcome: "failed",
      });
      expect(outcomes[1]?.properties).toMatchObject({
        request_link: "grouped",
        request_analytics_ids: tokens,
        attempt_kind: "retry",
        outcome: "completed",
      });
      expect(
        capture.mock.calls.filter(
          ([event]) => event.name === "user_message_sent",
        ),
      ).toHaveLength(3);
      const wire = JSON.stringify(capture.mock.calls);
      for (const secret of [
        thread.id,
        original.requestId,
        first.id,
        second.id,
        "private work",
        "private queued work",
      ])
        expect(wire).not.toContain(secret);
    } finally {
      await harness.cleanup();
    }
  });

  it("drops rolled-back work, including callbacks in nested transactions", async () => {
    const { harness, thread, capture, request } = await setup();
    try {
      const callback = vi.fn();
      expect(() =>
        harness.db.transaction((tx) => {
          tx.transaction((nested) => {
            afterCommit(nested, callback);
            request();
          });
          throw new Error("rollback");
        }),
      ).toThrow("rollback");
      expect(callback).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(harness.db.select().from(telemetryMessages).all()).toEqual([]);
      expect(harness.db.select().from(telemetryOrigins).all()).toEqual([]);
      expect(harness.db.select().from(telemetryThreads).all()).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps random thread identities stable and resolves a parent's token before its own export", async () => {
    const { harness, thread } = await setup();
    try {
      const child = seedThread(harness.deps, {
        projectId: thread.projectId,
        parentThreadId: thread.id,
      });
      const childIdentity = analyticsThreadProperties(harness.db, child);
      const parentIdentity = analyticsThreadProperties(harness.db, thread);
      expect(childIdentity.parent_analytics_id).toBe(
        parentIdentity.thread_analytics_id,
      );
      expect(childIdentity.thread_analytics_id).not.toBe(
        parentIdentity.thread_analytics_id,
      );
      expect(analyticsThreadProperties(harness.db, child)).toEqual(
        childIdentity,
      );
      expect(JSON.stringify(childIdentity)).not.toContain(child.id);
      expect(JSON.stringify(parentIdentity)).not.toContain(thread.id);
    } finally {
      await harness.cleanup();
    }
  });

  it("exports one user wait until the final interaction clears, and discards rolled-back clears", async () => {
    const { harness, thread, capture, request } = await setup();
    try {
      request();
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        turnId: "waiting-turn",
        providerThreadId: "provider-waiting",
      });
      const register = (providerRequestId: string) => {
        const result =
          harness.deps.pendingInteractions.registerPendingInteraction({
            interaction: {
              threadId: thread.id,
              turnId: "waiting-turn",
              providerId: thread.providerId,
              providerThreadId: "provider-waiting",
              providerRequestId,
              payload: createUserQuestionPayload(),
            },
          });
        if (result.outcome === "rejected") throw new Error(result.reason);
        return result.interaction.id;
      };
      const first = register("question-one");
      const second = register("question-two");
      const transitions = () =>
        capture.mock.calls.flatMap(([event]) =>
          event.name === "thread_lifecycle" &&
          event.properties.transition.startsWith("waiting_")
            ? [event.properties.transition]
            : [],
        );
      expect(transitions()).toEqual(["waiting_on_user"]);
      const clear = (interactionId: string) =>
        harness.db.transaction((db) =>
          harness.deps.pendingInteractions.interruptPendingInteractionInTransaction(
            { db, hub: harness.deps.hub },
            { interactionId, reason: "Provider ended" },
          ),
        );
      clear(first);
      expect(transitions()).toEqual(["waiting_on_user"]);
      expect(() =>
        harness.db.transaction(() => {
          clear(second);
          throw new Error("rollback clear");
        }),
      ).toThrow("rollback clear");
      expect(transitions()).toEqual(["waiting_on_user"]);
      clear(second);
      expect(transitions()).toEqual(["waiting_on_user", "waiting_cleared"]);
    } finally {
      await harness.cleanup();
    }
  });

  it("does not backfill disabled-period messages or guess missing queue provenance", async () => {
    const { harness, capture, request, settle, queue } = await setup();
    try {
      harness.deps.telemetry.setEnabled(false);
      const hidden = queue();
      expect(capture).not.toHaveBeenCalled();
      harness.deps.telemetry.setEnabled(true);
      request({ queuedIds: [hidden.id] });
      settle("run.succeeded");
      expect(
        capture.mock.calls.filter(
          ([event]) => event.name === "user_message_sent",
        ),
      ).toEqual([]);
      const outcome = capture.mock.calls
        .map(([event]) => event)
        .find((event) => event.name === "turn_finished");
      expect(outcome?.properties).toMatchObject({
        request_link: "unavailable",
        outcome: "completed",
      });
      expect(outcome?.properties).not.toHaveProperty("request_analytics_id");
      expect(outcome?.properties).not.toHaveProperty("request_analytics_ids");
    } finally {
      await harness.cleanup();
    }
  });
});
