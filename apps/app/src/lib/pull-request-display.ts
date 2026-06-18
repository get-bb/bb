import type {
  PullRequestState,
  ThreadPullRequest,
  ThreadPullRequestAttentionState,
  ThreadPullRequestChecksState,
  ThreadPullRequestMergeabilityState,
  ThreadPullRequestReviewState,
} from "@bb/domain";
import type { IconName } from "@/components/ui/icon.js";

interface PullRequestDisplay {
  label: string;
  icon: IconName;
  className: string;
}

export interface PullRequestStateDisplay extends PullRequestDisplay {
  dotClass: string;
}

export const PULL_REQUEST_STATE_DISPLAY: Record<
  PullRequestState,
  PullRequestStateDisplay
> = {
  open: {
    label: "Open",
    icon: "GitPullRequestArrow",
    className: "text-success",
    dotClass: "bg-success",
  },
  draft: {
    label: "Draft",
    icon: "GitPullRequestDraft",
    className: "text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
  merged: {
    label: "Merged",
    icon: "GitMerge",
    className: "text-pr-merged",
    dotClass: "bg-pr-merged",
  },
  closed: {
    label: "Closed",
    icon: "GitPullRequestClosed",
    className: "text-destructive",
    dotClass: "bg-destructive",
  },
};

const CHECKS_DISPLAY: Record<ThreadPullRequestChecksState, PullRequestDisplay> =
  {
    passing: {
      label: "Checks passing",
      icon: "CircleCheck",
      className: "text-success",
    },
    failing: {
      label: "Checks failing",
      icon: "CircleX",
      className: "text-destructive",
    },
    pending: {
      label: "Checks pending",
      icon: "Clock",
      className: "text-warning-text",
    },
    no_checks: {
      label: "No checks",
      icon: "Circle",
      className: "text-muted-foreground",
    },
    unknown: {
      label: "Checks unknown",
      icon: "AlertTriangle",
      className: "text-warning-text",
    },
  };

const REVIEW_DISPLAY: Record<ThreadPullRequestReviewState, PullRequestDisplay> =
  {
    approved: {
      label: "Approved",
      icon: "CircleCheck",
      className: "text-success",
    },
    changes_requested: {
      label: "Changes requested",
      icon: "CircleX",
      className: "text-destructive",
    },
    review_required: {
      label: "Review required",
      icon: "Clock",
      className: "text-destructive",
    },
    review_requested: {
      label: "Review requested",
      icon: "Clock",
      className: "text-destructive",
    },
    none: {
      label: "No review",
      icon: "Circle",
      className: "text-muted-foreground",
    },
  };

const MERGEABILITY_DISPLAY: Record<
  ThreadPullRequestMergeabilityState,
  PullRequestDisplay
> = {
  mergeable: {
    label: "Mergeable",
    icon: "CircleCheck",
    className: "text-success",
  },
  conflicts: {
    label: "Conflicts",
    icon: "AlertTriangle",
    className: "text-destructive",
  },
  blocked: {
    label: "Blocked",
    icon: "AlertTriangle",
    className: "text-destructive",
  },
  draft: {
    label: "Draft",
    icon: "Clock",
    className: "text-muted-foreground",
  },
  unknown: {
    label: "Mergeability unknown",
    icon: "AlertTriangle",
    className: "text-warning-text",
  },
};

const ATTENTION_DISPLAY: Record<
  ThreadPullRequestAttentionState,
  PullRequestDisplay
> = {
  checks_failed: {
    ...CHECKS_DISPLAY.failing,
    icon: "GitPullRequestArrow",
  },
  checks_pending: {
    ...CHECKS_DISPLAY.pending,
    icon: "GitPullRequestArrow",
  },
  changes_requested: {
    ...REVIEW_DISPLAY.changes_requested,
    icon: "GitPullRequestArrow",
  },
  review_requested: {
    ...REVIEW_DISPLAY.review_requested,
    icon: "GitPullRequestArrow",
  },
  conflicts: {
    ...MERGEABILITY_DISPLAY.conflicts,
    icon: "GitPullRequestArrow",
  },
  blocked: {
    ...MERGEABILITY_DISPLAY.blocked,
    icon: "GitPullRequestArrow",
  },
  draft: PULL_REQUEST_STATE_DISPLAY.draft,
  ready_to_merge: {
    label: "Ready to merge",
    icon: "GitPullRequestArrow",
    className: "text-success",
  },
  merged: PULL_REQUEST_STATE_DISPLAY.merged,
  closed: PULL_REQUEST_STATE_DISPLAY.closed,
  none: PULL_REQUEST_STATE_DISPLAY.open,
};

export function getPullRequestChecksDisplay(
  pullRequest: ThreadPullRequest,
): PullRequestDisplay {
  return CHECKS_DISPLAY[pullRequest.checks.state];
}

export function getPullRequestReviewDisplay(
  pullRequest: ThreadPullRequest,
): PullRequestDisplay {
  return REVIEW_DISPLAY[pullRequest.review.state];
}

export function getPullRequestMergeabilityDisplay(
  pullRequest: ThreadPullRequest,
): PullRequestDisplay {
  return MERGEABILITY_DISPLAY[pullRequest.mergeability.state];
}

export function getPullRequestAttentionDisplay(
  pullRequest: ThreadPullRequest,
): PullRequestDisplay {
  return ATTENTION_DISPLAY[pullRequest.attention];
}

export function getPullRequestSignalDisplays(
  pullRequest: ThreadPullRequest,
): readonly PullRequestDisplay[] {
  return [
    getPullRequestChecksDisplay(pullRequest),
    getPullRequestReviewDisplay(pullRequest),
    getPullRequestMergeabilityDisplay(pullRequest),
  ];
}
