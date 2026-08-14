import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import {
  ProviderRetryService,
  RELEASE_PACE_MS,
  RESET_BUFFER_MS,
} from "./src/service.js";

const NOW_MS = Date.parse("2026-08-05T12:00:00.000Z");
const RESET_AT_MS = NOW_MS + 5 * 60 * 60 * 1_000;

function rateLimits(
  providerId: "claude-code" | "codex" = "codex",
  resetsAtMs = RESET_AT_MS,
) {
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
  } as const;
}

function eligibleStatus(
  threadId: string,
  providerId: "claude-code" | "codex" = "codex",
  resetsAtMs = RESET_AT_MS,
) {
  const limits = rateLimits(providerId, resetsAtMs);
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
  it("exposes only the maximum wait setting and retry management commands", async () => {
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
    ).toEqual(["status", "cancel"]);
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

  it("waits for the reset and paces threads sharing one account", async () => {
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

    await expect(
      host.harness.runCli(["status", "thread-a"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("thread-a\tcodex\tretrying"),
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(1);
    expect(continueAfterRateLimit).toHaveBeenLastCalledWith({
      threadId: "thread-a",
      failedRequestId: "request-thread-a",
      mode: "automatic",
    });

    await vi.advanceTimersByTimeAsync(RELEASE_PACE_MS);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(2);
    expect(continueAfterRateLimit).toHaveBeenLastCalledWith({
      threadId: "thread-b",
      failedRequestId: "request-thread-b",
      mode: "automatic",
    });
    await host.harness.dispose();
  });

  it("automatically retries each reported reset window only once per plugin process", async () => {
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

    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-once", status: "error" }),
      error: "Usage limit reached",
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);
    expect(continueAfterRateLimit).toHaveBeenCalledOnce();

    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-once", status: "error" }),
      error: "Usage limit reached again",
    });
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(continueAfterRateLimit).toHaveBeenCalledOnce();
    await host.harness.dispose();
  });

  it("clears pending reset timers when the plugin reloads", async () => {
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
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-reload", status: "error" }),
      error: "Usage limit reached",
    });

    const reloaded = await host.harness.reload(plugin);
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);
    expect(continueAfterRateLimit).not.toHaveBeenCalled();
    await expect(
      reloaded.harness.callRpc("providerRetryStatus", {
        threadId: "thread-reload",
      }),
    ).resolves.toEqual({ view: null });
    await reloaded.harness.dispose();
  });

  it("keeps cancellation final when reconciliation is already running", async () => {
    const pendingStatus = deferred<ReturnType<typeof eligibleStatus>>();
    const continueAfterRateLimit = vi.fn();
    let inspectionCount = 0;
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        threads: {
          rateLimitRecovery: ({ threadId }) => {
            inspectionCount += 1;
            return inspectionCount === 1
              ? Promise.resolve(eligibleStatus(threadId))
              : pendingStatus.promise;
          },
          continueAfterRateLimit,
        },
      },
    });
    const service = new ProviderRetryService(host.bb);
    await service.reconcile("thread-race");

    const reconciling = service.reconcile("thread-race");
    await flushPromises();
    expect(inspectionCount).toBe(2);
    const cancelling = service.cancel("thread-race");
    pendingStatus.resolve(eligibleStatus("thread-race"));

    await expect(reconciling).resolves.toMatchObject({
      threadId: "thread-race",
    });
    await expect(cancelling).resolves.toBe(true);
    expect(service.status("thread-race")).toBeNull();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000);
    expect(continueAfterRateLimit).not.toHaveBeenCalled();
    service.dispose();
    await host.harness.dispose();
  });

  it("cancels pending retries through RPC and CLI", async () => {
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
    for (const threadId of ["thread-rpc", "thread-cli"]) {
      await host.harness.emitThreadEvent("thread.failed", {
        thread: makeThreadResponse({ id: threadId, status: "error" }),
        error: "Usage limit reached",
      });
    }

    await expect(
      host.harness.callRpc("providerRetryCancel", {
        threadId: "thread-rpc",
      }),
    ).resolves.toEqual({ cancelled: true });
    await expect(
      host.harness.runCli(["cancel", "thread-cli"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: "Cancelled provider retry for thread-cli.\n",
    });
    await expect(
      host.harness.callRpc("providerRetryCancel", {
        threadId: "thread-rpc",
      }),
    ).resolves.toEqual({ cancelled: false });

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000);
    expect(continueAfterRateLimit).not.toHaveBeenCalled();
    await host.harness.dispose();
  });

  it("drops the retry when the user starts another turn", async () => {
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

  it("ignores resets beyond the maximum wait", async () => {
    const resetAtMs = NOW_MS + 7 * 60 * 60 * 1_000;
    const continueAfterRateLimit = vi.fn();
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
    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-weekly",
      }),
    ).resolves.toEqual({ view: null });
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1_000);
    expect(continueAfterRateLimit).not.toHaveBeenCalled();
    await host.harness.dispose();
  });

  it("ignores limits that cannot be retried automatically", async () => {
    const continueAfterRateLimit = vi.fn();
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

    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-credits",
      }),
    ).resolves.toEqual({ view: null });
    expect(continueAfterRateLimit).not.toHaveBeenCalled();
    await host.harness.dispose();
  });

  it("drops a scheduled retry that becomes manual-only before release", async () => {
    const continueAfterRateLimit = vi.fn();
    let inspectionCount = 0;
    const host = createFakePluginHost({
      pluginId: "provider-retry",
      sdk: {
        threads: {
          rateLimitRecovery: async ({ threadId }) => {
            inspectionCount += 1;
            return inspectionCount === 1
              ? eligibleStatus(threadId)
              : manualStatus(threadId);
          },
          continueAfterRateLimit,
        },
      },
    });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thread-policy", status: "error" }),
      error: "Usage limit reached",
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);
    expect(continueAfterRateLimit).not.toHaveBeenCalled();
    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-policy",
      }),
    ).resolves.toEqual({ view: null });
    await host.harness.dispose();
  });

  it("retries when an unavailable host reconnects", async () => {
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

    await expect(
      host.harness.callRpc("providerRetryStatus", {
        threadId: "thread-host",
      }),
    ).resolves.toMatchObject({ view: { retryAtMs: null } });
    subscription.hostChanged?.(["host-connected"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(continueAfterRateLimit).toHaveBeenCalledTimes(2);

    running.controller.abort();
    await running.done;
    await host.harness.dispose();
  });

  it("logs and removes a retry that cannot start", async () => {
    const continueAfterRateLimit = vi.fn(async () => {
      throw new Error("This thread is awaiting user interaction");
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
    ).resolves.toEqual({ view: null });
    expect(continueAfterRateLimit).toHaveBeenCalledOnce();
    expect(host.harness.logEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: expect.stringContaining("awaiting user interaction"),
        }),
      ]),
    );
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(continueAfterRateLimit).toHaveBeenCalledOnce();
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
