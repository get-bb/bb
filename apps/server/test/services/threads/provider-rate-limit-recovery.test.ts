import { getEnvironment, getThread, listEvents } from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  parseStoredThreadEvent,
  threadScope,
  turnScope,
  type ProviderRateLimitState,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { getProviderRateLimitRecoveryStatus } from "../../../src/services/threads/provider-rate-limit-recovery.js";
import { listQueuedThreadCommands } from "../../helpers/commands.js";
import { readJson } from "../../helpers/json.js";
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
const STEER_REQUEST_ID = encodeClientTurnRequestIdNumber({ value: 42 });
const RESET_AT_MS = Date.now() + 5 * 60 * 60 * 1_000;
const RATE_LIMITS: ProviderRateLimitState = {
  providerId: "codex",
  status: "blocked",
  kind: "subscription-window",
  windows: [
    {
      providerKey: "primary",
      label: "Current session",
      status: "blocked",
      resetsAtMs: RESET_AT_MS,
    },
  ],
  reachedReason: "rate_limit_reached",
  overageStatus: null,
  overageReason: null,
};

function seedFailedRateLimitedTurn(
  harness: TestAppHarness,
  options: {
    environmentStatus?: "ready" | "retiring";
    rateLimitBeforeTurn?: boolean;
    rateLimits?: ProviderRateLimitState;
    steeredAfterOutput?: boolean;
    withOutput?: boolean;
    withoutRateLimitError?: boolean;
    willRetry?: boolean;
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
  const providerThreadId = "provider-thread-rate-limited";
  const turnId = "turn-rate-limited";
  const rateLimits = options.rateLimits ?? RATE_LIMITS;
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
  let nextSequence = 3;
  if (options.rateLimitBeforeTurn) {
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId,
      sequence: nextSequence,
      type: "provider/rateLimits/updated",
      scope: threadScope(),
      data: { providerThreadId, rateLimits },
    });
    nextSequence += 1;
  }
  seedEvent(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId,
    sequence: nextSequence,
    type: "turn/started",
    scope: turnScope(turnId),
    data: { providerThreadId },
  });
  nextSequence += 1;
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
  if (options.steeredAfterOutput) {
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId,
      sequence: nextSequence,
      type: "turn/plan/updated",
      scope: turnScope(turnId),
      data: {
        providerThreadId,
        plan: [{ step: "Started work", status: "active" }],
      },
    });
    nextSequence += 1;
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      sequence: nextSequence,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: STEER_REQUEST_ID,
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        input: [{ type: "text", text: "Also run tests", mentions: [] }],
        target: { kind: "steer", expectedTurnId: turnId },
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
    nextSequence += 1;
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId,
      sequence: nextSequence,
      type: "turn/input/accepted",
      scope: turnScope(turnId),
      data: { providerThreadId, clientRequestId: STEER_REQUEST_ID },
    });
    nextSequence += 1;
  }
  if (!options.rateLimitBeforeTurn) {
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId,
      sequence: nextSequence,
      type: "provider/rateLimits/updated",
      scope: threadScope(),
      data: { providerThreadId, rateLimits },
    });
    nextSequence += 1;
  }
  if (!options.withoutRateLimitError) {
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId,
      sequence: nextSequence,
      type: "provider/error",
      scope: turnScope(turnId),
      data: {
        providerThreadId,
        message: "Usage limit reached",
        ...(options.willRetry === undefined
          ? {}
          : { willRetry: options.willRetry }),
        errorInfo: {
          category: "rate-limit",
          providerCode: "usage_limit_reached",
          httpStatusCode: 429,
        },
      },
    });
    nextSequence += 1;
  }
  if (options.withOutput) {
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId,
      sequence: nextSequence,
      type: "turn/plan/updated",
      scope: turnScope(turnId),
      data: {
        providerThreadId,
        plan: [{ step: "Started work", status: "active" }],
      },
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
  return { environment, host, project, thread, turnId };
}

describe("provider rate-limit recovery", () => {
  it("identifies an accepted, empty subscription-limited turn", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedRateLimitedTurn(harness);
      const status = getProviderRateLimitRecoveryStatus(harness.deps, {
        environment: fixture.environment,
        thread: fixture.thread,
      });

      expect(status).toEqual({
        reason: "eligible",
        scopeKey: `${fixture.host.id}:codex`,
        hostId: fixture.host.id,
        rateLimits: RATE_LIMITS,
        candidate: {
          failedRequestId: FAILED_REQUEST_ID,
          turnId: fixture.turnId,
          automatic: true,
          resetsAtMs: RESET_AT_MS,
          rateLimits: RATE_LIMITS,
        },
      });
    });
  });

  it("inherits the last blocked state when a later 429 has no rate-limit update", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedRateLimitedTurn(harness, {
        rateLimitBeforeTurn: true,
      });

      expect(
        getProviderRateLimitRecoveryStatus(harness.deps, {
          environment: fixture.environment,
          thread: fixture.thread,
        }),
      ).toMatchObject({
        reason: "eligible",
        rateLimits: RATE_LIMITS,
        candidate: {
          failedRequestId: FAILED_REQUEST_ID,
          rateLimits: RATE_LIMITS,
          resetsAtMs: RESET_AT_MS,
        },
      });
    });
  });

  it("keeps output-bearing rate-limited turns eligible", async () => {
    await withTestHarness(async (harness) => {
      const outputFixture = seedFailedRateLimitedTurn(harness, {
        withOutput: true,
      });
      expect(
        getProviderRateLimitRecoveryStatus(harness.deps, {
          environment: outputFixture.environment,
          thread: outputFixture.thread,
        }),
      ).toMatchObject({
        reason: "eligible",
        candidate: { failedRequestId: FAILED_REQUEST_ID },
      });
    });
  });

  it("defers to provider-owned retries", async () => {
    await withTestHarness(async (harness) => {
      const retryFixture = seedFailedRateLimitedTurn(harness, {
        willRetry: true,
      });
      expect(
        getProviderRateLimitRecoveryStatus(harness.deps, {
          environment: retryFixture.environment,
          thread: retryFixture.thread,
        }).reason,
      ).toBe("provider-will-retry");
    });
  });

  it("continues from the latest accepted steer", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedRateLimitedTurn(harness, {
        steeredAfterOutput: true,
      });

      expect(
        getProviderRateLimitRecoveryStatus(harness.deps, {
          environment: fixture.environment,
          thread: fixture.thread,
        }),
      ).toMatchObject({
        reason: "eligible",
        candidate: { failedRequestId: STEER_REQUEST_ID },
      });
    });
  });

  it("requires a terminal rate-limit error from the failed turn", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedRateLimitedTurn(harness, {
        withoutRateLimitError: true,
      });

      expect(
        getProviderRateLimitRecoveryStatus(harness.deps, {
          environment: fixture.environment,
          thread: fixture.thread,
        }).reason,
      ).toBe("no-terminal-rate-limit-error");
    });
  });

  it("allows manual recovery for blocked limits without a reset time", async () => {
    await withTestHarness(async (harness) => {
      const creditsRateLimits: ProviderRateLimitState = {
        ...RATE_LIMITS,
        kind: "credits",
        windows: [],
      };
      const fixture = seedFailedRateLimitedTurn(harness, {
        rateLimits: creditsRateLimits,
      });

      expect(
        getProviderRateLimitRecoveryStatus(harness.deps, {
          environment: fixture.environment,
          thread: fixture.thread,
        }),
      ).toMatchObject({
        reason: "manual-only",
        candidate: {
          automatic: false,
          resetsAtMs: null,
          rateLimits: creditsRateLimits,
        },
      });
    });
  });

  it("rejects automatic recovery when the current candidate is manual-only", async () => {
    await withTestHarness(async (harness) => {
      const creditsRateLimits: ProviderRateLimitState = {
        ...RATE_LIMITS,
        kind: "credits",
        windows: [],
      };
      const fixture = seedFailedRateLimitedTurn(harness, {
        rateLimits: creditsRateLimits,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.thread.id}/rate-limit-recovery/continue`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            failedRequestId: FAILED_REQUEST_ID,
            mode: "automatic",
          }),
        },
      );

      expect(response.status).toBe(409);
      expect(
        listQueuedThreadCommands(harness, "turn.submit", fixture.thread.id),
      ).toHaveLength(0);
    });
  });

  it("keeps the safe candidate when a later observation reports allowed", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedRateLimitedTurn(harness);
      const allowedRateLimits: ProviderRateLimitState = {
        ...RATE_LIMITS,
        status: "allowed",
        windows: RATE_LIMITS.windows.map((window) => ({
          ...window,
          status: "allowed",
        })),
      };
      seedEvent(harness.deps, {
        threadId: fixture.thread.id,
        environmentId: fixture.environment.id,
        providerThreadId: "provider-thread-rate-limited",
        sequence: 8,
        type: "provider/rateLimits/updated",
        scope: threadScope(),
        data: {
          providerThreadId: "provider-thread-rate-limited",
          rateLimits: allowedRateLimits,
        },
      });

      expect(
        getProviderRateLimitRecoveryStatus(harness.deps, {
          environment: fixture.environment,
          thread: fixture.thread,
        }),
      ).toMatchObject({
        reason: "eligible",
        rateLimits: allowedRateLimits,
        candidate: {
          automatic: true,
          rateLimits: RATE_LIMITS,
        },
      });
    });
  });

  it("starts one hidden system continuation after prior output", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedRateLimitedTurn(harness, { withOutput: true });
      const response = await harness.app.request(
        `/api/v1/threads/${fixture.thread.id}/rate-limit-recovery/continue`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ failedRequestId: FAILED_REQUEST_ID }),
        },
      );
      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body).toMatchObject({ ok: true });

      const thread = getThread(harness.db, fixture.thread.id);
      expect(thread?.status).toBe("active");
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
      const continuation = events.find(
        (event) =>
          event.type === "client/turn/requested" &&
          event.continuationOfRequestId === FAILED_REQUEST_ID,
      );
      expect(continuation).toMatchObject({
        type: "client/turn/requested",
        initiator: "system",
        continuationOfRequestId: FAILED_REQUEST_ID,
        input: [
          {
            type: "text",
            text: "Please continue.",
            visibility: "agent-only",
          },
        ],
      });
      expect(
        events.find(
          (event) =>
            event.type === "system/operation" &&
            event.operation === "provider_rate_limit_recovery",
        ),
      ).toMatchObject({
        message: "Provider rate limit retry requested manually",
        metadata: {
          mode: "manual",
          failedRequestId: FAILED_REQUEST_ID,
          resetsAtMs: RESET_AT_MS,
        },
      });
      const [command] = listQueuedThreadCommands(
        harness,
        "turn.submit",
        fixture.thread.id,
      );
      expect(command).toMatchObject({
        type: "turn.submit",
        target: { mode: "start" },
        input: [
          {
            type: "text",
            text: "Please continue.",
            visibility: "agent-only",
          },
        ],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
        },
        resumeContext: {
          providerThreadId: "provider-thread-rate-limited",
        },
      });

      const repeated = await harness.app.request(
        `/api/v1/threads/${fixture.thread.id}/rate-limit-recovery/continue`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            failedRequestId: FAILED_REQUEST_ID,
            mode: "manual",
          }),
        },
      );
      expect(repeated.status).toBe(409);
      expect(
        listQueuedThreadCommands(harness, "turn.submit", fixture.thread.id),
      ).toHaveLength(1);
    });
  });

  it("revives a retiring environment before continuing", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFailedRateLimitedTurn(harness, {
        environmentStatus: "retiring",
      });
      const response = await harness.app.request(
        `/api/v1/threads/${fixture.thread.id}/rate-limit-recovery/continue`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            failedRequestId: FAILED_REQUEST_ID,
            mode: "automatic",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(getEnvironment(harness.db, fixture.environment.id)?.status).toBe(
        "ready",
      );
    });
  });
});
