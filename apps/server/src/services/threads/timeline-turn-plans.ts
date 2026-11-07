import { z } from "zod";
import type { StoredTimelineTurnPlan } from "@bb/thread-view";
import { timelineTurnRowSchema } from "@bb/server-contract";
import {
  getTimelineTurnPlanWatermark,
  listThreadTurnTimelinePlanRecords,
  upsertThreadTurnTimelinePlanRecord,
  type DbConnection,
  type StoredEventRow,
} from "@bb/db";

const TIMELINE_TURN_PLAN_VERSION = 1;

const storedTimelineTurnPlanRecordSchema = z.object({
  delegatingItemIds: z.array(z.string()),
  openItemIds: z.array(z.string()),
  plan: z.object({
    externalUserBoundarySeqs: z.array(z.number()),
    items: z.array(
      z.union([
        z.object({
          kind: z.literal("message"),
          messageId: z.string(),
          sourceSeqEnd: z.number(),
          sourceSeqStart: z.number(),
        }),
        z.object({ kind: z.literal("summary"), row: timelineTurnRowSchema }),
      ]),
    ),
  }),
});

export interface LoadedTimelineTurnPlan {
  delegatingItemIds: readonly string[];
  openItemIds: readonly string[];
  plan: StoredTimelineTurnPlan;
}

export function timelineTurnPlanProjectionKey(
  parts: readonly unknown[],
): string {
  return JSON.stringify([TIMELINE_TURN_PLAN_VERSION, ...parts]);
}

function parseStoredTimelineTurnPlan(
  planJson: string,
): LoadedTimelineTurnPlan | null {
  try {
    const parsed = storedTimelineTurnPlanRecordSchema.safeParse(
      JSON.parse(planJson),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function loadValidTimelineTurnPlans(
  db: DbConnection,
  args: {
    maxSeq: number;
    projectionKey: string;
    threadId: string;
    turnIds: readonly string[];
  },
): Map<string, LoadedTimelineTurnPlan> {
  const plans = new Map<string, LoadedTimelineTurnPlan>();
  for (const record of listThreadTurnTimelinePlanRecords(db, args)) {
    if (record.projectionKey !== args.projectionKey) continue;
    const loaded = parseStoredTimelineTurnPlan(record.planJson);
    if (loaded === null) continue;
    const watermark = getTimelineTurnPlanWatermark(db, {
      delegatingItemIds: loaded.delegatingItemIds,
      maxSeq: args.maxSeq,
      openItemIds: loaded.openItemIds,
      threadId: args.threadId,
      turnId: record.turnId,
    });
    if (watermark === record.watermark) plans.set(record.turnId, loaded);
  }
  return plans;
}

function collectTimelineTurnPlanDependencies(
  rows: readonly StoredEventRow[],
  turnId: string,
): Pick<LoadedTimelineTurnPlan, "delegatingItemIds" | "openItemIds"> {
  const delegatingItemIds = new Set<string>();
  const startedItemIds = new Set<string>();
  const completedItemIds = new Set<string>();
  for (const row of rows) {
    if (row.turnId !== turnId || row.itemId === null) continue;
    if (row.itemKind === "toolCall" || row.itemKind === "delegation") {
      delegatingItemIds.add(row.itemId);
    }
    if (row.type === "item/started") startedItemIds.add(row.itemId);
    if (row.type === "item/completed") completedItemIds.add(row.itemId);
  }
  let added = true;
  while (added) {
    added = false;
    for (const row of rows) {
      if (
        row.parentToolCallId !== null &&
        delegatingItemIds.has(row.parentToolCallId) &&
        row.itemId !== null &&
        (row.itemKind === "toolCall" || row.itemKind === "delegation") &&
        !delegatingItemIds.has(row.itemId)
      ) {
        delegatingItemIds.add(row.itemId);
        added = true;
      }
    }
  }
  return {
    delegatingItemIds: [...delegatingItemIds],
    openItemIds: [...startedItemIds].filter(
      (itemId) => !completedItemIds.has(itemId),
    ),
  };
}

export function storeTimelineTurnPlans(
  db: DbConnection,
  args: {
    maxSeq: number;
    plans: ReadonlyMap<string, StoredTimelineTurnPlan>;
    projectionKey: string;
    rows: readonly StoredEventRow[];
    threadId: string;
    turnIds: ReadonlySet<string>;
  },
): void {
  for (const turnId of args.turnIds) {
    const plan = args.plans.get(turnId);
    if (plan === undefined) continue;
    const dependencies = collectTimelineTurnPlanDependencies(args.rows, turnId);
    upsertThreadTurnTimelinePlanRecord(db, {
      planJson: JSON.stringify({ ...dependencies, plan }),
      projectionKey: args.projectionKey,
      threadId: args.threadId,
      turnId,
      watermark: getTimelineTurnPlanWatermark(db, {
        ...dependencies,
        maxSeq: args.maxSeq,
        threadId: args.threadId,
        turnId,
      }),
    });
  }
}
