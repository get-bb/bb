import { getEnvironment, getThread, listEvents } from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  parseStoredThreadEvent,
  threadScope,
  turnScope,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  continueThreadFailedTurn,
  inspectThreadFailedTurn,
} from "../../../src/services/threads/failed-turn-continuation.js";
import {
  listQueuedThreadCommands,
  waitForQueuedCommand,
} from "../../helpers/commands.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const FAILED_REQUEST_ID = encodeClientTurnRequestIdNumber({ value: 41 });
const NEWER_REQUEST_ID = encodeClientTurnRequestIdNumber({ value: 42 });

function seedFailedTurn(
  harness: TestAppHarness,
  options: {
    accepted?: boolean;
    environmentStatus?: "ready" | "retiring";
    manualStopBeforeCompletion?: boolean;
  } = {},
) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    status: options.environmentStatus,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    providerId: "codex",
    status: "error",
  });
  const providerThreadId = "provider-thread-failed";
  const turnId = "turn-failed";
  seedEvent(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId,
    sequence: 1,
    type: "thread/identity",
    scope: threadScope(),
    data: {},
  });
  seedEvent(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    sequence: 2,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: FAILED_REQUEST_ID,
      source: "tell",
      initiator: "user",
      senderThreadId: null,
      input: [{ type: "text", text: "Finish the task", mentions: [] }],
      target: { kind: "new-turn" },
      request: { method: "turn/start", params: {} },
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
    },
  });
  seedEvent(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId,
    sequence: 3,
    type: "turn/started",
    scope: turnScope(turnId),
    data: { providerThreadId },
  });
  let nextSequence = 4;
  if (options.accepted !== false) {
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId,
      sequence: nextSequence,
      type: "turn/input/accepted",
      scope: turnScope(turnId),
      data: { providerThreadId, clientRequestId: FAILED_REQUEST_ID },
    });
    nextSequence += 1;
  }
  seedEvent(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId,
    sequence: nextSequence,
    type: "provider/error",
    scope: turnScope(turnId),
    data: {
      providerThreadId,
      message: "Provider failed",
      errorInfo: {
        category: "internal",
        providerCode: "provider_failed",
        httpStatusCode: 500,
      },
    },
  });
  nextSequence += 1;
  if (options.manualStopBeforeCompletion) {
    seedEvent(harness.deps, {
      threadId: thread.id,
      sequence: nextSequence,
      type: "system/thread/interrupted",
      scope: threadScope(),
      data: { reason: "manual-stop" },
    });
    nextSequence += 1;
  }
  seedEvent(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId,
    sequence: nextSequence,
    type: "turn/completed",
    scope: turnScope(turnId),
    data: { providerThreadId, status: "failed" },
  });
  return {
    environment,
    host,
    nextSequence: nextSequence + 1,
    providerThreadId,
    thread,
    turnId,
  };
}

function seedProviderOnlyFailedTurn(
  harness: TestAppHarness,
  fixture: ReturnType<typeof seedFailedTurn>,
): number {
  const turnId = "turn-provider-drain";
  seedEvent(harness.deps, {
    threadId: fixture.thread.id,
    environmentId: fixture.environment.id,
    providerThreadId: fixture.providerThreadId,
    sequence: fixture.nextSequence,
    type: "turn/started",
    scope: turnScope(turnId),
    data: { providerThreadId: fixture.providerThreadId },
  });
  seedEvent(harness.deps, {
    threadId: fixture.thread.id,
    environmentId: fixture.environment.id,
    providerThreadId: fixture.providerThreadId,
    sequence: fixture.nextSequence + 1,
    type: "turn/completed",
    scope: turnScope(turnId),
    data: {
      providerThreadId: fixture.providerThreadId,
      status: "failed",
    },
  });
  return fixture.nextSequence + 2;
}

function seedNewerRequest(
  harness: TestAppHarness,
  fixture: ReturnType<typeof seedFailedTurn>,
  sequence: number,
): void {
  seedEvent(harness.deps, {
    threadId: fixture.thread.id,
    environmentId: fixture.environment.id,
    sequence,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: NEWER_REQUEST_ID,
      source: "tell",
      initiator: "user",
      senderThreadId: null,
      input: [{ type: "text", text: "Try something else", mentions: [] }],
      target: { kind: "new-turn" },
      request: { method: "turn/start", params: {} },
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
    },
  });
}

describe("failed-turn continuation", () => {
  it("identifies an accepted failed turn without provider-specific policy", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedTurn(harness);

      const inspection = inspectThreadFailedTurn(harness.deps, fixture);

      expect(inspection).toMatchObject({
        reason: "eligible",
        candidate: {
          failedRequestId: FAILED_REQUEST_ID,
          hostId: fixture.host.id,
          providerId: "codex",
          turnId: fixture.turnId,
        },
      });
      expect(inspection.candidate?.events.map((event) => event.type)).toEqual([
        "client/turn/requested",
        "turn/started",
        "turn/input/accepted",
        "provider/error",
        "turn/completed",
      ]);
    });
  });

  it("keeps the accepted failure when a later provider-only turn fails", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedTurn(harness);
      seedProviderOnlyFailedTurn(harness, fixture);

      const inspection = inspectThreadFailedTurn(harness.deps, fixture);

      expect(inspection).toMatchObject({
        reason: "eligible",
        candidate: {
          failedRequestId: FAILED_REQUEST_ID,
          turnId: fixture.turnId,
        },
      });
      expect(inspection.candidate?.events.at(-1)).toMatchObject({
        type: "turn/completed",
        scope: { kind: "turn", turnId: "turn-provider-drain" },
      });
    });
  });

  it("rejects a failure superseded by a newer client request", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedTurn(harness);
      const sequence = seedProviderOnlyFailedTurn(harness, fixture);
      seedNewerRequest(harness, fixture, sequence);

      expect(inspectThreadFailedTurn(harness.deps, fixture)).toEqual({
        candidate: null,
        reason: "superseded",
      });
    });
  });

  it("rejects a failure superseded by an explicit user stop", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedTurn(harness, {
        manualStopBeforeCompletion: true,
      });

      expect(inspectThreadFailedTurn(harness.deps, fixture)).toEqual({
        candidate: null,
        reason: "superseded",
      });
    });
  });

  it("does not offer a provider-only failed turn with no accepted input", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedTurn(harness, { accepted: false });

      expect(inspectThreadFailedTurn(harness.deps, fixture)).toEqual({
        candidate: null,
        reason: "input-not-accepted",
      });
    });
  });

  it("atomically starts one agent-only continuation with original execution options", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedTurn(harness);
      const result = await continueThreadFailedTurn(harness.deps, {
        environment: fixture.environment,
        failedRequestId: FAILED_REQUEST_ID,
        instruction: "Resume after the external condition clears.",
        pluginId: "test-recovery",
        thread: fixture.thread,
      });

      expect(result.requestId).toBeTruthy();
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
      const events = listEvents(harness.db, {
        threadId: fixture.thread.id,
      }).map((row) =>
        parseStoredThreadEvent({
          type: row.type,
          data: JSON.parse(row.data) as Record<string, unknown>,
          providerThreadId: row.providerThreadId,
          scope:
            row.scopeKind === "turn" && row.turnId
              ? turnScope(row.turnId)
              : threadScope(),
          threadId: row.threadId,
        }),
      );
      expect(
        events.find(
          (event) =>
            event.type === "client/turn/requested" &&
            event.continuationOfRequestId === FAILED_REQUEST_ID,
        ),
      ).toMatchObject({
        type: "client/turn/requested",
        initiator: "system",
        continuationOfRequestId: FAILED_REQUEST_ID,
        input: [
          {
            type: "text",
            text: "Resume after the external condition clears.",
            visibility: "agent-only",
          },
        ],
      });
      expect(
        events.find(
          (event) =>
            event.type === "system/operation" &&
            event.operation === "failed_turn_continuation",
        ),
      ).toMatchObject({
        message: "Continued a failed turn",
        metadata: {
          pluginId: "test-recovery",
          failedRequestId: FAILED_REQUEST_ID,
        },
      });
      await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "turn.submit" &&
          queued.command.threadId === fixture.thread.id,
      );
      expect(
        listQueuedThreadCommands(harness, "turn.submit", fixture.thread.id),
      ).toEqual([
        expect.objectContaining({
          input: [
            expect.objectContaining({
              text: "Resume after the external condition clears.",
              visibility: "agent-only",
            }),
          ],
          options: expect.objectContaining({
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
          }),
          resumeContext: expect.objectContaining({
            providerThreadId: fixture.providerThreadId,
          }),
          target: { mode: "start" },
          type: "turn.submit",
        }),
      ]);

      await expect(
        continueThreadFailedTurn(harness.deps, {
          environment: fixture.environment,
          failedRequestId: FAILED_REQUEST_ID,
          instruction: "Do not duplicate this continuation.",
          pluginId: "test-recovery",
          thread: fixture.thread,
        }),
      ).rejects.toMatchObject({
        body: {
          code: "failed_turn_continuation_unavailable",
          details: { reason: "superseded" },
        },
        status: 409,
      });
      expect(
        listQueuedThreadCommands(harness, "turn.submit", fixture.thread.id),
      ).toHaveLength(1);
    });
  });

  it("revives a retiring environment before continuing", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedTurn(harness, {
        environmentStatus: "retiring",
      });

      await continueThreadFailedTurn(harness.deps, {
        environment: fixture.environment,
        failedRequestId: FAILED_REQUEST_ID,
        instruction: "Continue.",
        pluginId: "test-recovery",
        thread: fixture.thread,
      });

      expect(getEnvironment(harness.db, fixture.environment.id)?.status).toBe(
        "ready",
      );
    });
  });
});
