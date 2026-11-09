import { and, eq, inArray } from "drizzle-orm";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  events,
  getThread,
  getThreadEventRewriteGeneration,
  threads,
} from "@bb/db";
import {
  defaultFeatureFlags,
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type Thread,
  type ThreadEventType,
} from "@bb/domain";
import {
  isThreadTimelineDelta,
  type ThreadTimelineResponse,
} from "@bb/server-contract";
import { pruneThreadEventHistoryBestEffort } from "../../src/services/system/event-pruning.js";
import { threadPruningSweep } from "../../src/services/system/thread-pruning-sweep.js";
import { clearStoredEventDecodeCache } from "../../src/services/threads/stored-event-decode-cache.js";
import {
  createThreadTimelineWindows,
  type ThreadTimelineWindowRequest,
} from "../../src/services/threads/thread-timeline-windows.js";
import {
  clearTimelineOrderingContextCache,
  getTimelineGroupingContext,
} from "../../src/services/threads/timeline-context-order.js";
import { clearTimelineProjectionFolds } from "../../src/services/threads/timeline-projection-fold.js";
import { clearTimelineSelectionMemo } from "../../src/services/threads/timeline-selection-memo.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const LATEST: ThreadTimelineWindowRequest = {
  deferContent: false,
  includeNestedRows: false,
  page: { kind: "latest", segmentLimit: 20 },
};

const SMALL_WINDOW = {
  featureFlags: { ...defaultFeatureFlags, timelineWindowEventBudget: 20 },
};

const TOKEN_BREAKDOWN = {
  totalTokens: 1200,
  inputTokens: 200,
  cachedInputTokens: 900,
  outputTokens: 100,
  reasoningOutputTokens: 0,
};

const RATE_LIMITS = {
  providerId: "codex",
  status: "allowed",
  kind: "credits",
  windows: [
    {
      providerKey: "primary",
      label: "Current session",
      status: "allowed",
      resetsAtMs: 1_800_000_000_000,
    },
  ],
  reachedReason: null,
  overageStatus: null,
  overageReason: null,
};

interface ThreadScript {
  thread: Thread;
  append(
    type: ThreadEventType,
    scope: ReturnType<typeof turnScope> | ReturnType<typeof threadScope>,
    data: Record<string, unknown>,
  ): void;
  startTurn(turn: number): string;
  finishTurn(turnId: string, turn: number): void;
}

function createThreadScript(harness: TestAppHarness): ThreadScript {
  const { environment, thread } = seedThreadFixture(harness, {
    thread: { providerId: "codex" },
  });
  let sequence = 0;
  const script: ThreadScript = {
    thread,
    append(type, scope, data) {
      sequence += 1;
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope,
        sequence,
        type,
        data,
      });
    },
    startTurn(turn) {
      const turnId = `turn-${turn}`;
      const clientRequestId = encodeClientTurnRequestIdNumber({ value: turn });
      script.append("client/turn/requested", threadScope(), {
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: clientRequestId,
        senderThreadId: null,
        input: [{ type: "text", text: `User message ${turn}`, mentions: [] }],
        target: turn === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      });
      script.append("turn/started", turnScope(turnId), {});
      script.append("turn/input/accepted", turnScope(turnId), {
        clientRequestId,
      });
      return turnId;
    },
    finishTurn(turnId, turn) {
      script.append("item/completed", turnScope(turnId), {
        item: {
          type: "agentMessage",
          id: `${turnId}-answer`,
          text: `Turn ${turn} is done.`,
        },
      });
      script.append("turn/completed", turnScope(turnId), {
        status: "completed",
      });
    },
  };
  return script;
}

function full(response: unknown): ThreadTimelineResponse {
  const parsed = response as Parameters<typeof isThreadTimelineDelta>[0];
  if (isThreadTimelineDelta(parsed)) throw new Error("expected a full window");
  return parsed;
}

function freshLatest(
  harness: TestAppHarness,
  threadId: string,
): ThreadTimelineResponse {
  clearTimelineSelectionMemo(harness.db);
  clearTimelineProjectionFolds(harness.db);
  clearTimelineOrderingContextCache(harness.db);
  clearStoredEventDecodeCache(harness.db);
  const thread = getThread(harness.db, threadId);
  if (thread === null) throw new Error("missing thread");
  return full(
    createThreadTimelineWindows(harness.deps).read(thread, LATEST, undefined),
  );
}

function countEvents(
  harness: TestAppHarness,
  threadId: string,
  types: ThreadEventType[],
): number {
  return harness.db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.threadId, threadId), inArray(events.type, types)))
    .all().length;
}

function recordCompactions(harness: TestAppHarness, threadId: string) {
  let notices = 0;
  const stop = harness.deps.hub.onChangedMessage((message) => {
    if (
      message.entity === "thread" &&
      message.id === threadId &&
      message.changes.includes("history-compacted")
    )
      notices += 1;
  });
  return { notices: () => notices, stop };
}

describe("pruning invalidation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps an active thread's served window and announces nothing when live pruning removes only usage snapshots and turn diffs", async () => {
    await withTestHarness(async (harness) => {
      const script = createThreadScript(harness);
      for (let turn = 1; turn <= 3; turn += 1) {
        const turnId = script.startTurn(turn);
        for (let step = 0; step < 40; step += 1) {
          script.append("thread/tokenUsage/updated", turnScope(turnId), {
            tokenUsage: {
              total: TOKEN_BREAKDOWN,
              last: TOKEN_BREAKDOWN,
              modelContextWindow: 400_000,
            },
          });
          script.append(
            "thread/contextWindowUsage/updated",
            turnScope(turnId),
            {
              contextWindowUsage: {
                usedTokens: 1000 + step,
                modelContextWindow: 400_000,
                estimated: step % 2 === 0,
              },
            },
          );
          script.append("turn/diff/updated", turnScope(turnId), {
            diff: `diff ${turn}.${step}`,
          });
        }
        if (turn < 3) script.finishTurn(turnId, turn);
      }
      harness.db
        .update(threads)
        .set({ status: "active" })
        .where(eq(threads.id, script.thread.id))
        .run();
      const threadId = script.thread.id;
      const windows = createThreadTimelineWindows(harness.deps);
      const compactions = recordCompactions(harness, threadId);
      const generation = getThreadEventRewriteGeneration(threadId);
      const loadThread = () => getThread(harness.db, threadId)!;
      const served = full(windows.read(loadThread(), LATEST, undefined));
      const usageTypes: ThreadEventType[] = [
        "thread/tokenUsage/updated",
        "thread/contextWindowUsage/updated",
      ];
      const diffTypes: ThreadEventType[] = ["turn/diff/updated"];
      const usageBefore = countEvents(harness, threadId, usageTypes);
      const diffsBefore = countEvents(harness, threadId, diffTypes);

      vi.spyOn(performance, "now").mockReturnValue(0);
      for (let call = 0; call < 24; call += 1)
        pruneThreadEventHistoryBestEffort(harness.deps, {
          mode: "active",
          threadId,
        });

      expect(countEvents(harness, threadId, usageTypes)).toBeLessThan(
        usageBefore - 32,
      );
      expect(countEvents(harness, threadId, diffTypes)).toBeLessThan(
        diffsBefore - 32,
      );
      expect(compactions.notices()).toBe(0);
      expect(getThreadEventRewriteGeneration(threadId)).toBe(generation);
      expect(windows.read(loadThread(), LATEST, undefined)).toBe(served);
      expect(freshLatest(harness, threadId)).toEqual(served);
      compactions.stop();
    });
  });

  it("serves the compacted window after every run of a sweep pass that spans several runs, without notifying viewers", async () => {
    await withTestHarness(SMALL_WINDOW, async (harness) => {
      const script = createThreadScript(harness);
      const first = script.startTurn(1);
      script.finishTurn(first, 1);
      const second = script.startTurn(2);
      for (let step = 0; step < 200; step += 1)
        script.append("provider/rateLimits/updated", threadScope(), {
          rateLimits: RATE_LIMITS,
        });
      script.finishTurn(second, 2);
      const third = script.startTurn(3);
      script.finishTurn(third, 3);
      const threadId = script.thread.id;
      const windows = createThreadTimelineWindows(harness.deps);
      const loadThread = () => getThread(harness.db, threadId)!;
      const initial = full(windows.read(loadThread(), LATEST, undefined));
      expect(JSON.stringify(initial.rows)).not.toContain("User message 1");
      const compactions = recordCompactions(harness, threadId);
      const sweep = () =>
        threadPruningSweep(harness.deps, {
          elapsedBudgetMs: Number.POSITIVE_INFINITY,
          maxAdvances: 1,
        }).run(harness.deps, Date.now());

      const rateLimitRows = () =>
        countEvents(harness, threadId, ["provider/rateLimits/updated"]);
      const removedByRun: number[] = [];
      for (let run = 0; run < 40 && rateLimitRows() > 1; run += 1) {
        const remaining = rateLimitRows();
        await sweep();
        removedByRun.push(remaining - rateLimitRows());
        const served = full(windows.read(loadThread(), LATEST, undefined));
        expect(served).toEqual(freshLatest(harness, threadId));
      }

      expect(rateLimitRows()).toBe(1);
      expect(
        removedByRun.filter((removed) => removed > 0).length,
      ).toBeGreaterThan(1);
      expect(compactions.notices()).toBe(0);
      const compacted = full(windows.read(loadThread(), LATEST, undefined));
      expect(JSON.stringify(compacted.rows)).toContain("User message 1");
      compactions.stop();
    });
  });

  it("keeps other threads' grouping contexts when one thread's history is rewritten", async () => {
    await withTestHarness(async (harness) => {
      const rewritten = createThreadScript(harness);
      const kept = createThreadScript(harness);
      for (const script of [rewritten, kept]) {
        const turnId = script.startTurn(1);
        script.finishTurn(turnId, 1);
      }
      createThreadTimelineWindows(harness.deps);
      const args = (thread: Thread) => ({
        maxSeq: 6,
        sequenceStart: 0,
        threadId: thread.id,
      });
      const keptContext = getTimelineGroupingContext(
        harness.db,
        args(kept.thread),
      );
      const rewrittenContext = getTimelineGroupingContext(
        harness.db,
        args(rewritten.thread),
      );

      harness.deps.hub.notifyThread(rewritten.thread.id, ["history-rewritten"]);

      expect(getTimelineGroupingContext(harness.db, args(kept.thread))).toBe(
        keptContext,
      );
      expect(
        getTimelineGroupingContext(harness.db, args(rewritten.thread)),
      ).not.toBe(rewrittenContext);
    });
  });

  it("keeps a window's older cursor usable after pruning deletes the rows around it", async () => {
    await withTestHarness(SMALL_WINDOW, async (harness) => {
      const script = createThreadScript(harness);
      const turnId = "turn-without-request";
      script.append("turn/started", turnScope(turnId), {});
      for (let step = 0; step < 15; step += 1) {
        const item = { type: "agentMessage", id: `message-${step}` };
        script.append("item/started", turnScope(turnId), {
          item: { ...item, text: "" },
        });
        script.append("provider/rateLimits/updated", threadScope(), {
          rateLimits: RATE_LIMITS,
        });
        script.append("item/completed", turnScope(turnId), {
          item: { ...item, text: `Step ${step} is done.` },
        });
      }
      script.append("turn/completed", turnScope(turnId), {
        status: "completed",
      });
      const threadId = script.thread.id;
      const windows = createThreadTimelineWindows(harness.deps);
      const loadThread = () => getThread(harness.db, threadId)!;
      const cursor = full(windows.read(loadThread(), LATEST, undefined))
        .timelinePage.olderCursor;
      if (cursor === null) throw new Error("expected an older cursor");
      const compactions = recordCompactions(harness, threadId);

      for (let run = 0; run < 10; run += 1)
        await threadPruningSweep(harness.deps, {
          elapsedBudgetMs: Number.POSITIVE_INFINITY,
          maxAdvances: 64,
        }).run(harness.deps, Date.now());

      expect(
        countEvents(harness, threadId, ["provider/rateLimits/updated"]),
      ).toBe(1);
      const older = full(
        windows.read(
          loadThread(),
          {
            ...LATEST,
            page: { kind: "older", segmentLimit: 20, beforeCursor: cursor },
          },
          undefined,
        ),
      );
      expect(JSON.stringify(older.rows)).toContain("Step 0 is done.");
      expect(compactions.notices()).toBe(0);
      compactions.stop();
    });
  });
});
