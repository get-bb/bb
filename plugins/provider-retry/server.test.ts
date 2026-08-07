import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import plugin from "./server.js";
import {
  ProviderRetryService,
  RELEASE_PACE_MS,
  RESET_BUFFER_MS,
} from "./src/service.js";

const NOW_MS = Date.parse("2026-08-05T12:00:00.000Z");
const RESET_AT_MS = NOW_MS + 5 * 60 * 60 * 1_000;

function rateLimits(
  status: "allowed" | "blocked" = "blocked",
  providerId: "claude-code" | "codex" = "codex",
  resetsAtMs = RESET_AT_MS,
) {
  return {
    providerId,
    status,
    kind: "subscription-window",
    windows: [
      {
        providerKey: "primary",
        label: "Current session",
        status,
        resetsAtMs,
      },
    ],
    reachedReason: status === "blocked" ? "rate_limit_reached" : null,
    overageStatus: null,
    overageReason: null,
  } as const;
}

function eligibleStatus(
  threadId: string,
  providerId: "claude-code" | "codex" = "codex",
  resetsAtMs = RESET_AT_MS,
) {
  const limits = rateLimits("blocked", providerId, resetsAtMs);
  return {
    reason: "eligible",
    scopeKey: `host-one:${providerId}`,
    hostId: "host-one",
    rateLimits: limits,
    candidate: {
      failedRequestId: `request-${threadId}`,
      turnId: `turn-${threadId}`,
      automatic: true,
      resetsAtMs,
      rateLimits: limits,
    },
  } as const;
}

function manualStatus(threadId: string) {
  const limits = {
    ...rateLimits(),
    kind: "credits" as const,
    windows: [],
  };
  return {
    reason: "manual-only",
    scopeKey: "host-one:codex",
    hostId: "host-one",
    rateLimits: limits,
    candidate: {
      failedRequestId: `request-${threadId}`,
      turnId: `turn-${threadId}`,
      automatic: false,
      resetsAtMs: null,
      rateLimits: limits,
    },
  } as const;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
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
  it("declares a six-hour maximum automatic wait by default", async () => {
    const host = createFakePluginHost({ pluginId: "provider-retry" });
    await plugin(host.bb);

    expect(host.harness.registrations.settingsDescriptors).toEqual({
      maximumWait: {
        type: "select",
        label: "Maximum automatic wait",
        description:
          "Only continue automatically when the reported reset is within this time. Longer waits remain available for manual retry.",
        options: ["6 hours", "24 hours", "No limit"],
        default: "6 hours",
      },
    });
    await host.harness.dispose();
  });

  it("does not create an unhandled rejection when reconciliation fails", async () => {
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        threads: {
          rateLimitRecovery: async () => {
            throw new Error("status unavailable");
          },
        },
      },
    });
    const service = new ProviderRetryService(host.bb);

    await expect(service.reconcile("thread-error")).rejects.toThrow(
      "status unavailable",
    );
    await flushPromises();
    service.dispose();
    await host.harness.dispose();
  });

  it("waits for the reset buffer and paces threads sharing one account", async () => {
    const continueAfterRateLimit = vi.fn(async () => ({
      ok: true as const,
      requestId: "continuation-request",
    }));
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        threads: {
          rateLimitRecovery: async ({ threadId }) => eligibleStatus(threadId),
          continueAfterRateLimit,
        },
      },
    });
    await plugin(host.bb);

    for (const threadId of ["thread-b", "thread-a"]) {
      await host.harness.emitThreadEvent("thread.failed", {
        thread: makeThreadResponse({ id: threadId, status: "error" }),
        error: "Usage limit reached",
      });
    }

    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(1);
    expect(continueAfterRateLimit).toHaveBeenLastCalledWith({
      threadId: "thread-a",
      failedRequestId: "request-thread-a",
    });

    await vi.advanceTimersByTimeAsync(RELEASE_PACE_MS);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(2);
    expect(continueAfterRateLimit).toHaveBeenLastCalledWith({
      threadId: "thread-b",
      failedRequestId: "request-thread-b",
    });
    await host.harness.dispose();
  });

  it("cancels the pending continuation when the user starts another turn", async () => {
    const continueAfterRateLimit = vi.fn();
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        threads: {
          rateLimitRecovery: async ({ threadId }) => eligibleStatus(threadId),
          continueAfterRateLimit,
        },
      },
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-manual", status: "error" }),
      error: "Usage limit reached",
    });

    await host.harness.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({ id: "thread-manual", status: "active" }),
    });
    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-manual",
      }),
    ).resolves.toEqual({ view: null });

    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);
    expect(continueAfterRateLimit).not.toHaveBeenCalled();
    await host.harness.dispose();
  });

  it("keeps resets beyond the maximum wait manual and applies changes live", async () => {
    const resetAtMs = NOW_MS + 7 * 60 * 60 * 1_000;
    const continueAfterRateLimit = vi.fn(async () => ({
      ok: true as const,
      requestId: "continuation-request",
    }));
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        threads: {
          rateLimitRecovery: async ({ threadId }) =>
            eligibleStatus(threadId, "codex", resetAtMs),
          continueAfterRateLimit,
        },
      },
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
    ).resolves.toMatchObject({
      view: {
        phase: "manual-only",
        dueAtMs: null,
        resetsAtMs: resetAtMs,
      },
    });

    await host.harness.setSettings({ maximumWait: "24 hours" });
    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-weekly",
      }),
    ).resolves.toMatchObject({
      view: {
        phase: "waiting-for-reset",
        dueAtMs: resetAtMs + RESET_BUFFER_MS,
      },
    });

    await host.harness.setSettings({ maximumWait: "6 hours" });
    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-weekly",
      }),
    ).resolves.toMatchObject({
      view: { phase: "manual-only", dueAtMs: null },
    });

    await host.harness.setSettings({ maximumWait: "No limit" });
    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-weekly",
      }),
    ).resolves.toMatchObject({
      view: { phase: "waiting-for-reset" },
    });

    await host.harness.setSettings({ maximumWait: "6 hours" });
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1_000);
    expect(continueAfterRateLimit).not.toHaveBeenCalled();
    await expect(
      host.harness.runCli(["status", "thread-weekly"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: expect.stringMatching(
        /thread-weekly\tmanual-only\tcodex\t.*exceeds maximum automatic wait/u,
      ),
    });

    await expect(
      host.harness.callRpc("providerRetryNow", {
        threadId: "thread-weekly",
      }),
    ).resolves.toEqual({ started: true, view: null });
    expect(continueAfterRateLimit).toHaveBeenCalledOnce();
    await host.harness.dispose();
  });

  it("keeps credit exhaustion manual but allows Retry now", async () => {
    const continueAfterRateLimit = vi.fn(async () => ({
      ok: true as const,
      requestId: "continuation-request",
    }));
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        threads: {
          rateLimitRecovery: async ({ threadId }) => manualStatus(threadId),
          continueAfterRateLimit,
        },
      },
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-credits", status: "error" }),
      error: "Credits exhausted",
    });

    expect(
      await host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-credits",
      }),
    ).toMatchObject({
      view: {
        phase: "blocked",
        automatic: false,
        dueAtMs: null,
        kind: "credits",
      },
    });
    expect(
      await host.harness.callRpc("providerRetryNow", {
        threadId: "thread-credits",
      }),
    ).toEqual({ started: true, view: null });
    expect(continueAfterRateLimit).toHaveBeenCalledOnce();
    await host.harness.dispose();
  });

  it("refreshes usage and releases all waiting threads early", async () => {
    const continueAfterRateLimit = vi.fn(async () => ({
      ok: true as const,
      requestId: "continuation-request",
    }));
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        system: {
          usageLimits: async () => ({
            codex: {
              status: "ok" as const,
              accountEmail: null,
              planLabel: "Plus",
              windows: [
                {
                  label: "Current session",
                  usedPercent: 20,
                  resetsAt: new Date(RESET_AT_MS).toISOString(),
                },
              ],
            },
            claudeCode: { status: "unauthenticated" as const },
            cursor: { status: "unauthenticated" as const },
          }),
        },
        threads: {
          rateLimitRecovery: async ({ threadId }) => eligibleStatus(threadId),
          continueAfterRateLimit,
        },
      },
    });
    await plugin(host.bb);
    for (const threadId of ["thread-a", "thread-b"]) {
      await host.harness.emitThreadEvent("thread.failed", {
        thread: makeThreadResponse({ id: threadId, status: "error" }),
        error: "Usage limit reached",
      });
    }

    await host.harness.runCli(["refresh", "thread-a"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RELEASE_PACE_MS);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(2);
    await host.harness.dispose();
  });

  it("does not promote a manual-only candidate during usage refresh", async () => {
    const continueAfterRateLimit = vi.fn();
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        system: {
          usageLimits: async () => ({
            codex: {
              status: "ok" as const,
              accountEmail: null,
              planLabel: "Plus",
              windows: [
                {
                  label: "Current session",
                  usedPercent: 20,
                  resetsAt: new Date(RESET_AT_MS).toISOString(),
                },
              ],
            },
            claudeCode: { status: "unauthenticated" as const },
            cursor: { status: "unauthenticated" as const },
          }),
        },
        threads: {
          rateLimitRecovery: async ({ threadId }) => manualStatus(threadId),
          continueAfterRateLimit,
        },
      },
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-manual", status: "error" }),
      error: "Credits exhausted",
    });

    await host.harness.runCli(["refresh", "thread-manual"]);
    expect(
      await host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-manual",
      }),
    ).toMatchObject({
      view: { phase: "blocked", automatic: false, dueAtMs: null },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(continueAfterRateLimit).not.toHaveBeenCalled();
    await host.harness.dispose();
  });

  it("reschedules from blocked usage windows instead of later allowed windows", async () => {
    const blockedResetAtMs = NOW_MS + 60 * 60 * 1_000;
    const allowedResetAtMs = NOW_MS + 7 * 24 * 60 * 60 * 1_000;
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        system: {
          usageLimits: async () => ({
            codex: {
              status: "ok" as const,
              accountEmail: null,
              planLabel: "Plus",
              windows: [
                {
                  label: "Current session",
                  usedPercent: 100,
                  resetsAt: new Date(blockedResetAtMs).toISOString(),
                },
                {
                  label: "Weekly",
                  usedPercent: 20,
                  resetsAt: new Date(allowedResetAtMs).toISOString(),
                },
              ],
            },
            claudeCode: { status: "unauthenticated" as const },
            cursor: { status: "unauthenticated" as const },
          }),
        },
        threads: {
          rateLimitRecovery: async ({ threadId }) => eligibleStatus(threadId),
        },
      },
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-reset", status: "error" }),
      error: "Usage limit reached",
    });

    await host.harness.runCli(["refresh", "thread-reset"]);
    expect(
      await host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-reset",
      }),
    ).toMatchObject({
      view: {
        resetsAtMs: blockedResetAtMs,
        dueAtMs: blockedResetAtMs + RESET_BUFFER_MS,
      },
    });
    await host.harness.dispose();
  });

  it("keeps release state sticky while continuation is in flight", async () => {
    let finishContinuation: () => void = () => {
      throw new Error("Continuation was not started");
    };
    const continueAfterRateLimit = vi.fn(
      () =>
        new Promise<{ ok: true; requestId: string }>((resolve) => {
          finishContinuation = () =>
            resolve({ ok: true, requestId: "continuation-request" });
        }),
    );
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        system: {
          usageLimits: async () => ({
            codex: {
              status: "ok" as const,
              accountEmail: null,
              planLabel: "Plus",
              windows: [
                {
                  label: "Current session",
                  usedPercent: 20,
                  resetsAt: new Date(RESET_AT_MS).toISOString(),
                },
              ],
            },
            claudeCode: { status: "unauthenticated" as const },
            cursor: { status: "unauthenticated" as const },
          }),
        },
        threads: {
          rateLimitRecovery: async ({ threadId }) => eligibleStatus(threadId),
          continueAfterRateLimit,
        },
      },
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-release", status: "error" }),
      error: "Usage limit reached",
    });

    const retry = host.harness.callRpc("providerRetryNow", {
      threadId: "thread-release",
    });
    await flushPromises();
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-release", status: "error" }),
      error: "Usage limit reached",
    });
    await host.harness.runCli(["refresh", "thread-release"]);

    await expect(
      host.harness.callRpc("providerRetryCancel", {
        threadId: "thread-release",
      }),
    ).resolves.toEqual({ cancelled: false });
    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-release",
      }),
    ).resolves.toMatchObject({ view: { phase: "releasing" } });

    finishContinuation();
    await expect(retry).resolves.toEqual({ started: true, view: null });
    await host.harness.dispose();
  });

  it("refreshes Claude usage using the canonical provider id", async () => {
    const continueAfterRateLimit = vi.fn(async () => ({
      ok: true as const,
      requestId: "continuation-request",
    }));
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        system: {
          usageLimits: async () => ({
            codex: { status: "unauthenticated" as const },
            claudeCode: {
              status: "ok" as const,
              accountEmail: null,
              planLabel: "Max",
              windows: [
                {
                  label: "Five-hour",
                  usedPercent: 20,
                  resetsAt: new Date(RESET_AT_MS).toISOString(),
                },
              ],
            },
            cursor: { status: "unauthenticated" as const },
          }),
        },
        threads: {
          rateLimitRecovery: async ({ threadId }) =>
            eligibleStatus(threadId, "claude-code"),
          continueAfterRateLimit,
        },
      },
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-claude", status: "error" }),
      error: "Usage limit reached",
    });

    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-claude",
      }),
    ).resolves.toMatchObject({
      view: { providerId: "claude-code" },
    });
    await host.harness.runCli(["refresh", "thread-claude"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(continueAfterRateLimit).toHaveBeenCalledOnce();
    await host.harness.dispose();
  });

  it("retains a job while the host is unavailable and retries on host change", async () => {
    const continueAfterRateLimit = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Host is not connected"), {
          code: "host_unavailable",
          status: 502,
        }),
      )
      .mockResolvedValueOnce({ ok: true, requestId: "continuation-request" });
    const subscription = {
      hostChanged: null as
        | ((changes: Array<"host-connected" | "host-disconnected">) => void)
        | null,
    };
    const host = createFakePluginHost({
      pluginId: "provider-retry",
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
        threads: {
          rateLimitRecovery: async ({ threadId }) => eligibleStatus(threadId),
          continueAfterRateLimit,
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

    expect(
      await host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-host",
      }),
    ).toMatchObject({ view: { phase: "waiting-for-host" } });
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(1);
    expect(subscription.hostChanged).not.toBeNull();
    subscription.hostChanged?.(["host-disconnected"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(1);
    subscription.hostChanged?.(["host-connected"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(2);

    running.controller.abort();
    await running.done;
    await host.harness.dispose();
  });

  it("stops automatic retries after a non-host continuation failure", async () => {
    const continueAfterRateLimit = vi.fn(async () => {
      throw Object.assign(
        new Error("This thread is awaiting user interaction"),
        {
          code: "awaiting_user_interaction",
          status: 409,
        },
      );
    });
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        threads: {
          rateLimitRecovery: async ({ threadId }) => eligibleStatus(threadId),
          continueAfterRateLimit,
        },
      },
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-failed", status: "error" }),
      error: "Usage limit reached",
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);

    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-failed",
      }),
    ).resolves.toMatchObject({
      view: {
        phase: "retry-failed",
        dueAtMs: null,
        continuationError: "This thread is awaiting user interaction",
      },
    });
    expect(continueAfterRateLimit).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-failed", status: "error" }),
      error: "Usage limit reached",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(continueAfterRateLimit).toHaveBeenCalledOnce();

    await expect(
      host.harness.callRpc("providerRetryNow", {
        threadId: "thread-failed",
      }),
    ).resolves.toMatchObject({
      started: false,
      view: { phase: "retry-failed" },
    });
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(2);
    await host.harness.dispose();
  });

  it("clears in-memory timers when the plugin is disposed", async () => {
    const continueAfterRateLimit = vi.fn();
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        threads: {
          rateLimitRecovery: async ({ threadId }) => eligibleStatus(threadId),
          continueAfterRateLimit,
        },
      },
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-dispose", status: "error" }),
      error: "Usage limit reached",
    });
    await host.harness.dispose();

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000);
    await flushPromises();
    expect(continueAfterRateLimit).not.toHaveBeenCalled();
  });
});
