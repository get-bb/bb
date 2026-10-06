import type { ThreadPullRequest } from "@bb/domain";
import {
  BranchRow,
  GitStatusRow,
  MergeBaseRow,
  PullRequestRow,
  ThreadMetadataCard,
} from "./ThreadMetadataContent";
import {
  PanelStage,
  baseProps,
  makePullRequest,
  makeWorkspaceStatus,
} from "./ThreadMetadataContent.fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "right-panel/Info/Branch group prototype",
};

const workspaceStatus = makeWorkspaceStatus({
  branch: { currentBranch: "feat/sidebar-rail", defaultBranch: "main" },
  mergeBase: {
    mergeBaseBranch: "main",
    baseRef: "main",
    aheadCount: 7,
    behindCount: 0,
    hasCommittedUnmergedChanges: true,
    commits: [],
    insertions: 0,
    deletions: 0,
    lineStatsComplete: true,
    files: [],
  },
});

function BranchGroup({ pullRequest }: { pullRequest: ThreadPullRequest }) {
  return (
    <PanelStage>
      <ThreadMetadataCard>
        <div className="flex min-w-0 flex-col gap-1.5">
          <BranchRow workspaceStatus={workspaceStatus} />
          <MergeBaseRow {...baseProps} workspaceStatus={workspaceStatus} />
          <GitStatusRow
            thread={baseProps.thread}
            environment={baseProps.environment}
            workspaceStatus={workspaceStatus}
            workspaceStatusError={null}
          />
          <PullRequestRow pullRequest={pullRequest} />
        </div>
      </ThreadMetadataCard>
    </PanelStage>
  );
}

export function BranchGroupWithPullRequestStates() {
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
    <StoryCard>
      <StoryRow label="open, ready to merge">
        <BranchGroup pullRequest={readyPullRequest} />
      </StoryRow>
      <StoryRow label="open, checks passing">
        <BranchGroup pullRequest={passingPullRequest} />
      </StoryRow>
      <StoryRow label="open, no checks">
        <BranchGroup pullRequest={noChecksPullRequest} />
      </StoryRow>
      <StoryRow label="open, checks unknown">
        <BranchGroup pullRequest={unknownChecksPullRequest} />
      </StoryRow>
      <StoryRow label="open, checks failing">
        <BranchGroup pullRequest={failingPullRequest} />
      </StoryRow>
      <StoryRow label="open, checks pending">
        <BranchGroup pullRequest={pendingPullRequest} />
      </StoryRow>
      <StoryRow label="open, changes requested">
        <BranchGroup pullRequest={changesRequestedPullRequest} />
      </StoryRow>
      <StoryRow label="open, review requested">
        <BranchGroup pullRequest={reviewRequestedPullRequest} />
      </StoryRow>
      <StoryRow label="open, conflicts">
        <BranchGroup pullRequest={conflictsPullRequest} />
      </StoryRow>
      <StoryRow label="open, blocked">
        <BranchGroup pullRequest={blockedPullRequest} />
      </StoryRow>
      <StoryRow label="draft, checks passing">
        <BranchGroup pullRequest={draftPassingPullRequest} />
      </StoryRow>
      <StoryRow label="draft, checks failing">
        <BranchGroup pullRequest={draftFailingPullRequest} />
      </StoryRow>
      <StoryRow label="draft, no checks">
        <BranchGroup pullRequest={draftNoChecksPullRequest} />
      </StoryRow>
      <StoryRow label="draft, checks unknown">
        <BranchGroup pullRequest={draftUnknownChecksPullRequest} />
      </StoryRow>
      <StoryRow label="draft, checks pending">
        <BranchGroup pullRequest={draftPullRequest} />
      </StoryRow>
      <StoryRow label="draft, changes requested">
        <BranchGroup pullRequest={draftChangesRequestedPullRequest} />
      </StoryRow>
      <StoryRow label="merged">
        <BranchGroup pullRequest={mergedPullRequest} />
      </StoryRow>
      <StoryRow label="closed">
        <BranchGroup pullRequest={closedPullRequest} />
      </StoryRow>
    </StoryCard>
  );
}
