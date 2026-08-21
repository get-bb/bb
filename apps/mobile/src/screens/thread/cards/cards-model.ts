import type {
  ThreadTimelineGoal,
  ThreadTimelinePendingTodoItem,
  ThreadTimelinePendingTodoItemStatus,
} from "@bb/domain";
import type { ThreadContextWindowUsage } from "@bb/server-contract";

/**
 * Pure formatting for the read-only prompt-stack cards (mirrors the helpers
 * inside apps/app/src/components/promptbox/banner/* and
 * components/thread/timeline/thread-context-window-usage.ts).
 */

export function formatGoalDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = Math.round(seconds % 60);
    return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

export function formatGoalTokenUsage(
  goal: Pick<ThreadTimelineGoal, "tokensUsed" | "tokenBudget">,
): string {
  const used = goal.tokensUsed.toLocaleString();
  if (goal.tokenBudget === null) return `${used} tokens`;
  return `${used} / ${goal.tokenBudget.toLocaleString()} tokens`;
}

const TODO_STATUS_SORT_RANK: Record<
  ThreadTimelinePendingTodoItemStatus,
  number
> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

/** In-progress first, then pending, then completed (stable within a rank). */
export function sortTodoItems(
  items: readonly ThreadTimelinePendingTodoItem[],
): ThreadTimelinePendingTodoItem[] {
  return [...items].sort(
    (a, b) => TODO_STATUS_SORT_RANK[a.status] - TODO_STATUS_SORT_RANK[b.status],
  );
}

export function summarizeTodoItems(
  items: readonly ThreadTimelinePendingTodoItem[],
): string {
  const completed = items.filter((item) => item.status === "completed").length;
  return `${completed}/${items.length} complete`;
}

export function calculateContextWindowUsagePercent(
  usage: ThreadContextWindowUsage,
): number {
  if (usage.modelContextWindow <= 0) return 0;
  const ratio = usage.usedTokens / usage.modelContextWindow;
  return Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
}

const TOKEN_COMPACT_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 0,
});

export function formatCompactTokenCount(value: number): string {
  return TOKEN_COMPACT_FORMATTER.format(
    Math.max(0, Math.round(value)),
  ).toLowerCase();
}

type ContextWindowTone = "default" | "warning" | "destructive";

export function contextWindowTone(usedPercent: number): ContextWindowTone {
  if (usedPercent >= 90) return "destructive";
  if (usedPercent >= 75) return "warning";
  return "default";
}

/** Human model label for the fallback card (web `modelLabel`). */
export function modelFallbackLabel(model: string): string {
  const parts = model
    .replace(/^(?:anthropic[-/])?claude-/i, "")
    .split("-")
    .filter(Boolean);
  const versionStart = parts.findIndex((part) => /^\d+$/.test(part));
  const nameParts = versionStart === -1 ? parts : parts.slice(0, versionStart);
  const versionParts = versionStart === -1 ? [] : parts.slice(versionStart);
  const name = nameParts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const [major, minor, ...qualifiers] = versionParts;
  const version = major
    ? [minor ? `${major}.${minor}` : major, ...qualifiers].join(" ")
    : "";
  return [name, version].filter(Boolean).join(" ") || model;
}
