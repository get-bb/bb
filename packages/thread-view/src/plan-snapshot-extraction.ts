import type {
  Thread,
  ThreadEvent,
  ThreadTimelinePendingPlan,
  ThreadTimelinePendingPlanStep,
} from "@bb/domain";
import type { ThreadEventWithMeta } from "./build-event-projection.js";
import { getOrderedThreadEvents } from "./group-event-projection-turns.js";

const PLAN_TEXT_MAX_LENGTH = 240;

function trimAndTruncate(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= PLAN_TEXT_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, PLAN_TEXT_MAX_LENGTH);
}

function planStepIdFor(seq: number, index: number): string {
  return `plan:${seq}:${index}`;
}

function extractTurnPlanCandidate(
  event: ThreadEvent,
  meta: { seq: number; createdAt: number },
): ThreadTimelinePendingPlan | null {
  if (event.type !== "turn/plan/updated") return null;
  const steps: ThreadTimelinePendingPlanStep[] = [];
  for (let index = 0; index < event.plan.length; index += 1) {
    const step = event.plan[index]!;
    const text = trimAndTruncate(step.step);
    if (text.length === 0) continue;
    steps.push({
      id: planStepIdFor(meta.seq, index),
      text,
      status: step.status ?? "pending",
    });
  }
  const explanation =
    event.explanation !== undefined ? trimAndTruncate(event.explanation) : null;
  return {
    sourceSeq: meta.seq,
    updatedAt: meta.createdAt,
    explanation: explanation && explanation.length > 0 ? explanation : null,
    steps,
  };
}

/**
 * Walks decoded thread events and emits the latest structured provider plan.
 * This is intentionally separate from pending todos: Codex `/plan` is a plan
 * mode surface, not an automatic task-list creation flow.
 */
export function extractThreadTimelinePendingPlan(
  threadStatus: Thread["status"],
  events: readonly ThreadEventWithMeta[],
): ThreadTimelinePendingPlan | null {
  if (threadStatus !== "active") return null;

  let best: ThreadTimelinePendingPlan | null = null;
  for (const { event, meta } of getOrderedThreadEvents(events)) {
    const candidate = extractTurnPlanCandidate(event, meta);
    if (!candidate) continue;
    if (best === null || candidate.sourceSeq > best.sourceSeq) {
      best = candidate;
    }
  }
  return best;
}
