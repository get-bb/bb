import type { ThreadEvent, ThreadTimelineGoal } from "@bb/domain";
import type { ThreadEventWithMeta } from "./build-event-projection.js";
import { getOrderedThreadEvents } from "./group-event-projection-turns.js";

type GoalSnapshotCandidate =
  | {
      kind: "updated";
      goal: ThreadTimelineGoal;
      seq: number;
    }
  | {
      kind: "cleared";
      seq: number;
    };

function extractGoalSnapshotCandidate(
  event: ThreadEvent,
  meta: { createdAt: number; seq: number },
): GoalSnapshotCandidate | null {
  if (event.type === "thread/goal/cleared") {
    return {
      kind: "cleared",
      seq: meta.seq,
    };
  }
  if (event.type !== "thread/goal/updated") return null;
  return {
    kind: "updated",
    seq: meta.seq,
    goal: {
      sourceSeq: meta.seq,
      updatedAt: meta.createdAt,
      objective: event.objective,
      status: event.status,
      tokenBudget: event.tokenBudget,
      tokensUsed: event.tokensUsed,
      timeUsedSeconds: event.timeUsedSeconds,
    },
  };
}

export function extractThreadTimelineGoal(
  events: readonly ThreadEventWithMeta[],
): ThreadTimelineGoal | null {
  let best: GoalSnapshotCandidate | null = null;
  for (const { event, meta } of getOrderedThreadEvents(events)) {
    const candidate = extractGoalSnapshotCandidate(event, meta);
    if (!candidate) continue;
    if (best === null || candidate.seq > best.seq) {
      best = candidate;
    }
  }
  if (best === null || best.kind === "cleared") return null;
  return best.goal;
}
