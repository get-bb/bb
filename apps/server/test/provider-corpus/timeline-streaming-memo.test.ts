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
import type { ThreadTimelineBuildProfile } from "../../src/services/threads/timeline.js";
import { createTestProviderRegistry } from "../helpers/provider-registry.js";
import {
  TIMELINE_VARIANTS,
  buildRouteTimelinePage,
  latestTimelinePage,
  loadCorpusThreadIntoDb,
  percentile,
} from "./corpus-harness.js";

const PER_THREAD_TIMEOUT_MS = 5 * 60_000;
const PROBE_ITEM_ID = "corpus-memo-probe-message";
const LATE_PROBE_ITEM_ID = "corpus-memo-probe-late-command";

interface TickSpec {
  data: Record<string, unknown>;
  itemId: string;
  itemKind: "agentMessage" | null;
  target: "earlier-root-turn" | "latest-root-turn";
  type: ThreadEventType;
}

const TICKS: readonly TickSpec[] = [
  {
    data: { item: { type: "agentMessage", id: PROBE_ITEM_ID, text: "" } },
    itemId: PROBE_ITEM_ID,
    itemKind: "agentMessage",
    target: "latest-root-turn",
    type: "item/started",
  },
  {
    data: { itemId: PROBE_ITEM_ID, delta: "Streaming probe" },
    itemId: PROBE_ITEM_ID,
    itemKind: null,
    target: "latest-root-turn",
    type: "item/agentMessage/delta",
  },
  {
    data: { itemId: PROBE_ITEM_ID, delta: " line\n" },
    itemId: PROBE_ITEM_ID,
    itemKind: null,
    target: "latest-root-turn",
    type: "item/agentMessage/delta",
  },
  {
    data: {
      contextWindowUsage: {
        estimated: false,
        modelContextWindow: 200_000,
        usedTokens: 1_234,
      },
    },
    itemId: PROBE_ITEM_ID,
    itemKind: null,
    target: "latest-root-turn",
    type: "thread/contextWindowUsage/updated",
  },
  {
    data: { itemId: PROBE_ITEM_ID, delta: "partial" },
    itemId: PROBE_ITEM_ID,
    itemKind: null,
    target: "latest-root-turn",
    type: "item/agentMessage/delta",
  },
  {
    data: { itemId: LATE_PROBE_ITEM_ID, delta: "late output\n" },
    itemId: LATE_PROBE_ITEM_ID,
    itemKind: null,
    target: "earlier-root-turn",
    type: "item/commandExecution/outputDelta",
  },
  {
    data: { itemId: PROBE_ITEM_ID, delta: " after late\n" },
    itemId: PROBE_ITEM_ID,
    itemKind: null,
    target: "latest-root-turn",
    type: "item/agentMessage/delta",
  },
];

interface RootTurn {
  providerThreadId: string | null;
  turnId: string;
}

function selectionWasReused(profile: ThreadTimelineBuildProfile): boolean {
  return (
    profile.stageTimings.some(
      (timing) => timing.stage === "selection-memo-lookup",
    ) &&
    !profile.stageTimings.some(
      (timing) =>
        timing.stage === "group-context-query" ||
        timing.stage === "ordering-context-query",
    )
  );
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
          for (const variant of TIMELINE_VARIANTS) {
            const warm = buildRouteTimelinePage({
              db: loaded.db,
              page: latestTimelinePage(),
              registry,
              thread,
              variant,
            });
            const clone = createConnection(loaded.db.$client.serialize());
            try {
              const cold = buildRouteTimelinePage({
                db: clone,
                page: latestTimelinePage(),
                registry,
                thread,
                variant,
              });
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
            } finally {
              clone.$client.close();
            }
          }
        }
      } finally {
        loaded.close();
      }
    },
    PER_THREAD_TIMEOUT_MS,
  );
});
