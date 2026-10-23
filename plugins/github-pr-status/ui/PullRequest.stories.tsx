import type { ReactNode } from "react";
import {
  CONTEXT_CARD_CLASS,
  CONTEXT_CARD_INSET_CLASS,
} from "@bb/shared-ui/chrome-style-tokens";
import { cn } from "@bb/shared-ui/lib/utils";
import type { ExperimentalThreadContextSegmentReference } from "@get-bb/plugin-sdk/app";
import type { PullRequest } from "../contract";
import {
  PullRequestActionButtons,
  PullRequestLink,
} from "./PullRequestContextSegment";
import { PullRequestRow } from "./PullRequestInfoRow";

export default {
  title: "plugins/GitHub PR Status",
};

const noop = () => {};

function makePullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 128,
    title: "Show the branch's GitHub pull request in the Info tab",
    state: "open",
    url: "https://github.com/acme/bb/pull/128",
    baseRefName: "main",
    headRefName: "bb/pr-info-panel",
    updatedAt: "2026-06-16T12:30:00Z",
    autoMerge: false,
    inMergeQueue: false,
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
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    },
    attention: "ready_to_merge",
    ...overrides,
  };
}

function StoryList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 p-4">{children}</div>;
}

function StoryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs text-muted-foreground">{label}</h3>
      {children}
    </section>
  );
}

function RowStage({ children }: { children: ReactNode }) {
  return (
    <dl className="w-full max-w-[480px] min-w-0 rounded-md border border-border bg-background px-4 py-3">
      {children}
    </dl>
  );
}

const SELF = {
  key: "bb--github-pr-status/pull-request",
  pluginId: "bb--github-pr-status",
};
const CHANGED_FILES = { key: "bb--git/changed-files", pluginId: "bb--git" };
const PARENT = { key: "bb--core/parent-thread", pluginId: "bb--core" };

function SegmentStage({
  pullRequest,
  segments,
  width,
}: {
  pullRequest: PullRequest;
  segments: readonly ExperimentalThreadContextSegmentReference[];
  width: "desktop" | "mobile";
}) {
  return (
    <div
      data-promptbox-shell=""
      className={width === "desktop" ? "w-[42rem]" : "w-[20rem]"}
    >
      <div className={cn(CONTEXT_CARD_CLASS, "overflow-hidden")}>
        <div
          className={cn(
            "flex items-center gap-0.5 text-xs text-muted-foreground",
            CONTEXT_CARD_INSET_CLASS,
          )}
        >
          {segments.some((segment) => segment.key === PARENT.key) ? (
            <span className="px-2 py-1">Parent</span>
          ) : null}
          <PullRequestLink pullRequest={pullRequest} segments={segments} />
          {segments.some((segment) => segment.key === CHANGED_FILES.key) ? (
            <span className="flex-1 px-2 py-1">Uncommitted · 1 file</span>
          ) : null}
          <PullRequestActionButtons
            pullRequest={pullRequest}
            isPending={false}
            mergeMethod="squash"
            onMarkReady={noop}
            onMerge={noop}
            onConvertToDraft={noop}
          />
        </div>
      </div>
    </div>
  );
}

function SegmentRow({
  pullRequest,
  segments,
}: {
  pullRequest: PullRequest;
  segments: readonly ExperimentalThreadContextSegmentReference[];
}) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 overflow-x-auto">
      <SegmentStage
        pullRequest={pullRequest}
        segments={segments}
        width="desktop"
      />
      <SegmentStage
        pullRequest={pullRequest}
        segments={segments}
        width="mobile"
      />
    </div>
  );
}

export function ContextSegment() {
  const open = makePullRequest();
  const draft = makePullRequest({ state: "draft", attention: "draft" });
  const queued = makePullRequest({
    autoMerge: true,
    inMergeQueue: true,
    attention: "queued",
  });
  const failing = makePullRequest({
    checks: {
      state: "failing",
      totalCount: 3,
      passedCount: 2,
      failedCount: 1,
      pendingCount: 0,
    },
    mergeability: {
      state: "blocked",
      mergeStateStatus: "BLOCKED",
      mergeable: "MERGEABLE",
    },
    attention: "checks_failed",
  });
  const closed = makePullRequest({ state: "closed", attention: "closed" });
  return (
    <StoryList>
      <StoryRow label="alone, open and mergeable">
        <SegmentRow pullRequest={open} segments={[SELF]} />
      </StoryRow>
      <StoryRow label="alone, draft">
        <SegmentRow pullRequest={draft} segments={[SELF]} />
      </StoryRow>
      <StoryRow label="alone, queued with auto-merge">
        <SegmentRow pullRequest={queued} segments={[SELF]} />
      </StoryRow>
      <StoryRow label="alone, checks failing">
        <SegmentRow pullRequest={failing} segments={[SELF]} />
      </StoryRow>
      <StoryRow label="alone, closed">
        <SegmentRow pullRequest={closed} segments={[SELF]} />
      </StoryRow>
      <StoryRow label="beside changed files">
        <SegmentRow pullRequest={open} segments={[SELF, CHANGED_FILES]} />
      </StoryRow>
      <StoryRow label="beside a parent thread">
        <SegmentRow pullRequest={open} segments={[PARENT, SELF]} />
      </StoryRow>
      <StoryRow label="parent, pull request and changed files">
        <SegmentRow
          pullRequest={queued}
          segments={[PARENT, SELF, CHANGED_FILES]}
        />
      </StoryRow>
    </StoryList>
  );
}

export function InfoRow() {
  const readyPullRequest = makePullRequest();
  const passingPullRequest = makePullRequest({
    mergeability: {
      state: "unknown",
      mergeStateStatus: "UNKNOWN",
      mergeable: "UNKNOWN",
    },
    attention: "none",
  });
  const noChecksPullRequest = makePullRequest({
    checks: {
      state: "no_checks",
      totalCount: 0,
      passedCount: 0,
      failedCount: 0,
      pendingCount: 0,
    },
    review: {
      state: "none",
      reviewRequestCount: 0,
    },
    attention: "none",
  });
  const unknownChecksPullRequest = makePullRequest({
    checks: {
      state: "unknown",
      totalCount: 1,
      passedCount: 0,
      failedCount: 0,
      pendingCount: 0,
    },
    review: {
      state: "none",
      reviewRequestCount: 0,
    },
    mergeability: {
      state: "unknown",
      mergeStateStatus: "UNKNOWN",
      mergeable: "UNKNOWN",
    },
    attention: "none",
  });
  const failingPullRequest = makePullRequest({
    checks: {
      state: "failing",
      totalCount: 3,
      passedCount: 2,
      failedCount: 1,
      pendingCount: 0,
    },
    attention: "checks_failed",
  });
  const pendingPullRequest = makePullRequest({
    checks: {
      state: "pending",
      totalCount: 3,
      passedCount: 2,
      failedCount: 0,
      pendingCount: 1,
    },
    attention: "checks_pending",
  });
  const changesRequestedPullRequest = makePullRequest({
    review: {
      state: "changes_requested",
      reviewRequestCount: 0,
    },
    attention: "changes_requested",
  });
  const reviewRequestedPullRequest = makePullRequest({
    review: {
      state: "review_requested",
      reviewRequestCount: 2,
    },
    attention: "review_requested",
  });
  const conflictsPullRequest = makePullRequest({
    mergeability: {
      state: "conflicts",
      mergeStateStatus: "DIRTY",
      mergeable: "CONFLICTING",
    },
    attention: "conflicts",
  });
  const blockedPullRequest = makePullRequest({
    mergeability: {
      state: "blocked",
      mergeStateStatus: "BLOCKED",
      mergeable: "UNKNOWN",
    },
    attention: "blocked",
  });
  const draftMergeability = {
    state: "draft",
    mergeStateStatus: "DRAFT",
    mergeable: "UNKNOWN",
  } as const;
  const draftPassingPullRequest = makePullRequest({
    state: "draft",
    mergeability: draftMergeability,
    attention: "draft",
  });
  const draftFailingPullRequest = makePullRequest({
    state: "draft",
    checks: {
      state: "failing",
      totalCount: 3,
      passedCount: 2,
      failedCount: 1,
      pendingCount: 0,
    },
    mergeability: draftMergeability,
    attention: "checks_failed",
  });
  const draftNoChecksPullRequest = makePullRequest({
    state: "draft",
    checks: {
      state: "no_checks",
      totalCount: 0,
      passedCount: 0,
      failedCount: 0,
      pendingCount: 0,
    },
    mergeability: draftMergeability,
    attention: "draft",
  });
  const draftUnknownChecksPullRequest = makePullRequest({
    state: "draft",
    checks: {
      state: "unknown",
      totalCount: 1,
      passedCount: 0,
      failedCount: 0,
      pendingCount: 0,
    },
    mergeability: draftMergeability,
    attention: "draft",
  });
  const draftPullRequest = makePullRequest({
    state: "draft",
    checks: {
      state: "pending",
      totalCount: 3,
      passedCount: 2,
      failedCount: 0,
      pendingCount: 1,
    },
    mergeability: draftMergeability,
    attention: "draft",
  });
  const draftChangesRequestedPullRequest = makePullRequest({
    state: "draft",
    review: {
      state: "changes_requested",
      reviewRequestCount: 0,
    },
    mergeability: draftMergeability,
    attention: "changes_requested",
  });
  const mergedPullRequest = makePullRequest({
    state: "merged",
    attention: "merged",
  });
  const closedPullRequest = makePullRequest({
    state: "closed",
    attention: "closed",
  });
  return (
    <StoryList>
      <StoryRow label="open, ready to merge">
        <RowStage>
          <PullRequestRow pullRequest={readyPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="open, checks passing">
        <RowStage>
          <PullRequestRow pullRequest={passingPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="open, no checks">
        <RowStage>
          <PullRequestRow pullRequest={noChecksPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="open, checks unknown">
        <RowStage>
          <PullRequestRow pullRequest={unknownChecksPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="open, checks failing">
        <RowStage>
          <PullRequestRow pullRequest={failingPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="open, checks pending">
        <RowStage>
          <PullRequestRow pullRequest={pendingPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="open, changes requested">
        <RowStage>
          <PullRequestRow pullRequest={changesRequestedPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="open, review requested">
        <RowStage>
          <PullRequestRow pullRequest={reviewRequestedPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="open, conflicts">
        <RowStage>
          <PullRequestRow pullRequest={conflictsPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="open, blocked">
        <RowStage>
          <PullRequestRow pullRequest={blockedPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="draft, checks passing">
        <RowStage>
          <PullRequestRow pullRequest={draftPassingPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="draft, checks failing">
        <RowStage>
          <PullRequestRow pullRequest={draftFailingPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="draft, no checks">
        <RowStage>
          <PullRequestRow pullRequest={draftNoChecksPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="draft, checks unknown">
        <RowStage>
          <PullRequestRow pullRequest={draftUnknownChecksPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="draft, checks pending">
        <RowStage>
          <PullRequestRow pullRequest={draftPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="draft, changes requested">
        <RowStage>
          <PullRequestRow pullRequest={draftChangesRequestedPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="merged">
        <RowStage>
          <PullRequestRow pullRequest={mergedPullRequest} />
        </RowStage>
      </StoryRow>
      <StoryRow label="closed">
        <RowStage>
          <PullRequestRow pullRequest={closedPullRequest} />
        </RowStage>
      </StoryRow>
    </StoryList>
  );
}
