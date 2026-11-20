import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createQueuedThreadMessage,
  getLatestThreadSequence,
  getThread,
  setExperiments,
  threads,
} from "@bb/db";
import {
  createStandaloneBuiltinCompactCommandInput,
  turnScope,
} from "@bb/domain";
import {
  dueIdleCompactionWindow,
  idleCompactionSweep,
} from "../../src/services/threads/idle-compaction.js";
import { createUserQuestionPayload } from "../helpers/pending-interactions.js";
import { runThreadLifecycleTransaction } from "../../src/services/threads/lifecycle/run.js";
import {
  EMPTY_WORKSPACE_AGENT_CONTEXT,
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedEvent,
  seedHost,
  seedProjectWithSource,
  seedSession,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { textInput } from "../helpers/prompt-input.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { listEvents } from "@bb/db/testing";

const HOUR = 3_600_000;
const PROVIDER_THREAD_ID = "provider-thread-idle";

function seedIdleThread(
  harness: TestAppHarness,
  options: { online: boolean } = { online: true },
) {
  const host = seedHost(harness.deps, {});
  const session = options.online ? seedSession(harness.deps, host.id) : null;
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    providerId: "pi",
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: PROVIDER_THREAD_ID,
    threadId: thread.id,
  });
  if (session === null) {
    return { environment, thread, compactions: () => 0 };
  }
  const responder = registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle: ({ command }): HostRpcHandlerResult => {
      if (command.type === "host.read_workspace_agent_context") {
        return { ok: true, result: EMPTY_WORKSPACE_AGENT_CONTEXT };
      }
      if (command.type === "turn.submit") {
        return { ok: true, result: { trace: { spans: [] } } };
      }
      return { ok: true, result: {} };
    },
  });
  const compactions = () =>
    responder.requests.filter(
      ({ command }) =>
        command.type === "turn.submit" &&
        JSON.stringify(command.input) ===
          JSON.stringify(createStandaloneBuiltinCompactCommandInput()),
    ).length;
  return { environment, thread, compactions };
}

function seedTurn(
  harness: TestAppHarness,
  args: {
    threadId: string;
    environmentId: string;
    turnId: string;
    startedAt: number;
    toolCompletedAt: number | null;
    usageAt: number;
    usedTokens: number;
    promptCacheTtlMs?: number;
    compactionOnly?: boolean;
  },
): void {
  const context = {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: PROVIDER_THREAD_ID,
    scope: turnScope(args.turnId),
  };
  const next = () =>
    getLatestThreadSequence(harness.db, { threadId: args.threadId }) + 1;
  seedEvent(harness.deps, {
    ...context,
    createdAt: args.startedAt,
    sequence: next(),
    type: "turn/started",
    data: { providerThreadId: PROVIDER_THREAD_ID },
  });
  if (args.toolCompletedAt !== null) {
    seedEvent(harness.deps, {
      ...context,
      createdAt: args.toolCompletedAt,
      sequence: next(),
      type: "item/completed",
      data: {
        item: {
          type: "commandExecution",
          id: `${args.turnId}-command`,
          command: "pnpm test",
          cwd: "/tmp/test",
          status: "completed",
          approvalStatus: null,
          exitCode: 0,
          aggregatedOutput: "ok",
        },
      },
    });
  }
  if (args.compactionOnly === true) {
    seedEvent(harness.deps, {
      ...context,
      createdAt: args.usageAt,
      sequence: next(),
      type: "item/completed",
      data: {
        item: { type: "contextCompaction", id: `${args.turnId}-compaction` },
      },
    });
  }
  const tokens = {
    totalTokens: args.usedTokens,
    inputTokens: 10,
    cachedInputTokens: args.usedTokens - 10,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  seedEvent(harness.deps, {
    ...context,
    createdAt: args.usageAt,
    sequence: next(),
    type: "thread/contextWindowUsage/updated",
    data: {
      contextWindowUsage: {
        usedTokens: args.usedTokens,
        modelContextWindow: 1_000_000,
        estimated: false,
      },
    },
  });
  seedEvent(harness.deps, {
    ...context,
    createdAt: args.usageAt,
    sequence: next(),
    type: "thread/tokenUsage/updated",
    data: {
      tokenUsage: {
        total: tokens,
        last: tokens,
        modelContextWindow: 1_000_000,
        ...(args.promptCacheTtlMs === undefined
          ? {}
          : { promptCacheTtlMs: args.promptCacheTtlMs }),
      },
    },
  });
  harness.db
    .update(threads)
    .set({ statusChangedAt: args.usageAt })
    .where(eq(threads.id, args.threadId))
    .run();
}

async function sweep(harness: TestAppHarness, now: number): Promise<void> {
  await idleCompactionSweep(harness.deps, now).run(harness.deps, now);
}

describe("idle compaction", () => {
  it("dates the prompt cache from the turn's last request, not the end of the turn", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedIdleThread(harness);
      setExperiments(harness.db, { compactExpiredCache: true });
      const base = Date.now() - 10 * 60_000;
      seedTurn(harness, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-1",
        startedAt: base,
        toolCompletedAt: base + 30_000,
        usageAt: base + 240_000,
        usedTokens: 150_000,
        promptCacheTtlMs: HOUR,
      });
      const read = async () =>
        (
          await (
            await harness.app.request(`/api/v1/threads/${thread.id}/context`)
          ).json()
        ).usage;
      expect(await read()).toMatchObject({
        compactionOfferAt: new Date(base + 30_000 + HOUR).toISOString(),
        idleCompactionAt: new Date(
          base + 30_000 + HOUR - 120_000,
        ).toISOString(),
      });

      seedTurn(harness, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-2",
        startedAt: base + 300_000,
        toolCompletedAt: null,
        usageAt: base + 420_000,
        usedTokens: 150_000,
        promptCacheTtlMs: HOUR,
      });
      expect(await read()).toMatchObject({
        compactionOfferAt: new Date(base + 300_000 + HOUR).toISOString(),
      });
    });
  });

  it("plans no idle compaction for a 5-minute cache or a child thread", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedIdleThread(harness);
      setExperiments(harness.db, { compactExpiredCache: true });
      const base = Date.now() - 2 * 60_000;
      seedTurn(harness, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-1",
        startedAt: base,
        toolCompletedAt: null,
        usageAt: base + 30_000,
        usedTokens: 150_000,
        promptCacheTtlMs: 300_000,
      });
      const read = async (threadId: string) =>
        (
          await (
            await harness.app.request(`/api/v1/threads/${threadId}/context`)
          ).json()
        ).usage;
      const short = await read(thread.id);
      expect(short.compactionOfferAt).toBe(
        new Date(base + 300_000).toISOString(),
      );
      expect(short).not.toHaveProperty("idleCompactionAt");

      const child = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: thread.projectId,
        providerId: "pi",
        status: "idle",
        parentThreadId: thread.id,
      });
      seedTurn(harness, {
        threadId: child.id,
        environmentId: environment.id,
        turnId: "turn-child",
        startedAt: base,
        toolCompletedAt: null,
        usageAt: base + 30_000,
        usedTokens: 150_000,
        promptCacheTtlMs: HOUR,
      });
      const childUsage = await read(child.id);
      expect(childUsage).toHaveProperty("compactionOfferAt");
      expect(childUsage).not.toHaveProperty("idleCompactionAt");
    });
  });

  it("compacts an idle thread once, two minutes before its prompt cache expires", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread, compactions } = seedIdleThread(harness);
      setExperiments(harness.db, { compactExpiredCache: true });
      const base = Date.now() - 50 * 60_000;
      seedTurn(harness, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-1",
        startedAt: base,
        toolCompletedAt: base + 1_000,
        usageAt: base + 60_000,
        usedTokens: 150_000,
        promptCacheTtlMs: HOUR,
      });
      const expiresAt = base + 1_000 + HOUR;

      harness.db
        .update(threads)
        .set({ lastReadAt: 1_000 })
        .where(eq(threads.id, thread.id))
        .run();
      await sweep(harness, expiresAt - 121_000);
      expect(compactions()).toBe(0);
      await sweep(harness, expiresAt - 100_000);
      expect(compactions()).toBe(1);
      expect(getThread(harness.db, thread.id)?.lastReadAt).toBe(1_000);
      const request = listEvents(harness.db, { threadId: thread.id })
        .filter((event) => event.type === "client/turn/requested")
        .at(-1);
      expect(JSON.parse(request!.data)).toMatchObject({ initiator: "system" });
      harness.db
        .update(threads)
        .set({ status: "idle" })
        .where(eq(threads.id, thread.id))
        .run();
      await sweep(harness, expiresAt - 90_000);
      expect(compactions()).toBe(1);
    });
  });

  it.each([
    ["the experiment is off", { experiment: false }],
    ["the context is under 100k tokens", { usedTokens: 99_999 }],
    ["the provider reported no cache lifetime", { ttl: false }],
    ["the cache has already expired", { late: true }],
    ["a message is queued", { queued: true }],
    ["the last turn was a compaction", { compactionOnly: true }],
    ["the thread is archived", { archived: true }],
    ["the thread is a child thread", { child: true }],
    ["the thread was active less than 30 minutes ago", { recent: true }],
  ] as const)("does not compact when %s", async (_, variant) => {
    await withTestHarness(async (harness) => {
      const { environment, thread, compactions } = seedIdleThread(harness);
      setExperiments(harness.db, {
        compactExpiredCache: !("experiment" in variant),
      });
      const base = Date.now() - 50 * 60_000;
      seedTurn(harness, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-1",
        startedAt: base,
        toolCompletedAt: "compactionOnly" in variant ? null : base + 1_000,
        usageAt: base + 60_000,
        usedTokens: "usedTokens" in variant ? variant.usedTokens : 150_000,
        ...("ttl" in variant ? {} : { promptCacheTtlMs: HOUR }),
        ...("compactionOnly" in variant ? { compactionOnly: true } : {}),
      });
      if ("queued" in variant) {
        createQueuedThreadMessage(harness.db, harness.hub, {
          threadId: thread.id,
          content: textInput("later"),
          model: "pi-model",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          waitingOn: null,
          sendAt: null,
          payload: { kind: "inline" },
          systemNotice: null,
        });
      }
      if ("child" in variant) {
        const parent = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: thread.projectId,
          providerId: "pi",
          status: "idle",
        });
        harness.db
          .update(threads)
          .set({ parentThreadId: parent.id })
          .where(eq(threads.id, thread.id))
          .run();
      }
      if ("recent" in variant) {
        harness.db
          .update(threads)
          .set({ statusChangedAt: base + HOUR - 20 * 60_000 })
          .where(eq(threads.id, thread.id))
          .run();
      }
      if ("archived" in variant) {
        harness.db
          .update(threads)
          .set({ archivedAt: Date.now() })
          .where(eq(threads.id, thread.id))
          .run();
      }
      const expiresAt = base + 1_000 + HOUR;
      await sweep(
        harness,
        "late" in variant ? expiresAt + 1_000 : expiresAt - 100_000,
      );
      expect(compactions()).toBe(0);
    });
  });

  it("does not compact a thread whose machine is offline", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedIdleThread(harness, {
        online: false,
      });
      setExperiments(harness.db, { compactExpiredCache: true });
      const base = Date.now() - 50 * 60_000;
      seedTurn(harness, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-1",
        startedAt: base,
        toolCompletedAt: base + 1_000,
        usageAt: base + 60_000,
        usedTokens: 150_000,
        promptCacheTtlMs: HOUR,
      });
      expect(
        dueIdleCompactionWindow(
          harness.deps,
          thread.id,
          base + 1_000 + HOUR - 100_000,
        ),
      ).toBeNull();
    });
  });

  it("does not compact a thread with a pending interaction", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedIdleThread(harness);
      setExperiments(harness.db, { compactExpiredCache: true });
      const base = Date.now() - 50 * 60_000;
      seedTurn(harness, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-1",
        startedAt: base,
        toolCompletedAt: base + 1_000,
        usageAt: base + 60_000,
        usedTokens: 150_000,
        promptCacheTtlMs: HOUR,
      });
      const now = base + 1_000 + HOUR - 100_000;
      expect(
        dueIdleCompactionWindow(harness.deps, thread.id, now),
      ).not.toBeNull();
      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: thread.id,
            turnId: "turn-1",
            providerId: "pi",
            providerThreadId: PROVIDER_THREAD_ID,
            providerRequestId: "request-1",
            payload: createUserQuestionPayload(),
          },
        });
      expect(registered.outcome).not.toBe("rejected");
      expect(dueIdleCompactionWindow(harness.deps, thread.id, now)).toBeNull();
    });
  });

  it("does not mark the thread unread when a turn only compacted the context", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedIdleThread(harness);
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/compact`,
        { method: "POST" },
      );
      expect(response.status).toBe(200);
      const before = getThread(harness.db, thread.id)!.latestAttentionAt;
      seedTurn(harness, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-compact",
        startedAt: Date.now(),
        toolCompletedAt: null,
        usageAt: Date.now(),
        usedTokens: 20_000,
        compactionOnly: true,
      });
      runThreadLifecycleTransaction(harness.deps, thread.id, {
        type: "turn.completed",
        turnId: "turn-compact",
        status: "completed",
      });
      const after = getThread(harness.db, thread.id)!;
      expect(after.status).toBe("idle");
      expect(after.latestAttentionAt).toBe(before);
    });
  });
});
