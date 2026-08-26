import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeDispatchHoldResponse,
  makeThreadResponse,
  type CreateFakePluginHostOptions,
} from "@get-bb/plugin-sdk/testing";
import type {
  PluginTurnFailedGateContext,
  PluginTurnFailure,
  PluginTurnSubmitGateContext,
} from "@get-bb/plugin-sdk";
import plugin from "./server.js";
import {
  MAX_RETRY_ATTEMPTS,
  RESET_BUFFER_MS,
  RESET_JITTER_MS,
  decideRetry,
} from "./src/retry-policy.js";

const NOW_MS = Date.parse("2026-08-05T12:00:00.000Z");
const RESET_AT_MS = NOW_MS + 5 * 60 * 60 * 1_000;
const HOST_ID = "host-one";
const THREAD_ID = "thread-limited";

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

function turnSubmitContext(): PluginTurnSubmitGateContext {
  const base = turnFailedContext();
  return {
    stage: "turn.submit",
    thread: base.thread,
    project: base.project,
    environment: base.environment,
    host: base.host,
    input: base.input,
    requestedExecution: base.requestedExecution,
    executionSources: {
      providerId: null,
      model: null,
      reasoningLevel: null,
      serviceTier: null,
      permissionMode: null,
    },
    origin: null,
    originPluginId: null,
    startedOnBehalfOf: null,
    parentThreadId: null,
    pluginInput: null,
    isReleaseReevaluation: false,
    hold: null,
  };
}

type RetryHoldResponse = ReturnType<typeof makeDispatchHoldResponse>;

/**
 * A live retry hold as the server would return it: this plugin's holder, a
 * retry payload and a timer.
 */
function retryHold(
  overrides: Partial<RetryHoldResponse> = {},
): RetryHoldResponse {
  return makeDispatchHoldResponse({
    id: "hold_1",
    threadId: THREAD_ID,
    holder: "plugin:provider-retry",
    resumeAt: RESET_AT_MS + RESET_BUFFER_MS,
    payload: { kind: "retry", retryOfTurnRequestId: "creq_aaaaaaaaaa" },
    ...overrides,
  });
}

function createHost(holds: RetryHoldResponse[] = []) {
  const sdk: CreateFakePluginHostOptions["sdk"] = {
    threads: {
      get: async ({ threadId }) =>
        makeThreadResponse({ id: threadId, providerId: "codex" }),
      holds: {
        list: async () => holds,
        cancel: async () => holds[0] ?? retryHold(),
        release: async () => holds[0] ?? retryHold(),
      },
    },
  };
  return createFakePluginHost({ pluginId: "provider-retry", sdk });
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
      resetsAtMs: RESET_AT_MS,
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
      resetsAtMs: NOW_MS - 60_000,
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
      resetsAtMs: weekly,
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

  it("owns its settings, both gates and all provider retry commands", async () => {
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
    expect(host.harness.registrations.dispatchGates["turn.submit"]).not.toBeNull();
    expect(
      host.harness.registrations.cli?.commands.map((command) => command.name),
    ).toEqual(["status", "cancel", "retry"]);
    await host.harness.dispose();
  });

  it("asks for a retry at the reset window and notes nothing yet", async () => {
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
    expect(decision.reason).toContain("Rate limited");
    // The "scheduled" narration is the hold's own card and timeline row; a
    // note here would say the same thing twice.
    expect(host.harness.registrations.appendedThreadNotes).toEqual([]);
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
    expect(host.harness.registrations.appendedThreadNotes).toEqual([]);
    await host.harness.dispose();
  });

  it("tells the user when a limit resets beyond the maximum wait", async () => {
    const host = createHost();
    await plugin(host.bb);
    await host.harness.setSettings({ maximumWait: "6 hours" });
    const gate = host.harness.registrations.dispatchGates["turn.failed"];

    const decision = await gate?.(
      turnFailedContext({
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
      }),
    );
    expect(decision).toEqual({ action: "none" });
    const notes = host.harness.registrations.appendedThreadNotes;
    expect(notes).toHaveLength(1);
    expect(notes[0]?.threadId).toBe(THREAD_ID);
    expect(notes[0]?.note.level).toBe("warning");
    expect(notes[0]?.note.text).toContain("maximum wait");
    await host.harness.dispose();
  });

  it("holds new sends into an account it just watched hit its limit", async () => {
    const host = createHost();
    await plugin(host.bb);
    const failedGate = host.harness.registrations.dispatchGates["turn.failed"];
    const submitGate = host.harness.registrations.dispatchGates["turn.submit"];

    // Nothing known yet, so an ordinary send goes through untouched.
    expect(await submitGate?.(turnSubmitContext())).toEqual({
      action: "proceed",
    });

    await failedGate?.(turnFailedContext());

    const held = await submitGate?.(turnSubmitContext());
    expect(held?.action).toBe("hold");
    if (held?.action !== "hold") return;
    expect(held.resumeAt).toBe(RESET_AT_MS + RESET_BUFFER_MS);

    // Once the window has passed the account is presumed usable again; being
    // wrong costs one failure, which is what re-arms the hold.
    vi.setSystemTime(RESET_AT_MS + RESET_BUFFER_MS + 1);
    expect(await submitGate?.(turnSubmitContext())).toEqual({
      action: "proceed",
    });
    await host.harness.dispose();
  });

  it("notes a retry when its hold releases and when the user cancels it", async () => {
    const host = createHost();
    await plugin(host.bb);
    const hold = retryHold();

    await host.harness.emitThreadEvent("dispatch.released", { hold });
    await host.harness.emitThreadEvent("dispatch.cancelled", { hold });

    const notes = host.harness.registrations.appendedThreadNotes;
    expect(notes.map((entry) => entry.note.text)).toEqual([
      "Rate limit window reset — retrying now.",
      "Automatic retry cancelled.",
    ]);
    await host.harness.dispose();
  });

  it("ignores hold events belonging to other plugins", async () => {
    const host = createHost();
    await plugin(host.bb);

    await host.harness.emitThreadEvent("dispatch.released", {
      hold: makeDispatchHoldResponse({
        id: "hold_2",
        threadId: THREAD_ID,
        holder: "plugin:concurrency-limit",
      }),
    });

    expect(host.harness.registrations.appendedThreadNotes).toEqual([]);
    await host.harness.dispose();
  });

  it("reports pending retries from the hold list rather than private state", async () => {
    const host = createHost([retryHold()]);
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
    await expect(host.harness.runCli(["status", THREAD_ID])).resolves.toEqual(
      expect.objectContaining({ exitCode: 0 }),
    );
    await host.harness.dispose();
  });

  it("reports no pending retry when no hold exists", async () => {
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
