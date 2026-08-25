import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin from "./server.js";
import {
  ProviderRetryService,
  RELEASE_PACE_MS,
  RESET_BUFFER_MS,
} from "./src/service.js";
import {
  classifyProviderRetry,
  type ProviderRateLimitState,
} from "./src/recovery.js";

const NOW_MS = Date.parse("2026-08-05T12:00:00.000Z");
const RESET_AT_MS = NOW_MS + 5 * 60 * 60 * 1_000;

type ThreadEventRows = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>
>;
type TurnRequestEventRow = Extract<
  ThreadEventRows[number],
  { type: "client/turn/requested" }
>;
type ThreadSend = BbPluginApi["sdk"]["threads"]["send"];

interface TestFailedTurnInspection {
  candidate: null | {
    events: ThreadEventRows;
    hostId: string;
    providerId: "claude-code" | "codex";
  };
  events: ThreadEventRows;
  reason: "eligible" | "input-not-accepted" | "superseded";
}

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
    providerDrain?: boolean;
    willRetry?: boolean;
  } = {},
): TestFailedTurnInspection {
  const providerId = options.providerId ?? "codex";
  const limits = options.limits ?? rateLimits(providerId);
  const turnId = `turn-${threadId}`;
  const providerThreadId = `provider-thread-${threadId}`;
  const requestId = `request-${threadId}`;
  const events: ThreadEventRows = [
    {
      id: `request-${threadId}`,
      threadId,
      seq: 1,
      createdAt: NOW_MS,
      scope: { kind: "thread" },
      type: "client/turn/requested",
      data: {
        direction: "outbound",
        requestId,
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        systemMessageKind: "unlabeled",
        systemMessageSubject: null,
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
    },
    {
      id: `accepted-${threadId}`,
      threadId,
      seq: 2,
      createdAt: NOW_MS,
      scope: { kind: "turn", turnId },
      type: "turn/input/accepted",
      data: { providerThreadId, clientRequestId: requestId },
    },
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
  events.push({
    id: `completed-${threadId}`,
    threadId,
    seq: 5,
    createdAt: NOW_MS,
    scope: { kind: "turn", turnId },
    type: "turn/completed",
    data: { providerThreadId, status: "failed" },
  });
  if (options.providerDrain === true) {
    const drainTurnId = `drain-${threadId}`;
    events.push(
      {
        id: `drain-started-${threadId}`,
        threadId,
        seq: 7,
        createdAt: NOW_MS + 2,
        scope: { kind: "turn", turnId: drainTurnId },
        type: "turn/started",
        data: { providerThreadId },
      },
      {
        id: `drain-completed-${threadId}`,
        threadId,
        seq: 8,
        createdAt: NOW_MS + 3,
        scope: { kind: "turn", turnId: drainTurnId },
        type: "turn/completed",
        data: { providerThreadId, status: "failed" },
      },
    );
  }
  events.sort((left, right) => left.seq - right.seq);
  return {
    reason: "eligible",
    candidate: {
      events,
      hostId: "host-one",
      providerId,
    },
    events,
  };
}

function manualInspection(threadId: string): TestFailedTurnInspection {
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
  threadId = "thread-ineligible",
): TestFailedTurnInspection {
  if (reason === "input-not-accepted") {
    const inspection = failedTurnInspection(threadId);
    const events = inspection.events.filter(
      (row) =>
        row.type !== "turn/input/accepted" && row.type !== "turn/completed",
    );
    return { reason, candidate: null, events };
  }
  const inspection = failedTurnInspection(threadId);
  const events: ThreadEventRows = [
    ...inspection.events,
    {
      id: `new-request-${threadId}`,
      threadId,
      seq: 7,
      createdAt: NOW_MS + 2,
      scope: { kind: "thread" },
      type: "client/turn/requested",
      data: {
        direction: "outbound",
        requestId: `new-request-${threadId}`,
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        systemMessageKind: "unlabeled",
        systemMessageSubject: null,
        input: [{ type: "text", text: "New work", mentions: [] }],
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
    },
  ];
  return { reason, candidate: null, events };
}

function createRetryHost(args: {
  continueFailedTurn?: ThreadSend;
  inspect: (args: {
    threadId: string;
  }) => TestFailedTurnInspection | Promise<TestFailedTurnInspection>;
  onHostSubscription?: (
    notify: (changes: Array<"host-connected" | "host-disconnected">) => void,
  ) => void;
  providerId?: "claude-code" | "codex";
}) {
  const inspectionByThreadId = new Map<string, TestFailedTurnInspection>();
  return createFakePluginHost({
    pluginId: "provider-retry",
    sdk: {
      environments: {
        get: async ({ environmentId }) => ({
          id: environmentId,
          name: null,
          projectId: "project-one",
          hostId: "host-one",
          path: "/workspace",
          managed: false,
          isGitRepo: true,
          isWorktree: false,
          workspaceProvisionType: "unmanaged",
          branchName: "main",
          baseBranch: null,
          defaultBranch: "main",
          createdAt: NOW_MS,
          updatedAt: NOW_MS,
          status: "ready",
        }),
      },
      threads: {
        get: async ({ threadId }) => {
          inspectionByThreadId.set(threadId, await args.inspect({ threadId }));
          return makeThreadResponse({
            id: threadId,
            environmentId: "environment-one",
            providerId: args.providerId ?? "codex",
            status: "error",
          });
        },
        events: {
          list: async ({
            threadId,
            afterSeq,
            beforeSeq,
            limit,
            order,
            types,
          }) => {
            const inspection = inspectionByThreadId.get(threadId);
            if (inspection === undefined) {
              throw new Error(`Thread ${threadId} was not inspected`);
            }
            const after = afterSeq === undefined ? 0 : Number(afterSeq);
            const before =
              beforeSeq === undefined
                ? Number.POSITIVE_INFINITY
                : Number(beforeSeq);
            const matching = inspection.events.filter(
              (row) =>
                row.seq > after &&
                row.seq < before &&
                (types === undefined || types.includes(row.type)),
            );
            matching.sort((left, right) =>
              order === "desc" ? right.seq - left.seq : left.seq - right.seq,
            );
            return matching.slice(
              0,
              limit === undefined ? undefined : Number(limit),
            );
          },
        },
        send:
          args.continueFailedTurn ??
          (async () => ({ ok: true as const, delivery: "sent" as const })),
      },
      subscribe: ({ event, callback }) => {
        if (event === "host:changed") {
          args.onHostSubscription?.((changes) =>
            callback({
              type: "changed",
              entity: "host",
              id: "host-one",
              changes,
            }),
          );
        }
        return () => undefined;
      },
    },
  });
}

function expectedContinuation(threadId: string) {
  return {
    threadId,
    mode: "start",
    input: [
      {
        type: "text",
        text: "Please continue.",
        mentions: [],
        visibility: "agent-only",
      },
    ],
    model: "gpt-5",
    permissionMode: "full",
    reasoningLevel: "medium",
    serviceTier: "default",
    executionInputSources: {
      model: "explicit",
      permissionMode: "explicit",
      reasoningLevel: "explicit",
      serviceTier: "explicit",
    },
  };
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
  it("classifies prior completed requests with linear event reads", () => {
    const events = Array.from({ length: 100 }, (_, index) =>
      failedTurnInspection(`linear-${index}`).events.map((row) => ({
        ...row,
        seq: row.seq + index * 10,
      })),
    ).flat();
    let eventReads = 0;
    const observedEvents = new Proxy(events, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/u.test(property)) {
          eventReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(
      classifyProviderRetry({
        events: observedEvents,
        hostId: "host-one",
        providerId: "codex",
      }),
    ).toMatchObject({
      candidate: { failedRequestId: "request-linear-99" },
      reason: "eligible",
    });
    expect(eventReads).toBeLessThan(events.length * 8);
  });

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
      ok: true as const,
      delivery: "sent" as const,
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
    const eventCalls = host.harness.inspection.sdk.callsTo(
      "threads.events.list",
    );
    expect(eventCalls).toHaveLength(3);
    expect(eventCalls[0]?.[0]).toMatchObject({
      limit: "1",
      order: "desc",
      types: ["client/turn/requested"],
    });
    expect(eventCalls[1]?.[0]).toMatchObject({
      limit: "100",
      order: "desc",
      types: ["provider/rateLimits/updated"],
    });
    expect(eventCalls[2]?.[0]).toMatchObject({
      afterSeq: "1",
      limit: "500",
      order: "asc",
      types: [
        "client/turn/requested",
        "provider/error",
        "provider/rateLimits/updated",
        "system/thread/interrupted",
        "turn/completed",
        "turn/input/accepted",
      ],
    });
    await expect(
      host.harness.runCli(["status", "thread-limited"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("thread-limited\tcodex\tretrying"),
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000 + RESET_BUFFER_MS);
    expect(continueFailedTurn).toHaveBeenCalledWith(
      expectedContinuation("thread-limited"),
    );
    await host.harness.dispose();
  });

  it("pages forward only through the latest request window", async () => {
    const threadId = "thread-long-history";
    const inspection = failedTurnInspection(threadId);
    for (let index = 0; index < 500; index += 1) {
      inspection.events.push({
        id: `trailing-error-${index}`,
        threadId,
        seq: 6 + index,
        createdAt: NOW_MS + index,
        scope: { kind: "turn", turnId: `turn-${threadId}` },
        type: "provider/error",
        data: {
          providerThreadId: `provider-thread-${threadId}`,
          message: "Trailing provider diagnostic",
          willRetry: false,
          errorInfo: {
            category: "internal",
            providerCode: "trailing_diagnostic",
            httpStatusCode: null,
          },
        },
      });
    }
    inspection.events.sort((left, right) => left.seq - right.seq);
    const host = createRetryHost({ inspect: async () => inspection });
    await plugin(host.bb);

    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: threadId, status: "error" }),
      error: "Usage limit reached",
    });

    const calls = host.harness.inspection.sdk.callsTo("threads.events.list");
    expect(calls).toHaveLength(4);
    expect(calls[2]?.[0]).toMatchObject({ afterSeq: "1", order: "asc" });
    expect(calls[3]?.[0]).toMatchObject({ afterSeq: "501", order: "asc" });
    await expect(
      host.harness.callRpc("providerRetryStatus", { threadId }),
    ).resolves.toMatchObject({ view: { threadId } });
    await host.harness.dispose();
  });

  it("does not page through prior requests when an ordinary failure has no rate-limit history", async () => {
    const threadId = "thread-ordinary-long-history";
    const latest = failedTurnInspection(threadId);
    const latestRequest = latest.events.find(
      (row): row is TurnRequestEventRow => row.type === "client/turn/requested",
    );
    if (latestRequest === undefined) {
      throw new Error("Expected latest request fixture");
    }
    const priorRequests = Array.from({ length: 2_000 }, (_, index) => ({
      ...latestRequest,
      id: `prior-request-${index}`,
      seq: index + 1,
      data: {
        ...latestRequest.data,
        requestId: `prior-request-${index}`,
      },
    }));
    const latestEvents = latest.events
      .filter((row) => row.type !== "provider/rateLimits/updated")
      .map((row) =>
        row.type === "provider/error"
          ? {
              ...row,
              seq: row.seq + 2_000,
              data: {
                ...row.data,
                message: "Provider failed",
                errorInfo: {
                  category: "internal" as const,
                  providerCode: "internal_error",
                  httpStatusCode: 500,
                },
              },
            }
          : { ...row, seq: row.seq + 2_000 },
      );
    const inspection = {
      ...latest,
      events: [...priorRequests, ...latestEvents],
    };
    const continueFailedTurn = vi.fn();
    const host = createRetryHost({
      inspect: async () => inspection,
      continueFailedTurn,
    });
    await plugin(host.bb);

    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: threadId, status: "error" }),
      error: "Provider failed",
    });

    const calls = host.harness.inspection.sdk.callsTo("threads.events.list");
    expect(calls).toHaveLength(3);
    expect(calls[0]?.[0]).toMatchObject({
      limit: "1",
      order: "desc",
      types: ["client/turn/requested"],
    });
    expect(calls[1]?.[0]).toMatchObject({
      limit: "100",
      order: "desc",
      types: ["provider/rateLimits/updated"],
    });
    expect(calls[2]?.[0]).toMatchObject({
      afterSeq: "2001",
      order: "asc",
    });
    expect(continueFailedTurn).not.toHaveBeenCalled();
    await host.harness.dispose();
  });

  it("releases immediately when a later provider observation is allowed", async () => {
    const continueFailedTurn = vi.fn(async () => ({
      ok: true as const,
      delivery: "sent" as const,
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

    expect(continueFailedTurn).toHaveBeenCalledWith(
      expectedContinuation("thread-allowed"),
    );
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
      ok: true as const,
      delivery: "sent" as const,
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
      stdout: expect.stringContaining(
        '"failedRequestId": "request-thread-credits"',
      ),
    });
    expect(continueFailedTurn).toHaveBeenCalledWith(
      expectedContinuation("thread-credits"),
    );
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
      ok: true as const,
      delivery: "sent" as const,
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
      ok: true as const,
      delivery: "sent" as const,
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
    const pendingInspection = deferred<TestFailedTurnInspection>();
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
      failedTurnInspection(threadId, {
        providerDrain: true,
        providerId: "claude-code",
      }),
    );
    const continueFailedTurn = vi.fn(async () => ({
      ok: true as const,
      delivery: "sent" as const,
    }));
    const host = createRetryHost({
      inspect,
      continueFailedTurn,
      providerId: "claude-code",
    });
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
          : unavailableInspection("superseded", threadId);
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

  it("does not retry after an explicit user stop", async () => {
    const threadId = "thread-stopped";
    const inspection = failedTurnInspection(threadId);
    inspection.events.push({
      id: `manual-stop-${threadId}`,
      threadId,
      seq: 7,
      createdAt: NOW_MS + 2,
      scope: { kind: "thread" },
      type: "system/thread/interrupted",
      data: { reason: "manual-stop" },
    });
    const continueFailedTurn = vi.fn();
    const host = createRetryHost({
      inspect: async () => inspection,
      continueFailedTurn,
    });
    await plugin(host.bb);

    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: threadId, status: "error" }),
      error: "Usage limit reached",
    });
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000);

    expect(continueFailedTurn).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce({ ok: true as const, delivery: "sent" as const });
    const subscription = {
      hostChanged: null as
        | ((changes: Array<"host-connected" | "host-disconnected">) => void)
        | null,
    };
    const host = createRetryHost({
      inspect: async ({ threadId }) => failedTurnInspection(threadId),
      continueFailedTurn,
      onHostSubscription: (notify) => {
        subscription.hostChanged = notify;
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
