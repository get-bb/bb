import type {
  ThreadTimelineActivePromptMode,
  ThreadTimelineGoal,
  ThreadTimelinePendingTodos,
} from "@bb/domain";

/**
 * The prompt chip row's user-state inputs (plan mode, goal, to-dos) for the
 * Interactions showcase; the live work rows come from
 * `buildPromptChipWorkFixtures` in work-row-fixtures.
 */
export function buildPromptChipStateFixtures(): {
  activePromptMode: ThreadTimelineActivePromptMode;
  goal: ThreadTimelineGoal;
  pendingTodos: ThreadTimelinePendingTodos;
} {
  const now = Date.now();
  return {
    activePromptMode: {
      mode: "plan",
      providerId: "claude-code",
      prompt: "Plan the migration to the new banner layout before editing.",
    },
    goal: {
      sourceSeq: 10,
      updatedAt: now,
      objective: "Fix every bug",
      status: "active",
      tokenBudget: 2_000_000,
      tokensUsed: 812_000,
      timeUsedSeconds: 47 * 60,
    },
    pendingTodos: {
      sourceSeq: 11,
      updatedAt: now,
      items: [
        { id: "t1", text: "Triage the open issues", status: "completed" },
        { id: "t2", text: "Launch the worker pool", status: "completed" },
        { id: "t3", text: "Rebase worker branches", status: "in_progress" },
        { id: "t4", text: "Review the first PR", status: "pending" },
        { id: "t5", text: "Close superseded issues", status: "pending" },
      ],
    },
  };
}
