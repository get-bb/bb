import type {
  ThreadTimelineActivePromptMode,
  ThreadTimelineGoal,
  ThreadTimelineModelFallback,
  ThreadTimelinePendingTodos,
  WorkspaceFileStatus,
} from "@bb/domain";
import type { ThreadContextChipsProps } from "../thread/context/ThreadContextChips";
import { DEV_THREAD_ID } from "./interaction-fixtures";

/**
 * The prompt chip row's user-state inputs (plan mode, goal, to-dos, model
 * fallback) for the Interactions showcase; the live work rows come from
 * `buildPromptChipWorkFixtures` in work-row-fixtures.
 */
export function buildPromptChipStateFixtures(): {
  activePromptMode: ThreadTimelineActivePromptMode;
  goal: ThreadTimelineGoal;
  pendingTodos: ThreadTimelinePendingTodos;
  modelFallback: ThreadTimelineModelFallback;
} {
  const now = Date.now();
  return {
    modelFallback: {
      sourceSeq: 12,
      detectedAt: now,
      originalModel: "claude-opus-5",
      fallbackModel: "claude-sonnet-5",
      reason: "provider",
      message: "The provider fell back to a smaller model.",
    },
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

/**
 * The context chips' inputs (changed files, pull request, fork source,
 * active children) for the Interactions showcase; the callbacks toast.
 */
export function buildPromptChipContextFixture(
  notify: (message: string) => void,
): ThreadContextChipsProps {
  const files: WorkspaceFileStatus[] = [
    {
      path: "apps/mobile/src/ui/ShimmerIcon.tsx",
      status: "A",
      insertions: 120,
      deletions: 0,
    },
    {
      path: "apps/mobile/src/screens/thread/cards/PromptChip.tsx",
      status: "M",
      insertions: 48,
      deletions: 12,
    },
    {
      path: "apps/mobile/src/screens/thread/banner/ThreadContextBanner.tsx",
      status: "D",
      insertions: 0,
      deletions: 412,
    },
  ];
  return {
    layout: {
      kind: "live",
      parent: {
        threadId: `${DEV_THREAD_ID}-source`,
        title: "Ship the shimmering chip row",
        relationship: "fork",
      },
      children: {
        items: [
          {
            id: `${DEV_THREAD_ID}-child-9`,
            title: "Port the diff sheet",
            hasPendingInteraction: false,
          },
        ],
        pendingCount: 0,
        label: "1 active child thread",
        primary: {
          id: `${DEV_THREAD_ID}-child-9`,
          title: "Port the diff sheet",
          hasPendingInteraction: false,
        },
      },
      pullRequest: {
        pullRequest: {
          number: 2172,
          title: "Replace the live dot with a shimmering glyph",
          state: "open",
          url: "https://github.com/get-bb/bb/pull/2172",
          baseRefName: "main",
          headRefName: "bb/replace-dot-with-shimmer",
          updatedAt: "2026-08-21T00:00:00.000Z",
          checks: {
            state: "passing",
            totalCount: 3,
            passedCount: 3,
            failedCount: 0,
            pendingCount: 0,
          },
          review: { state: "approved", reviewRequestCount: 0 },
          mergeability: {
            state: "mergeable",
            mergeStateStatus: null,
            mergeable: null,
          },
          attention: "none",
        },
      },
      git: {
        changedFiles: {
          kind: "committed",
          label: "Committed",
          files,
          mergeBaseRef: "origin/main",
          stats: {
            insertions: 168,
            deletions: 424,
            lineStatsComplete: true,
            files,
          },
        },
      },
    },
    onOpenThread: (threadId) => notify(`Open thread ${threadId}`),
    onPressFile: (file) => notify(`Open diff at ${file.path}`),
    onOpenDiff: () => notify("Open diff"),
    onOpenPullRequest: (url) => notify(`Open ${url}`),
    mergeBase: {
      branch: "origin/main",
      onPress: () => notify("Pick merge base"),
    },
    pullRequestActions: {
      isPending: false,
      onMarkReady: () => notify("Mark ready"),
      onMerge: (method) => notify(`Merge (${method})`),
      onConvertToDraft: () => notify("Convert to draft"),
    },
    unarchive: null,
  };
}
