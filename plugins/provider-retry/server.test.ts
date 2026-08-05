import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import plugin from "./server.js";
import { RELEASE_PACE_MS, RESET_BUFFER_MS } from "./src/service.js";

const NOW_MS = Date.parse("2026-08-05T12:00:00.000Z");
const RESET_AT_MS = NOW_MS + 5 * 60 * 60 * 1_000;

function rateLimits(
  status: "allowed" | "blocked" = "blocked",
  providerId: "claude-code" | "codex" = "codex",
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
        usedPercent: status === "blocked" ? 100 : 25,
        resetsAtMs: RESET_AT_MS,
        modelIds: [],
      },
    ],
    reachedReason: status === "blocked" ? "rate_limit_reached" : null,
    overageStatus: null,
    overageReason: null,
    observedAtMs: NOW_MS,
    source: "codex-account",
  } as const;
}

function eligibleStatus(
  threadId: string,
  providerId: "claude-code" | "codex" = "codex",
) {
  const limits = rateLimits("blocked", providerId);
  return {
    reason: "eligible",
    scopeKey: `host-one:${providerId}`,
    hostId: "host-one",
    rateLimits: limits,
    candidate: {
      failedRequestId: `request-${threadId}`,
      turnId: `turn-${threadId}`,
      automatic: true,
      resetsAtMs: RESET_AT_MS,
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

    await host.harness.callRpc("providerRetryRefresh", {
      threadId: "thread-a",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RELEASE_PACE_MS);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(2);
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
    await host.harness.callRpc("providerRetryRefresh", {
      threadId: "thread-claude",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(continueAfterRateLimit).toHaveBeenCalledOnce();
    await host.harness.dispose();
  });

  it("retains a job while the host is unavailable and retries on host change", async () => {
    const continueAfterRateLimit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Host is not connected"))
      .mockResolvedValueOnce({ ok: true, requestId: "continuation-request" });
    const subscription = { hostChanged: null as (() => void) | null };
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        subscribe: ({ event, callback }) => {
          if (event === "host:changed") {
            subscription.hostChanged = () =>
              callback({
                type: "changed",
                entity: "host",
                id: "host-one",
                changes: ["host-connected"],
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
    expect(subscription.hostChanged).not.toBeNull();
    subscription.hostChanged?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(2);

    running.controller.abort();
    await running.done;
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
