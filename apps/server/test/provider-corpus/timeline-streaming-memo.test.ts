import {
  corpusAvailable,
  listCorpusThreads,
  loadCorpusThread,
} from "@bb/test-helpers";
import {
  createConnection,
  getLatestThreadSequence,
  insertEvents,
  noopNotifier,
} from "@bb/db";
import type { DbConnection } from "@bb/db";
import type { Thread, ThreadEventType } from "@bb/domain";
import { turnScope } from "@bb/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProviderRegistryService } from "../../src/services/providers/provider-registry.js";
import { clearTimelineOrderingContextCache } from "../../src/services/threads/timeline-context-order.js";
import { createTestProviderRegistry } from "../helpers/provider-registry.js";
import {
  TIMELINE_VARIANTS,
  buildRouteTimelinePage,
  clearCrossBuildTimelineCaches,
  latestTimelinePage,
  loadCorpusThreadIntoDb,
  percentile,
  selectionWasReused,
} from "./corpus-harness.js";

const PER_THREAD_TIMEOUT_MS = 5 * 60_000;
const PROBE_ITEM_ID = "corpus-memo-probe-message";

interface TickSpec {
  data: Record<string, unknown>;
  itemId: string;
  itemKind: "agentMessage" | null;
  target: "earlier-root-turn" | "latest-root-turn";
  type: ThreadEventType;
}

function tickSpec(
  type: ThreadEventType,
  data: Record<string, unknown>,
  overrides: Partial<TickSpec> = {},
): TickSpec {
  return {
    data,
    itemId: PROBE_ITEM_ID,
    itemKind: null,
    target: "latest-root-turn",
    type,
    ...overrides,
  };
}

const TICKS: readonly TickSpec[] = [
  tickSpec(
    "item/started",
    { item: { type: "agentMessage", id: PROBE_ITEM_ID, text: "" } },
    { itemKind: "agentMessage" },
  ),
  tickSpec("item/agentMessage/delta", {
    itemId: PROBE_ITEM_ID,
    delta: "Streaming probe",
  }),
  tickSpec("item/agentMessage/delta", {
    itemId: PROBE_ITEM_ID,
    delta: " line\n",
  }),
  tickSpec("thread/contextWindowUsage/updated", {
    contextWindowUsage: {
      estimated: false,
      modelContextWindow: 200_000,
      usedTokens: 1_234,
    },
  }),
  tickSpec("item/agentMessage/delta", {
    itemId: PROBE_ITEM_ID,
    delta: "partial",
  }),
  tickSpec(
    "item/commandExecution/outputDelta",
    { itemId: "corpus-memo-probe-late-command", delta: "late output\n" },
    { itemId: "corpus-memo-probe-late-command", target: "earlier-root-turn" },
  ),
  tickSpec("item/agentMessage/delta", {
    itemId: PROBE_ITEM_ID,
    delta: " after late\n",
  }),
];

interface RootTurn {
  providerThreadId: string | null;
  turnId: string;
}

function listLatestRootTurns(db: DbConnection, threadId: string): RootTurn[] {
  return db.$client
    .prepare<[string], RootTurn>(
      `SELECT turn_id AS turnId, provider_thread_id AS providerThreadId
       FROM events
       WHERE thread_id = ? AND type = 'turn/started' AND parent_tool_call_id IS NULL
       ORDER BY sequence DESC LIMIT 2`,
    )
    .all(threadId);
}

const available = corpusAvailable();
const corpusThreads = available ? listCorpusThreads() : [];

describe.skipIf(!available)("provider corpus streaming selection memo", () => {
  let registry: ProviderRegistryService | null = null;
  const totals = { comparisons: 0, reused: 0, threads: 0 };
  const warmTickMs: number[] = [];
  const coldTickMs: number[] = [];

  beforeAll(async () => {
    if (available) {
      registry = await createTestProviderRegistry();
    }
  });

  afterAll(() => {
    if (totals.threads === 0) return;
    process.stdout.write(
      `Streaming selection memo: ${totals.threads} threads, ${totals.comparisons} warm/cold comparisons, ${totals.reused} reused selections; ` +
        `tick build p50 warm ${percentile(warmTickMs, 0.5).toFixed(2)} ms vs cold ${percentile(coldTickMs, 0.5).toFixed(2)} ms\n`,
    );
  });

  it.each(corpusThreads.map((thread) => [thread.id, thread.provider] as const))(
    "%s (%s) matches a cold build while a turn streams",
    (threadId) => {
      if (registry === null) {
        throw new Error("provider registry did not load");
      }
      const corpusThread = loadCorpusThread(threadId);
      const loaded = loadCorpusThreadIntoDb(corpusThread);
      try {
        const [latestRootTurn, earlierRootTurn] = listLatestRootTurns(
          loaded.db,
          loaded.thread.id,
        );
        if (latestRootTurn === undefined) return;
        const thread: Thread = { ...loaded.thread, status: "active" };
        totals.threads += 1;
        for (const tick of [null, ...TICKS]) {
          if (tick !== null) {
            const rootTurn =
              tick.target === "latest-root-turn"
                ? latestRootTurn
                : earlierRootTurn;
            if (rootTurn === undefined) continue;
            insertEvents(loaded.db, noopNotifier, [
              {
                data: JSON.stringify(tick.data),
                itemId: tick.itemId,
                itemKind: tick.itemKind,
                parentToolCallId: null,
                providerThreadId:
                  rootTurn.providerThreadId ?? latestRootTurn.providerThreadId,
                scope: turnScope(rootTurn.turnId),
                sequence:
                  getLatestThreadSequence(loaded.db, {
                    threadId: loaded.thread.id,
                  }) + 1,
                threadId: loaded.thread.id,
                type: tick.type,
              },
            ]);
          }
          const clone = createConnection(loaded.db.$client.serialize());
          try {
            for (const variant of TIMELINE_VARIANTS) {
              const args = {
                page: latestTimelinePage(),
                registry,
                thread,
                variant,
              };
              const warm = buildRouteTimelinePage({ ...args, db: loaded.db });
              clearCrossBuildTimelineCaches(clone);
              clearTimelineOrderingContextCache(clone);
              const cold = buildRouteTimelinePage({ ...args, db: clone });
              expect(JSON.stringify(warm.response)).toBe(
                JSON.stringify(cold.response),
              );
              totals.comparisons += 1;
              if (selectionWasReused(warm.profile)) {
                totals.reused += 1;
                if (variant === "default") {
                  warmTickMs.push(warm.profile.totalDurationMs);
                  coldTickMs.push(cold.profile.totalDurationMs);
                }
              }
            }
          } finally {
            clone.$client.close();
          }
        }
      } finally {
        loaded.close();
      }
    },
    PER_THREAD_TIMEOUT_MS,
  );
});
