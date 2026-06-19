import { useState } from "react";
import type { ThreadPullRequest } from "@bb/domain";
import {
  ThreadPromptContextBanner,
  type ThreadPromptContextBannerExpandedSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { PullRequestStatusPill } from "@/components/pull-request/PullRequestStatusPill";
import type { WorkspaceChangedFilesSection } from "@/components/workspace/workspace-change-summary";

const failingPullRequest: ThreadPullRequest = {
  number: 260,
  title: "Refine prompt pills and PR badge layout",
  url: "https://github.com/ymichael/bb/pull/260",
  state: "open",
  baseRefName: "main",
  headRefName: "bb/take-over-and-archive-thr_6c3ueqzjz4",
  updatedAt: "2026-06-19T07:05:19Z",
  checks: {
    state: "failing",
    totalCount: 5,
    passedCount: 4,
    failedCount: 1,
    pendingCount: 0,
  },
  review: {
    state: "none",
    reviewRequestCount: 0,
  },
  mergeability: {
    state: "unknown",
    mergeStateStatus: null,
    mergeable: null,
  },
  attention: "checks_failed",
};

const changedFiles: WorkspaceChangedFilesSection = {
  kind: "committed",
  label: "Committed",
  files: [
    {
      path: "apps/app/src/components/pull-request/PullRequestStatusPill.tsx",
      status: "M",
      insertions: 2,
      deletions: 1,
    },
    {
      path: "apps/app/src/components/promptbox/banner/ThreadPromptContextBanner.tsx",
      status: "M",
      insertions: 4,
      deletions: 0,
    },
  ],
  mergeBaseRef: "origin/main",
  stats: {
    files: [
      {
        path: "apps/app/src/components/pull-request/PullRequestStatusPill.tsx",
        status: "M",
        insertions: 2,
        deletions: 1,
      },
      {
        path: "apps/app/src/components/promptbox/banner/ThreadPromptContextBanner.tsx",
        status: "M",
        insertions: 4,
        deletions: 0,
      },
    ],
    insertions: 6,
    deletions: 1,
  },
};

function PromptBannerFixture({
  width,
  withGit = false,
}: {
  width: number;
  withGit?: boolean;
}) {
  const [expandedSection, setExpandedSection] =
    useState<ThreadPromptContextBannerExpandedSection | null>(null);

  return (
    <div
      data-promptbox-shell=""
      className="min-w-0"
      style={{ width: `${width}px` }}
    >
      <ThreadPromptContextBanner
        gitSection={
          withGit
            ? {
                changedFiles,
                mergeBase: null,
                onPromptBannerFileClick: () => {},
              }
            : null
        }
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{ pullRequest: failingPullRequest }}
        expandedSection={expandedSection}
        onToggleSection={(section) =>
          setExpandedSection((current) =>
            current === section ? null : section,
          )
        }
      />
    </div>
  );
}

function WidthFixture({
  label,
  width,
  withGit = false,
}: {
  label: string;
  width: number;
  withGit?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="overflow-hidden rounded border border-border bg-background p-2">
        <PromptBannerFixture width={width} withGit={withGit} />
      </div>
    </div>
  );
}

export function PrBadgeOverlapFixtureView() {
  const [resizableWidth, setResizableWidth] = useState(112);

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-background px-6 py-5 text-foreground">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
        <header className="space-y-1">
          <h1 className="text-base font-medium">PR badge overlap fixture</h1>
          <p className="text-sm text-muted-foreground">
            Prompt banner widths that keep the GitHub checks icon and PR label
            under pressure.
          </p>
        </header>

        <section className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <label htmlFor="pr-badge-width">Width</label>
            <input
              id="pr-badge-width"
              type="range"
              min={72}
              max={260}
              value={resizableWidth}
              onChange={(event) =>
                setResizableWidth(Number(event.currentTarget.value))
              }
              className="w-56 accent-foreground"
            />
            <span className="w-12 tabular-nums">{resizableWidth}px</span>
          </div>
          <div className="overflow-hidden rounded border border-border bg-background p-2">
            <PromptBannerFixture width={resizableWidth} />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <WidthFixture label="single PR, 88px" width={88} />
          <WidthFixture label="single PR, 112px" width={112} />
          <WidthFixture label="PR + git, 136px" width={136} withGit />
          <WidthFixture label="single PR, 72px" width={72} />
        </section>

        <section className="space-y-2">
          <div className="text-xs text-muted-foreground">direct pill</div>
          <div className="inline-flex max-w-[5.5rem] items-center gap-1 overflow-hidden rounded border border-border bg-background p-1">
            <PullRequestStatusPill pullRequest={failingPullRequest} />
            <span className="shrink-0 text-xs text-muted-foreground">
              PR #{failingPullRequest.number}
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}
