import type {
  Thread,
  ThreadEvent,
  ThreadEventPlanStep,
  ThreadTimelinePendingTodoItem,
  ThreadTimelinePendingTodoItemStatus,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import type { ThreadEventWithMeta } from "./build-event-projection.js";
import { getOrderedThreadEvents } from "./group-event-projection-turns.js";

const TODO_TEXT_MAX_LENGTH = 240;

function trimAndTruncate(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= TODO_TEXT_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, TODO_TEXT_MAX_LENGTH);
}

interface SnapshotCandidate {
  seq: number;
  createdAt: number;
  items: ThreadTimelinePendingTodoItem[];
}

interface SnapshotCandidateMeta {
  seq: number;
  createdAt: number;
}

function todoIdFor(seq: number, index: number): string {
  return `seq:${seq}:${index}`;
}

const PLAN_STEP_TODO_STATUSES: Readonly<
  Record<
    NonNullable<ThreadEventPlanStep["status"]>,
    ThreadTimelinePendingTodoItemStatus
  >
> = {
  pending: "pending",
  active: "in_progress",
  completed: "completed",
  // A failed step is settled work: it is no longer pending in the banner.
  failed: "completed",
};

/**
 * A grammar v3 `planSteps` snapshot (Claude TodoWrite and the folded
 * task-list tools, codex `update_plan`, the ACP plan): the bridge already
 * reduced the plan to its full step list, so the snapshot is the candidate
 * as-is. The only source the banner reads — core keeps no table of the tool
 * names that used to carry a plan.
 */
function extractPlanStepsCandidate(
  event: ThreadEvent,
  meta: SnapshotCandidateMeta,
): SnapshotCandidate | null {
  if (event.type !== "item/completed" || event.item.type !== "planSteps") {
    return null;
  }
  const items: ThreadTimelinePendingTodoItem[] = [];
  for (const [index, step] of event.item.steps.entries()) {
    const text = trimAndTruncate(step.step);
    if (text.length === 0) continue;
    items.push({
      id: todoIdFor(meta.seq, index),
      text,
      status: PLAN_STEP_TODO_STATUSES[step.status ?? "pending"],
    });
  }
  return { seq: meta.seq, createdAt: meta.createdAt, items };
}

/**
 * Walks decoded thread events and emits the latest plan snapshot. Treated
 * like `activeThinking`: only meaningful while the thread has an active
 * turn. Returns null when the thread is idle/errored/etc. or when no
 * snapshot was observed. A later snapshot supersedes an earlier one.
 */
export function extractThreadTimelinePendingTodos(
  threadStatus: Thread["status"],
  events: readonly ThreadEventWithMeta[],
): ThreadTimelinePendingTodos | null {
  if (threadStatus !== "active") return null;

  let best: SnapshotCandidate | null = null;
  for (const { event, meta } of getOrderedThreadEvents(events)) {
    const candidate = extractPlanStepsCandidate(event, meta);
    if (!candidate) continue;
    if (best === null || candidate.seq > best.seq) {
      best = candidate;
    }
  }
  if (best === null) return null;
  return {
    sourceSeq: best.seq,
    updatedAt: best.createdAt,
    items: best.items,
  };
}
