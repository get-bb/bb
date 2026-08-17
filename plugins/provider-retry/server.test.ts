import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
  type CreateFakePluginHostOptions,
} from "@get-bb/plugin-sdk/testing";
import type {
  ExperimentalFailedTurnCandidate,
  ExperimentalFailedTurnContinuation,
  ExperimentalFailedTurnInspection,
} from "@get-bb/plugin-sdk";
import plugin from "./server.js";
import {
  ProviderRetryService,
  RELEASE_PACE_MS,
  RESET_BUFFER_MS,
} from "./src/service.js";
import type { ProviderRateLimitState } from "./src/recovery.js";

const NOW_MS = Date.parse("2026-08-05T12:00:00.000Z");
const RESET_AT_MS = NOW_MS + 5 * 60 * 60 * 1_000;

function rateLimits(
  providerId: "claude-code" | "codex" = "codex",
  resetsAtMs = RESET_AT_MS,
): ProviderRateLimitState {
  return {
    providerId,
    status: "blocked",
    kind: "subscription-window",
    windows: [
      {
        providerKey: "primary",
        label: "Current session",
        status: "blocked",
        resetsAtMs,
      },
    ],
    reachedReason: "rate_limit_reached",
    overageStatus: null,
    overageReason: null,
  };
}

function allowedRateLimits(
  providerId: "claude-code" | "codex" = "codex",
): ProviderRateLimitState {
  return {
    ...rateLimits(providerId),
    status: "allowed",
    windows: [
      {
        providerKey: "primary",
        label: "Current session",
        status: "allowed",
        resetsAtMs: null,
      },
    ],
  };
}

function failedTurnInspection(
  threadId: string,
  options: {
    includeTerminalError?: boolean;
    limits?: ProviderRateLimitState;
    observedLimits?: ProviderRateLimitState;
    providerId?: "claude-code" | "codex";
    willRetry?: boolean;
  } = {},
): ExperimentalFailedTurnInspection {
  const providerId = options.providerId ?? "codex";
  const limits = options.limits ?? rateLimits(providerId);
  const turnId = `turn-${threadId}`;
  const providerThreadId = `provider-thread-${threadId}`;
  const events: ExperimentalFailedTurnCandidate["events"] = [
    {
      id: `rate-limits-${threadId}`,
      threadId,
      seq: 3,
      createdAt: NOW_MS,
      scope: { kind: "turn", turnId },
      type: "provider/rateLimits/updated",
      data: { providerThreadId, rateLimits: limits },
    },
  ];
  if (options.includeTerminalError !== false) {
    events.push({
      id: `provider-error-${threadId}`,
      threadId,
      seq: 4,
      createdAt: NOW_MS,
      scope: { kind: "turn", turnId },
      type: "provider/error",
      data: {
        providerThreadId,
        message: "Usage limit reached",
        willRetry: options.willRetry ?? false,
        errorInfo: {
          category: "rate-limit",
          providerCode: "usage_limit_reached",
          httpStatusCode: 429,
        },
      },
    });
  }
  if (options.observedLimits !== undefined) {
    events.push({
      id: `observed-rate-limits-${threadId}`,
      threadId,
      seq: 6,
      createdAt: NOW_MS + 1,
      scope: { kind: "thread" },
      type: "provider/rateLimits/updated",
      data: { providerThreadId, rateLimits: options.observedLimits },
    });
  }
  return {
    reason: "eligible",
    candidate: {
      completedSeq: 5,
      events,
      failedRequestId: `request-${threadId}`,
      hostId: "host-one",
      providerId,
      turnId,
    },
  };
}

function manualInspection(threadId: string): ExperimentalFailedTurnInspection {
  return failedTurnInspection(threadId, {
    limits: {
      ...rateLimits(),
      kind: "credits",
      windows: [],
    },
  });
}

function unavailableInspection(
  reason: "input-not-accepted" | "superseded",
): ExperimentalFailedTurnInspection {
  return { reason, candidate: null };
}

function createRetryHost(args: {
  continueFailedTurn?: ExperimentalFailedTurnContinuation["continue"];
  inspect: ExperimentalFailedTurnContinuation["inspect"];
  sdk?: CreateFakePluginHostOptions["sdk"];
}) {
  return createFakePluginHost({
    pluginId: "provider-retry",
    experimental_failedTurnContinuation: {
      inspect: args.inspect,
      continue:
        args.continueFailedTurn ??
        (async () => ({ requestId: "continuation-request" })),
    },
    ...(args.sdk === undefined ? {} : { sdk: args.sdk }),
  });
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("provider retry scheduler", () => {
  it("owns provider retry settings and all provider retry commands", async () => {
    const host = createFakePluginHost({ pluginId: "provider-retry" });
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
    expect(
      host.harness.registrations.cli?.commands.map((command) => command.name),
    ).toEqual(["status", "cancel", "retry"]);
    await host.harness.dispose();
  });

  it("classifies provider events and schedules subscription-window failures", async () => {
    const continueFailedTurn = vi.fn(async () => ({
      requestId: "continuation-request",
    }));
    const host = createRetryHost({
      inspect: async ({ threadId }) => failedTurnInspection(threadId),
      continueFailedTurn,
    });
    await plugin(host.bb);

    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-limited", status: "error" }),
      error: "Usage limit reached",
    });
    await expect(
      host.harness.runCli(["status", "thread-limited"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("thread-limited\tcodex\tretrying"),
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);
    expect(continueFailedTurn).toHaveBeenCalledWith({
      threadId: "thread-limited",
      failedRequestId: "request-thread-limited",
      instruction: "Please continue.",
    });
    await host.harness.dispose();
  });

  it("releases immediately when a later provider observation is allowed", async () => {
    const continueFailedTurn = vi.fn(async () => ({
      requestId: "continuation-request",
    }));
    const host = createRetryHost({
      inspect: async ({ threadId }) =>
        failedTurnInspection(threadId, {
          observedLimits: allowedRateLimits(),
        }),
      continueFailedTurn,
    });
    await plugin(host.bb);

    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-allowed", status: "error" }),
      error: "Usage limit reached",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(continueFailedTurn).toHaveBeenCalledWith({
      threadId: "thread-allowed",
      failedRequestId: "request-thread-allowed",
      instruction: "Please continue.",
    });
    await host.harness.dispose();
  });

  it("does not schedule failures without a terminal rate-limit error", async () => {
    const continueFailedTurn = vi.fn();
    const host = createRetryHost({
      inspect: async ({ threadId }) =>
        failedTurnInspection(threadId, { includeTerminalError: false }),
      continueFailedTurn,
    });
    await plugin(host.bb);

    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-internal", status: "error" }),
      error: "Provider failed",
    });

    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-internal",
      }),
    ).resolves.toEqual({ view: null });
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000);
    expect(continueFailedTurn).not.toHaveBeenCalled();
    await host.harness.dispose();
  });

  it("defers to provider-owned retries", async () => {
    const continueFailedTurn = vi.fn();
    const host = createRetryHost({
      inspect: async ({ threadId }) =>
        failedTurnInspection(threadId, { willRetry: true }),
      continueFailedTurn,
    });
    await plugin(host.bb);

    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-provider", status: "error" }),
      error: "Provider is retrying",
    });
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000);

    expect(continueFailedTurn).not.toHaveBeenCalled();
    await host.harness.dispose();
  });

  it("keeps non-resettable limits manual and retries them through the plugin CLI", async () => {
    const continueFailedTurn = vi.fn(async () => ({
      requestId: "manual-continuation",
    }));
    const host = createRetryHost({
      inspect: async ({ threadId }) => manualInspection(threadId),
      continueFailedTurn,
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-credits", status: "error" }),
      error: "Credits exhausted",
    });

    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-credits",
      }),
    ).resolves.toEqual({ view: null });
    await expect(
      host.harness.runCli(["retry", "thread-credits", "--json"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining('"requestId": "manual-continuation"'),
    });
    expect(continueFailedTurn).toHaveBeenCalledWith({
      threadId: "thread-credits",
      failedRequestId: "request-thread-credits",
      instruction: "Please continue.",
    });
    await host.harness.dispose();
  });

  it("reports a useful CLI error when manual recovery is unavailable", async () => {
    const host = createRetryHost({
      inspect: async () => unavailableInspection("input-not-accepted"),
    });
    await plugin(host.bb);

    await expect(
      host.harness.runCli(["retry", "thread-ineligible"]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("input-not-accepted"),
    });
    await host.harness.dispose();
  });

  it("paces threads sharing one provider account", async () => {
    const continueFailedTurn = vi.fn(async () => ({
      requestId: "continuation-request",
    }));
    const host = createRetryHost({
      inspect: async ({ threadId }) => failedTurnInspection(threadId),
      continueFailedTurn,
    });
    await plugin(host.bb);

    for (const threadId of ["thread-b", "thread-a"]) {
      await host.harness.emitThreadEvent("thread.failed", {
        thread: makeThreadResponse({ id: threadId, status: "error" }),
        error: "Usage limit reached",
      });
    }

    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);
    expect(continueFailedTurn).toHaveBeenCalledTimes(1);
    expect(continueFailedTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: "thread-a" }),
    );
    await vi.advanceTimersByTimeAsync(RELEASE_PACE_MS);
    expect(continueFailedTurn).toHaveBeenCalledTimes(2);
    expect(continueFailedTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: "thread-b" }),
    );
    await host.harness.dispose();
  });

  it("attempts each reported reset window only once per plugin process", async () => {
    const continueFailedTurn = vi.fn(async () => ({
      requestId: "continuation-request",
    }));
    const host = createRetryHost({
      inspect: async ({ threadId }) => failedTurnInspection(threadId),
      continueFailedTurn,
    });
    await plugin(host.bb);

    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-once", status: "error" }),
      error: "Usage limit reached",
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-once", status: "error" }),
      error: "Usage limit reached again",
    });
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);

    expect(continueFailedTurn).toHaveBeenCalledOnce();
    await host.harness.dispose();
  });

  it("keeps cancellation final when reconciliation is already running", async () => {
    const pendingInspection = deferred<ExperimentalFailedTurnInspection>();
    let inspectionCount = 0;
    const continueFailedTurn = vi.fn();
    const host = createRetryHost({
      inspect: ({ threadId }) => {
        inspectionCount += 1;
        return inspectionCount === 1
          ? Promise.resolve(failedTurnInspection(threadId))
          : pendingInspection.promise;
      },
      continueFailedTurn,
    });
    const service = new ProviderRetryService(host.bb);
    await service.reconcile("thread-race");

    const reconciling = service.reconcile("thread-race");
    await flushPromises();
    const cancelling = service.cancel("thread-race");
    pendingInspection.resolve(failedTurnInspection("thread-race"));

    await expect(reconciling).resolves.toMatchObject({
      threadId: "thread-race",
    });
    await expect(cancelling).resolves.toBe(true);
    expect(service.status("thread-race")).toBeNull();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000);
    expect(continueFailedTurn).not.toHaveBeenCalled();
    service.dispose();
    await host.harness.dispose();
  });

  it("does not inspect untracked active or idle threads", async () => {
    const inspect = vi.fn(async ({ threadId }) =>
      failedTurnInspection(threadId),
    );
    const host = createRetryHost({ inspect });
    await plugin(host.bb);

    await host.harness.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({ id: "thread-untracked", status: "active" }),
    });
    await host.harness.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thread-untracked", status: "idle" }),
      lastAssistantText: null,
    });

    expect(inspect).not.toHaveBeenCalled();
    await host.harness.dispose();
  });

  it("keeps an accepted failure scheduled while provider-only activity drains", async () => {
    const threadId = "thread-claude-drain";
    const inspect = vi.fn(async () =>
      failedTurnInspection(threadId, { providerId: "claude-code" }),
    );
    const continueFailedTurn = vi.fn(async () => ({
      requestId: "continuation-request",
    }));
    const host = createRetryHost({ inspect, continueFailedTurn });
    await plugin(host.bb);

    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: threadId, status: "error" }),
      error: "Usage limit reached",
    });
    await host.harness.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({ id: threadId, status: "active" }),
    });
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: threadId, status: "error" }),
      error: "Usage limit reached",
    });

    expect(inspect).toHaveBeenCalledTimes(3);
    await expect(
      host.harness.callRpc("providerRetryStatus", { threadId }),
    ).resolves.toMatchObject({
      view: { threadId, providerId: "claude-code" },
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);
    expect(continueFailedTurn).toHaveBeenCalledOnce();
    await host.harness.dispose();
  });

  it("drops a tracked retry when a newer user action supersedes it", async () => {
    let inspectionCount = 0;
    const continueFailedTurn = vi.fn();
    const host = createRetryHost({
      inspect: async ({ threadId }) => {
        inspectionCount += 1;
        return inspectionCount === 1
          ? failedTurnInspection(threadId)
          : unavailableInspection("superseded");
      },
      continueFailedTurn,
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-manual", status: "error" }),
      error: "Usage limit reached",
    });
    await host.harness.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({ id: "thread-manual", status: "active" }),
    });

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000);
    expect(continueFailedTurn).not.toHaveBeenCalled();
    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-manual",
      }),
    ).resolves.toEqual({ view: null });
    await host.harness.dispose();
  });

  it("honors the configured maximum wait", async () => {
    const resetAtMs = NOW_MS + 7 * 60 * 60 * 1_000;
    const continueFailedTurn = vi.fn();
    const host = createRetryHost({
      inspect: async ({ threadId }) =>
        failedTurnInspection(threadId, {
          limits: rateLimits("codex", resetAtMs),
        }),
      continueFailedTurn,
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-weekly", status: "error" }),
      error: "Usage limit reached",
    });
    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-weekly",
      }),
    ).resolves.toEqual({ view: null });

    await host.harness.setSettings({ maximumWait: "24 hours" });
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-weekly", status: "error" }),
      error: "Usage limit reached",
    });
    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-weekly",
      }),
    ).resolves.toMatchObject({
      view: { retryAtMs: resetAtMs + RESET_BUFFER_MS },
    });

    await host.harness.setSettings({ maximumWait: "6 hours" });
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1_000);
    expect(continueFailedTurn).not.toHaveBeenCalled();
    await host.harness.dispose();
  });

  it("waits for a disconnected host and retries when it reconnects", async () => {
    const continueFailedTurn = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Host is not connected"), {
          code: "host_unavailable",
          status: 502,
        }),
      )
      .mockResolvedValueOnce({ requestId: "continuation-request" });
    const subscription = {
      hostChanged: null as
        | ((changes: Array<"host-connected" | "host-disconnected">) => void)
        | null,
    };
    const host = createRetryHost({
      inspect: async ({ threadId }) => failedTurnInspection(threadId),
      continueFailedTurn,
      sdk: {
        subscribe: ({ event, callback }) => {
          if (event === "host:changed") {
            subscription.hostChanged = (changes) =>
              callback({
                type: "changed",
                entity: "host",
                id: "host-one",
                changes,
              });
          }
          return () => undefined;
        },
      },
    });
    await plugin(host.bb);
    const running = host.harness.runService("provider-retry-scheduler");
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-host", status: "error" }),
      error: "Usage limit reached",
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);

    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-host",
      }),
    ).resolves.toMatchObject({ view: { retryAtMs: null } });
    subscription.hostChanged?.(["host-connected"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(continueFailedTurn).toHaveBeenCalledTimes(2);

    running.controller.abort();
    await running.done;
    await host.harness.dispose();
  });

  it("clears pending timers when the plugin is disposed", async () => {
    const continueFailedTurn = vi.fn();
    const host = createRetryHost({
      inspect: async ({ threadId }) => failedTurnInspection(threadId),
      continueFailedTurn,
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-dispose", status: "error" }),
      error: "Usage limit reached",
    });
    await host.harness.dispose();

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000);
    await flushPromises();
    expect(continueFailedTurn).not.toHaveBeenCalled();
  });
});
