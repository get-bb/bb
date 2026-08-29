import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeQueueEntry,
  makeThreadResponse,
  type CreateFakePluginHostOptions,
} from "@get-bb/plugin-sdk/testing";
import type {
  PluginTurnFailedGateContext,
  PluginTurnFailure,
} from "@get-bb/plugin-sdk";
import plugin from "./server.js";
import {
  MAX_RETRY_ATTEMPTS,
  RESET_BUFFER_MS,
  RESET_JITTER_MS,
  decideRetry,
} from "./src/retry-policy.js";

type QueueEntry = ReturnType<typeof makeQueueEntry>;

const NOW_MS = Date.parse("2026-08-05T12:00:00.000Z");
const RESET_AT_MS = NOW_MS + 5 * 60 * 60 * 1_000;
const HOST_ID = "host-one";
const THREAD_ID = "thread-limited";
const PLUGIN_ID = "provider-retry";

type RateLimits = NonNullable<PluginTurnFailure["rateLimits"]>;

function rateLimits(overrides: Partial<RateLimits> = {}): RateLimits {
  return {
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
    ...overrides,
  };
}

function failure(overrides: Partial<PluginTurnFailure> = {}): PluginTurnFailure {
  return {
    requestId: "creq_aaaaaaaaaa",
    originalRequestId: "creq_aaaaaaaaaa",
    turnId: "turn-1",
    message: "Usage limit reached",
    errorInfo: {
      category: "rate-limit",
      providerCode: "usage_limit_reached",
      httpStatusCode: 429,
    },
    rateLimits: rateLimits(),
    attemptNumber: 1,
    ...overrides,
  };
}

function gateHost(): NonNullable<PluginTurnFailedGateContext["host"]> {
  return {
    id: HOST_ID,
    name: "Local",
    type: "persistent",
    status: "connected",
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    lastSeenAt: NOW_MS,
    createdAt: NOW_MS,
    updatedAt: NOW_MS,
  };
}

function turnFailedContext(
  overrides: Partial<PluginTurnFailure> = {},
): PluginTurnFailedGateContext {
  return {
    stage: "turn.failed",
    thread: makeThreadResponse({ id: THREAD_ID, providerId: "codex" }),
    project: {
      id: "project-one",
      name: "Project",
      kind: "standard",
      gitRemoteUrl: null,
      createdAt: NOW_MS,
      updatedAt: NOW_MS,
    },
    environment: null,
    host: gateHost(),
    input: { blocks: [], text: "do the thing" },
    requestedExecution: {
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: null,
      serviceTier: null,
      permissionMode: null,
    },
    origin: null,
    originPluginId: null,
    startedOnBehalfOf: null,
    parentThreadId: null,
    failure: failure(overrides),
  };
}

/**
 * A queued retry as the server would return it: this plugin's wait, a retry
 * payload and a `sendAt` for core's due sweep.
 */
function queuedRetry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return makeQueueEntry({
    id: "queued_1",
    threadId: THREAD_ID,
    sendAt: RESET_AT_MS + RESET_BUFFER_MS,
    waitingOn: {
      kind: "plugin",
      pluginId: PLUGIN_ID,
      reason: "Rate limited",
    },
    payload: {
      kind: "retry",
      retryOfTurnRequestId: "creq_aaaaaaaaaa",
      attempt: 2,
    },
    ...overrides,
  });
}

interface QueuedMessageTarget {
  threadId: string;
  queuedMessageId: string;
}
interface QueuedMessageSend extends QueuedMessageTarget {
  mode: string;
}

function createHost(queued: QueueEntry[] = []) {
  const deleted: QueuedMessageTarget[] = [];
  const sent: QueuedMessageSend[] = [];
  const sdk: CreateFakePluginHostOptions["sdk"] = {
    threads: {
      get: async ({ threadId }) =>
        makeThreadResponse({ id: threadId, providerId: "codex" }),
      queue: { list: async () => queued },
      queuedMessages: {
        delete: async (args: QueuedMessageTarget) => {
          deleted.push(args);
          return { ok: true };
        },
        send: async (args: QueuedMessageSend) => {
          sent.push(args);
          return { ok: true };
        },
      },
    },
  };
  return { ...createFakePluginHost({ pluginId: PLUGIN_ID, sdk }), deleted, sent };
}

describe("provider retry policy", () => {
  it("waits for the reported reset plus a buffer, jittered within its bound", () => {
    // The jitter is what keeps every thread on one exhausted account from
    // retrying in the same instant, so its bounds are the contract: never
    // before the buffer, never a full jitter window past it.
    const earliest = decideRetry({
      failure: failure(),
      maximumWaitMs: null,
      now: NOW_MS,
      random: 0,
    });
    const latest = decideRetry({
      failure: failure(),
      maximumWaitMs: null,
      now: NOW_MS,
      random: 0.999_999,
    });
    expect(earliest).toEqual({
      kind: "retry",
      resumeAt: RESET_AT_MS + RESET_BUFFER_MS,
    });
    expect(latest.kind).toBe("retry");
    if (latest.kind !== "retry") return;
    expect(latest.resumeAt).toBeGreaterThan(RESET_AT_MS + RESET_BUFFER_MS);
    expect(latest.resumeAt).toBeLessThan(
      RESET_AT_MS + RESET_BUFFER_MS + RESET_JITTER_MS,
    );
  });

  it("never schedules a retry in the past when the reset has already passed", () => {
    const decision = decideRetry({
      failure: failure({
        rateLimits: rateLimits({
          windows: [
            {
              providerKey: "primary",
              label: "Current session",
              status: "blocked",
              resetsAtMs: NOW_MS - 60_000,
            },
          ],
        }),
      }),
      maximumWaitMs: null,
      now: NOW_MS,
      random: 0,
    });
    expect(decision).toEqual({
      kind: "retry",
      resumeAt: NOW_MS + RESET_BUFFER_MS,
    });
  });

  it("waits for the latest blocked window, not the first to open", () => {
    const weekly = RESET_AT_MS + 48 * 60 * 60 * 1_000;
    const decision = decideRetry({
      failure: failure({
        rateLimits: rateLimits({
          windows: [
            {
              providerKey: "session",
              label: "Session",
              status: "blocked",
              resetsAtMs: RESET_AT_MS,
            },
            {
              providerKey: "weekly",
              label: "Weekly",
              status: "blocked",
              resetsAtMs: weekly,
            },
          ],
        }),
      }),
      maximumWaitMs: null,
      now: NOW_MS,
      random: 0,
    });
    expect(decision).toEqual({
      kind: "retry",
      resumeAt: weekly + RESET_BUFFER_MS,
    });
  });

  it("declines a reset beyond the configured maximum wait", () => {
    expect(
      decideRetry({
        failure: failure(),
        maximumWaitMs: 60 * 60 * 1_000,
        now: NOW_MS,
        random: 0,
      }),
    ).toEqual({ kind: "decline", reason: "beyond-maximum-wait" });
    // The same window is fine once the limit is raised past it.
    expect(
      decideRetry({
        failure: failure(),
        maximumWaitMs: 24 * 60 * 60 * 1_000,
        now: NOW_MS,
        random: 0,
      }).kind,
    ).toBe("retry");
  });

  it("declines failures that are not rate limits, and limits that do not reset", () => {
    expect(
      decideRetry({
        failure: failure({
          errorInfo: {
            category: "internal",
            providerCode: null,
            httpStatusCode: 500,
          },
        }),
        maximumWaitMs: null,
        now: NOW_MS,
        random: 0,
      }),
    ).toEqual({ kind: "decline", reason: "not-rate-limited" });
    expect(
      decideRetry({
        failure: failure({ rateLimits: null }),
        maximumWaitMs: null,
        now: NOW_MS,
        random: 0,
      }),
    ).toEqual({ kind: "decline", reason: "no-rate-limit-state" });
    // Credits do not come back on a clock, so waiting is not a fix.
    expect(
      decideRetry({
        failure: failure({ rateLimits: rateLimits({ kind: "credits" }) }),
        maximumWaitMs: null,
        now: NOW_MS,
        random: 0,
      }),
    ).toEqual({ kind: "decline", reason: "not-resettable" });
  });

  it("gives up once a turn has been retried its maximum number of times", () => {
    expect(
      decideRetry({
        failure: failure({ attemptNumber: MAX_RETRY_ATTEMPTS }),
        maximumWaitMs: null,
        now: NOW_MS,
        random: 0,
      }),
    ).toEqual({ kind: "decline", reason: "attempts-exhausted" });
    expect(
      decideRetry({
        failure: failure({ attemptNumber: MAX_RETRY_ATTEMPTS - 1 }),
        maximumWaitMs: null,
        now: NOW_MS,
        random: 0,
      }).kind,
    ).toBe("retry");
  });
});

describe("provider retry plugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers exactly one gate, and it is not a dispatch gate", async () => {
    // The load-bearing half is `dispatch: null`. This plugin must never
    // intercept a send: a remembered rate limit is a stale cache of provider
    // state, and refusing an attempt on it strands a user who fixed the limit
    // out of band. It is also what keeps a stock install free of dispatch-stage
    // gates entirely, since the only other one ships disabled by default.
    const host = createHost();
    await plugin(host.bb);

    expect(host.harness.registrations.settingsDescriptors).toEqual({
      maximumWait: {
        type: "select",
        label: "Maximum automatic wait",
        description:
          "Do not schedule a retry when the reported reset is farther away than this.",
        options: ["6 hours", "24 hours", "No limit"],
        default: "6 hours",
      },
    });
    expect(host.harness.registrations.dispatchGates["turn.failed"]).not.toBeNull();
    expect(host.harness.registrations.dispatchGates.dispatch).toBeNull();
    expect(
      host.harness.registrations.cli?.commands.map((command) => command.name),
    ).toEqual(["status", "cancel", "retry"]);
    await host.harness.dispose();
  });

  it("asks for a retry at the reset window", async () => {
    const host = createHost();
    await plugin(host.bb);
    const gate = host.harness.registrations.dispatchGates["turn.failed"];
    expect(gate).not.toBeNull();

    const decision = await gate?.(turnFailedContext());
    expect(decision?.action).toBe("retry");
    if (decision?.action !== "retry") return;
    expect(decision.resumeAt).toBeGreaterThanOrEqual(
      RESET_AT_MS + RESET_BUFFER_MS,
    );
    // Just the cause, no time: every surface renders the row's `sendAt`
    // itself, so a time here shows up twice on the card and in the queue list.
    expect(decision.reason).toBe("Rate limited");
    await host.harness.dispose();
  });

  it("leaves ordinary failures alone", async () => {
    const host = createHost();
    await plugin(host.bb);
    const gate = host.harness.registrations.dispatchGates["turn.failed"];

    const decision = await gate?.(
      turnFailedContext({
        errorInfo: {
          category: "internal",
          providerCode: null,
          httpStatusCode: 500,
        },
      }),
    );
    expect(decision).toEqual({ action: "none" });
    await host.harness.dispose();
  });

  it("re-reads the maximum wait when the setting changes", async () => {
    // The gate closes over a cached number, so the `onChange` wiring is the
    // only thing that stops a raised limit from being ignored until restart.
    const host = createHost();
    await plugin(host.bb);
    const gate = host.harness.registrations.dispatchGates["turn.failed"];
    const beyondSixHours = turnFailedContext({
      rateLimits: rateLimits({
        windows: [
          {
            providerKey: "primary",
            label: "Weekly",
            status: "blocked",
            resetsAtMs: NOW_MS + 7 * 60 * 60 * 1_000,
          },
        ],
      }),
    });

    expect(await gate?.(beyondSixHours)).toEqual({ action: "none" });

    await host.harness.setSettings({ maximumWait: "No limit" });
    expect((await gate?.(beyondSixHours))?.action).toBe("retry");
    await host.harness.dispose();
  });

  it("reports pending retries from the queue rather than private state", async () => {
    const host = createHost([queuedRetry()]);
    await plugin(host.bb);

    await expect(
      host.harness.callRpc("providerRetryStatus", { threadId: THREAD_ID }),
    ).resolves.toEqual({
      view: {
        threadId: THREAD_ID,
        providerId: "codex",
        retryAtMs: RESET_AT_MS + RESET_BUFFER_MS,
      },
    });
    // Scoped by the indexed wait-holder filter rather than by listing the
    // whole queue and filtering here.
    expect(host.harness.inspection.sdk.callsTo("threads.queue.list")[0]?.[0])
      .toEqual({ waitHolder: `plugin:${PLUGIN_ID}`, threadId: THREAD_ID });
    await expect(host.harness.runCli(["status", THREAD_ID])).resolves.toEqual(
      expect.objectContaining({ exitCode: 0 }),
    );
    await host.harness.dispose();
  });

  it("cancels by deleting the queued row and retries by sending it now", async () => {
    // Both are the affordances the user already has on the queued card, rather
    // than a second mechanism this plugin owns.
    const host = createHost([queuedRetry()]);
    await plugin(host.bb);

    await expect(
      host.harness.callRpc("providerRetryCancel", { threadId: THREAD_ID }),
    ).resolves.toEqual({ cancelled: true });
    expect(host.deleted).toEqual([
      { threadId: THREAD_ID, queuedMessageId: "queued_1" },
    ]);

    const retried = await host.harness.runCli(["retry", THREAD_ID]);
    expect(retried.exitCode).toBe(0);
    expect(host.sent).toEqual([
      { threadId: THREAD_ID, queuedMessageId: "queued_1", mode: "auto" },
    ]);
    await host.harness.dispose();
  });

  it("reports no pending retry when no row is queued", async () => {
    const host = createHost();
    await plugin(host.bb);

    await expect(
      host.harness.callRpc("providerRetryStatus", { threadId: THREAD_ID }),
    ).resolves.toEqual({ view: null });
    await expect(
      host.harness.callRpc("providerRetryCancel", { threadId: THREAD_ID }),
    ).resolves.toEqual({ cancelled: false });
    const status = await host.harness.runCli(["status"]);
    expect(status.stdout).toBe("No provider retries are pending.\n");
    await host.harness.dispose();
  });
});
