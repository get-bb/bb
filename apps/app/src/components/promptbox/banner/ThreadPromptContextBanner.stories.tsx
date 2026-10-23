import { useState, type ReactNode } from "react";
import type { WorkspaceFileStatus, WorkspaceStatus } from "@bb/domain";
import { PROMPT_STACK_TRACK_CLASS } from "@/components/promptbox/banner/PromptStackCard";
import {
  ThreadChildThreadsBanner,
  ThreadPromptContextBanner,
  type ContextBannerMergeBaseConfig,
  type ThreadPromptArchivedSection,
  type ThreadPromptEnvironmentGoneSection,
  type ThreadPromptParentThreadSection,
  type ThreadPromptChildThreadsSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import {
  selectWorkspaceChangedFilesSection,
  type WorkspaceChangedFilesSection,
} from "@/components/workspace/workspace-change-summary";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "promptbox/banner/Context Banner",
};

const noop = () => {};

type PromptStageSize = "desktop" | "mobile";

function PromptStage({
  children,
  size,
}: {
  children: ReactNode;
  size: PromptStageSize;
}) {
  return (
    <div
      data-promptbox-shell=""
      className={size === "desktop" ? "min-w-0 flex-1" : "w-[20rem] shrink-0"}
    >
      <div className={`grid gap-2 ${PROMPT_STACK_TRACK_CLASS}`}>{children}</div>
    </div>
  );
}

const promptboxBannerFiles: WorkspaceFileStatus[] = [
  {
    path: "apps/app/src/components/promptbox/FollowUpPromptBox.tsx",
    status: "M",
    insertions: 42,
    deletions: 18,
  },
  {
    path: "apps/app/src/components/promptbox/banner/PromptStackCard.tsx",
    status: "A",
    insertions: 96,
    deletions: 0,
  },
  {
    path: "apps/app/src/components/promptbox/banner/QueuedMessagesList.tsx",
    status: "A",
    insertions: 74,
    deletions: 0,
  },
  {
    path: "apps/app/src/components/promptbox/banner/ThreadPromptContextBanner.tsx",
    status: "A",
    insertions: 88,
    deletions: 0,
  },
  {
    path: "apps/app/src/views/ThreadDetailPromptArea.tsx",
    status: "M",
    insertions: 12,
    deletions: 29,
  },
];

const dirtyUncommittedStatus: WorkspaceStatus = {
  workingTree: {
    state: "dirty_uncommitted",
    hasUncommittedChanges: true,
    files: promptboxBannerFiles,
    insertions: 312,
    deletions: 47,
    lineStatsComplete: true,
    fileCount: promptboxBannerFiles.length,
  },
  branch: {
    currentBranch: "bb/promptbox-stories",
    defaultBranch: "main",
  },
  checkout: {
    kind: "branch",
    branchName: "bb/promptbox-stories",
    headSha: null,
  },
  mergeBase: null,
};

const dirtyUncommittedManyFiles: WorkspaceFileStatus[] = [
  {
    path: "apps/app/src/components/promptbox/FollowUpPromptBox.tsx",
    status: "M",
    insertions: 42,
    deletions: 18,
  },
  {
    path: "apps/app/src/components/promptbox/banner/PromptStackCard.tsx",
    status: "A",
    insertions: 96,
    deletions: 0,
  },
  {
    path: "apps/app/src/components/promptbox/banner/QueuedMessagesList.tsx",
    status: "A",
    insertions: 74,
    deletions: 0,
  },
  {
    path: "apps/app/src/components/promptbox/banner/ThreadPromptContextBanner.tsx",
    status: "A",
    insertions: 88,
    deletions: 0,
  },
  {
    path: "apps/app/src/components/promptbox/banner/ThreadPromptContextBanner.stories.tsx",
    status: "M",
    insertions: 21,
    deletions: 7,
  },
  {
    path: "apps/app/src/components/thread/WorkspaceChangesList.tsx",
    status: "M",
    insertions: 16,
    deletions: 4,
  },
  {
    path: "apps/app/src/components/workspace/workspace-change-summary.ts",
    status: "M",
    insertions: 8,
    deletions: 3,
  },
  {
    path: "apps/app/src/views/ThreadDetailPromptArea.tsx",
    status: "M",
    insertions: 12,
    deletions: 29,
  },
  {
    path: "apps/app/src/views/ThreadDetailSecondaryPanel.tsx",
    status: "M",
    insertions: 5,
    deletions: 5,
  },
  {
    path: "apps/app/src/hooks/useThreadPromptContext.ts",
    status: "M",
    insertions: 32,
    deletions: 14,
  },
  {
    path: "apps/app/src/lib/format-workspace-status.ts",
    status: "A",
    insertions: 24,
    deletions: 0,
  },
  {
    path: "apps/app/src/styles/promptbox.css",
    status: "M",
    insertions: 3,
    deletions: 1,
  },
  {
    path: "apps/app/.ladle/story-card.tsx",
    status: "M",
    insertions: 1,
    deletions: 1,
  },
  {
    path: "packages/domain/src/workspace.ts",
    status: "M",
    insertions: 10,
    deletions: 2,
  },
  {
    path: "packages/domain/src/thread.ts",
    status: "M",
    insertions: 6,
    deletions: 0,
  },
  {
    path: "apps/server/src/routes/threads.ts",
    status: "M",
    insertions: 18,
    deletions: 11,
  },
  {
    path: "apps/server/src/lifecycle/thread-prompt.ts",
    status: "M",
    insertions: 9,
    deletions: 4,
  },
  {
    path: "apps/host/src/workspace/status.ts",
    status: "M",
    insertions: 22,
    deletions: 8,
  },
  {
    path: "apps/app/src/components/promptbox/banner/__snapshots__/ThreadPromptContextBanner.test.tsx.snap",
    status: "D",
    insertions: 0,
    deletions: 187,
  },
];

const dirtyUncommittedManyStatus: WorkspaceStatus = {
  workingTree: {
    state: "dirty_uncommitted",
    hasUncommittedChanges: true,
    files: dirtyUncommittedManyFiles,
    insertions: 1284,
    deletions: 312,
    lineStatsComplete: true,
    fileCount: dirtyUncommittedManyFiles.length,
  },
  branch: {
    currentBranch: "bb/promptbox-stories",
    defaultBranch: "main",
  },
  checkout: {
    kind: "branch",
    branchName: "bb/promptbox-stories",
    headSha: null,
  },
  mergeBase: null,
};

const untrackedOnlyStatus: WorkspaceStatus = {
  workingTree: {
    state: "untracked",
    hasUncommittedChanges: false,
    files: [
      {
        path: "apps/app/notes/triage.md",
        status: "??",
        insertions: null,
        deletions: null,
      },
      {
        path: "apps/app/scripts/dev-bb-worktree.sh",
        status: "??",
        insertions: null,
        deletions: null,
      },
    ],
    insertions: 0,
    deletions: 0,
    lineStatsComplete: false,
    fileCount: 2,
  },
  branch: {
    currentBranch: "bb/promptbox-stories",
    defaultBranch: "main",
  },
  checkout: {
    kind: "branch",
    branchName: "bb/promptbox-stories",
    headSha: null,
  },
  mergeBase: null,
};

const committedUnmergedStatus: WorkspaceStatus = {
  workingTree: {
    state: "clean",
    hasUncommittedChanges: false,
    files: [],
    insertions: 0,
    deletions: 0,
    lineStatsComplete: true,
    fileCount: 0,
  },
  branch: {
    currentBranch: "bb/promptbox-stories",
    defaultBranch: "main",
  },
  checkout: {
    kind: "branch",
    branchName: "bb/promptbox-stories",
    headSha: null,
  },
  mergeBase: {
    mergeBaseBranch: "main",
    baseRef: "abc123",
    aheadCount: 4,
    behindCount: 0,
    squashMergeCheckComplete: true,
    hasCommittedUnmergedChanges: true,
    commits: [],
    files: promptboxBannerFiles.slice(0, 3),
    insertions: 128,
    deletions: 24,
    lineStatsComplete: true,
    fileCount: 3,
  },
};

function sectionFor(status: WorkspaceStatus): WorkspaceChangedFilesSection {
  const section = selectWorkspaceChangedFilesSection(status);
  if (!section) throw new Error("fixture should produce a section");
  return section;
}

const uncommittedSection = sectionFor(dirtyUncommittedStatus);
const uncommittedManySection = sectionFor(dirtyUncommittedManyStatus);
const untrackedSection = sectionFor(untrackedOnlyStatus);
const committedSection = sectionFor(committedUnmergedStatus);
const committedManyFiles: WorkspaceFileStatus[] = Array.from(
  { length: 72 },
  (_, index) => ({
    path: `apps/app/src/committed-fixture-${index + 1}.tsx`,
    status: "M",
    insertions: 10,
    deletions: 2,
  }),
);
const committedManySection: WorkspaceChangedFilesSection = {
  ...committedSection,
  files: committedManyFiles,
  stats: {
    ...committedSection.stats,
    files: committedManyFiles,
    insertions: 720,
    deletions: 144,
  },
};

const featureBranchMergeBase: ContextBannerMergeBaseConfig = {
  branch: "main",
  options: ["main", "develop", "release/2026-05"] as const,
  onChange: noop,
};

const parentThreadFixture: ThreadPromptParentThreadSection = {
  parentThreadTitle: "Parent thread",
  href: "/projects/proj-1/threads/thr_parent_demo",
  relationship: "parent",
};

const forkedFromFixture: ThreadPromptParentThreadSection = {
  parentThreadTitle: "Investigate flaky test",
  href: "/projects/proj-1/threads/thr_source_demo",
  relationship: "fork",
};

const childThreadsFixture: ThreadPromptChildThreadsSection = {
  items: [
    {
      id: "thr_a",
      title: "Investigate Safari auth flake on staging",
      href: "/projects/proj-1/threads/thr_a",
      hasPendingInteraction: false,
    },
    {
      id: "thr_b",
      title: "Review PR #4521 reviewer comments",
      href: "/projects/proj-1/threads/thr_b",
      hasPendingInteraction: false,
    },
    {
      id: "thr_c",
      title: "Refactor email pipeline retry logic",
      href: "/projects/proj-1/threads/thr_c",
      hasPendingInteraction: false,
    },
    {
      id: "thr_d",
      title: "Backfill workspace-status invalidation cache",
      href: "/projects/proj-1/threads/thr_d",
      hasPendingInteraction: false,
    },
  ],
  pendingInteractions: [],
};

const childThreadsPendingFixture: ThreadPromptChildThreadsSection = {
  items: [
    {
      id: "thr_blocked",
      title: "Install workspace tools",
      href: "/projects/proj-1/threads/thr_blocked",
      hasPendingInteraction: true,
    },
  ],
  pendingInteractions: [
    childQuestionFixture(
      "thr_blocked",
      "Install workspace tools",
      "Which color should the QA badge use?",
      [],
      1,
    ),
  ],
};

function childQuestionFixture(
  childThreadId: string,
  childTitle: string,
  prompt: string,
  options: readonly { label: string; description: string }[],
  createdAt: number,
) {
  return {
    childThreadId,
    childTitle,
    href: `/projects/proj-1/threads/${childThreadId}`,
    interaction: {
      id: `pint_${childThreadId}`,
      threadId: childThreadId,
      turnId: "turn_story",
      providerId: "claude-code",
      providerThreadId: "provider-thread-story",
      providerRequestId: `request-${childThreadId}`,
      status: "pending" as const,
      statusReason: null,
      createdAt,
      resolvedAt: null,
      resolution: null,
      payload: {
        kind: "user_question" as const,
        questions: [
          {
            id: "choice",
            prompt,
            multiSelect: false,
            allowFreeText: true,
            options: options.map((option) => ({
              value: option.label.toLowerCase(),
              ...option,
            })),
          },
        ],
      },
    },
  };
}

const childThreadsQuestionsFixture: ThreadPromptChildThreadsSection = {
  items: [
    {
      id: "thr_size",
      title: "Pick a size",
      href: "/projects/proj-1/threads/thr_size",
      hasPendingInteraction: true,
    },
    {
      id: "thr_shape",
      title: "Pick a shape",
      href: "/projects/proj-1/threads/thr_shape",
      hasPendingInteraction: true,
    },
    {
      id: "thr_color",
      title: "Pick a color",
      href: "/projects/proj-1/threads/thr_color",
      hasPendingInteraction: true,
    },
    {
      id: "thr_working",
      title: "Investigate failing checks",
      href: "/projects/proj-1/threads/thr_working",
      hasPendingInteraction: false,
    },
  ],
  pendingInteractions: [
    childQuestionFixture(
      "thr_size",
      "Pick a size",
      "Which size?",
      [
        { label: "Small", description: "Proceed with a small-scale change." },
        { label: "Large", description: "Proceed with a large-scale change." },
      ],
      3,
    ),
    childQuestionFixture(
      "thr_shape",
      "Pick a shape",
      "Which shape?",
      [
        { label: "Circle", description: "Select the circle shape." },
        { label: "Square", description: "Select the square shape." },
      ],
      2,
    ),
    childQuestionFixture(
      "thr_color",
      "Pick a color",
      "Which color?",
      [
        { label: "Red", description: "Choose red." },
        { label: "Blue", description: "Choose blue." },
      ],
      1,
    ),
  ],
};

const childThreadsLargeFixture: ThreadPromptChildThreadsSection = {
  items: Array.from({ length: 12 }, (_, i) => ({
    id: `thr_large_${i}`,
    title: `Child work item ${i + 1} that is busy doing thing-${i}`,
    href: `/projects/proj-1/threads/thr_large_${i}`,
    hasPendingInteraction: i === 1,
  })),
  pendingInteractions: [],
};

interface RowConfig {
  section?: WorkspaceChangedFilesSection;
  mergeBase?: ContextBannerMergeBaseConfig | null;
  archived?: ThreadPromptArchivedSection | null;
  environmentGone?: ThreadPromptEnvironmentGoneSection | null;
  parentThread?: ThreadPromptParentThreadSection | null;
  childThreads?: ThreadPromptChildThreadsSection | null;
  initiallyExpandedSection?: string | null;
  initiallyChildThreadsExpanded?: boolean;
}

function ContextBannerPreview({
  section,
  mergeBase = featureBranchMergeBase,
  archived = null,
  environmentGone = null,
  parentThread = null,
  childThreads = null,
  initiallyExpandedSection = null,
  initiallyChildThreadsExpanded = false,
  size,
}: RowConfig & { size: PromptStageSize }) {
  const [expandedSection, setExpandedSection] = useState<string | null>(
    initiallyExpandedSection,
  );
  const [isChildThreadsExpanded, setIsChildThreadsExpanded] = useState(
    initiallyChildThreadsExpanded,
  );
  return (
    <PromptStage size={size}>
      <ThreadChildThreadsBanner
        childThreads={archived || environmentGone ? null : childThreads}
        isExpanded={isChildThreadsExpanded}
        onExpandedChange={setIsChildThreadsExpanded}
      />
      <ThreadPromptContextBanner
        input={{
          threadId: "thr_story",
          projectId: "proj_story",
          environment: null,
        }}
        core={{
          git: section
            ? {
                changedFiles: section,
                mergeBase,
                onPromptBannerFileClick: noop,
              }
            : null,
          gitPending: false,
          parentThread,
        }}
        archivedSection={archived}
        environmentGoneSection={environmentGone}
        expandedSegment={expandedSection}
        onToggleSegment={(next) =>
          setExpandedSection((previous) => (previous === next ? null : next))
        }
      />
    </PromptStage>
  );
}

function Row(props: RowConfig) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 overflow-x-auto">
      <ContextBannerPreview {...props} size="desktop" />
      <ContextBannerPreview {...props} size="mobile" />
    </div>
  );
}

const archivedFixture: ThreadPromptArchivedSection = {
  archivedAt: 1_731_456_000_000,
  onUnarchive: noop,
};

const destroyedEnvironmentFixture: ThreadPromptEnvironmentGoneSection = {
  status: "destroyed",
};

const restorableEnvironmentFixture: ThreadPromptEnvironmentGoneSection = {
  status: "destroyed",
  onRestore: noop,
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="git — merge-base picker"
        hint="git is the only segment, so the merge-base action is pinned to the far right on wide rows and hidden at the compact breakpoint."
      >
        <Row section={committedSection} />
      </StoryRow>
      <StoryRow
        label="archived thread"
        hint="archive icon + 'Thread is archived' with a filled unarchive action pinned to the far right"
      >
        <Row archived={archivedFixture} mergeBase={null} />
      </StoryRow>
      <StoryRow
        label="archived + child thread"
        hint="archived row plus parent context; action is hidden because archived is not the only segment"
      >
        <Row
          archived={archivedFixture}
          parentThread={parentThreadFixture}
          mergeBase={null}
        />
      </StoryRow>
      <StoryRow
        label="archived thread (with other context, all suppressed)"
        hint="archived takes precedence — git/child work are hidden, so the unarchive action remains available"
      >
        <Row
          archived={archivedFixture}
          section={uncommittedSection}
          childThreads={childThreadsFixture}
          mergeBase={null}
        />
      </StoryRow>
      <StoryRow
        label="environment archived"
        hint="archived-environment row suppresses git/childThreads"
      >
        <Row environmentGone={destroyedEnvironmentFixture} mergeBase={null} />
      </StoryRow>
      <StoryRow
        label="environment archived (restorable)"
        hint="the workspace can be rebuilt on its branch, so a filled restore action is pinned to the far right"
      >
        <Row environmentGone={restorableEnvironmentFixture} mergeBase={null} />
      </StoryRow>
      <StoryRow
        label="environment archived + child thread"
        hint="archived-environment row plus parent context"
      >
        <Row
          environmentGone={destroyedEnvironmentFixture}
          parentThread={parentThreadFixture}
          mergeBase={null}
        />
      </StoryRow>
      <StoryRow
        label="environment archived (with other context, all suppressed)"
        hint="archived environment takes precedence — git/child work are hidden"
      >
        <Row
          environmentGone={destroyedEnvironmentFixture}
          section={uncommittedSection}
          childThreads={childThreadsFixture}
          mergeBase={null}
        />
      </StoryRow>
      <StoryRow label="child thread (alone)" hint="inline parent link">
        <Row parentThread={parentThreadFixture} mergeBase={null} />
      </StoryRow>
      <StoryRow
        label="forked thread (alone)"
        hint={'renders "Forked from …" instead of "Parent …"'}
      >
        <Row parentThread={forkedFromFixture} mergeBase={null} />
      </StoryRow>
      <StoryRow
        label="thread with a child thread waiting for approval"
        hint="the banner expands on its own to show it"
      >
        <Row childThreads={childThreadsPendingFixture} mergeBase={null} />
      </StoryRow>
      <StoryRow
        label="answer child questions in the banner"
        hint="rows read child: question; open one from a row, ‹ Active child threads or Esc returns, ‹ › steps through waiting questions"
      >
        <Row childThreads={childThreadsQuestionsFixture} mergeBase={null} />
      </StoryRow>
      <StoryRow
        label="thread with active child threads (collapsed)"
        hint="icon, label, and total count; click to list every child thread"
      >
        <Row childThreads={childThreadsFixture} mergeBase={null} />
      </StoryRow>
      <StoryRow
        label="active child + uncommitted"
        hint="long child titles stay within the shared stack"
      >
        <Row childThreads={childThreadsFixture} section={uncommittedSection} />
      </StoryRow>
      <StoryRow
        label="parent thread with many children (scrollable)"
        hint="max-h-40 caps the list; rest scrolls"
      >
        <Row
          childThreads={childThreadsLargeFixture}
          mergeBase={null}
          initiallyChildThreadsExpanded
        />
      </StoryRow>
      <StoryRow
        label="child thread + uncommitted"
        hint="with other context, the parent-thread segment collapses to an icon-only toggle"
      >
        <Row section={uncommittedSection} parentThread={parentThreadFixture} />
      </StoryRow>
      <StoryRow
        label="uncommitted (collapsed)"
        hint="working tree has 5 modified/added files; chevron toggles WorkspaceChangesList"
      >
        <Row section={uncommittedSection} />
      </StoryRow>
      <StoryRow
        label="uncommitted (expanded)"
        hint="expanded change list visible inside the same card; long lists scroll within max-h-32"
      >
        <Row
          section={uncommittedManySection}
          initiallyExpandedSection="bb--core/changed-files"
        />
      </StoryRow>
      <StoryRow
        label="untracked only"
        hint='workingTree.state = "untracked" with intentionally unavailable line stats'
      >
        <Row
          section={untrackedSection}
          initiallyExpandedSection="bb--core/changed-files"
        />
      </StoryRow>
      <StoryRow
        label="committed unmerged"
        hint="working tree clean; mergeBase has committed files"
      >
        <Row section={committedSection} />
      </StoryRow>
      <StoryRow
        label="many committed files"
        hint="a long committed summary keeps the merge-base action in the row"
      >
        <Row section={committedManySection} />
      </StoryRow>
      <StoryRow
        label="on default branch"
        hint="mergeBase=null hides the picker (no comparison to make)"
      >
        <Row section={uncommittedSection} mergeBase={null} />
      </StoryRow>
    </StoryCard>
  );
}

export const MachineRemovalHistory = () => (
  <StoryCard>
    <StoryRow label="Machine removed">
      <Row environmentGone={{ status: "removed" }} mergeBase={null} />
    </StoryRow>
    <StoryRow label="Removal in progress">
      <Row environmentGone={{ status: "removing" }} mergeBase={null} />
    </StoryRow>
    <StoryRow label="Cleanup failed">
      <Row environmentGone={{ status: "cleanup-failed" }} mergeBase={null} />
    </StoryRow>
  </StoryCard>
);
