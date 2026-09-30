import type {
  PullRequestState,
  ThreadPullRequest,
  ThreadPullRequestAttentionState,
  ThreadPullRequestChecksState,
  ThreadPullRequestMergeabilityState,
  ThreadPullRequestReviewState,
} from "@bb/domain";
import type { IconName } from "@bb/shared-ui/icon";

interface PullRequestDisplay {
  label: string;
  icon: IconName;
  className: string;
}

export type GithubStatus = "success" | "failure" | "pending";

interface PullRequestStateDisplay extends PullRequestDisplay {
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
      className: "text-attention",
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
      className: "text-attention",
    },
    review_requested: {
      label: "Review requested",
      icon: "Clock",
      className: "text-attention",
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
    className: "text-attention",
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
  queued: {
    label: "Queued to merge",
    icon: "GitMerge",
    className: "text-attention",
  },
  draft: PULL_REQUEST_STATE_DISPLAY.draft,
  ready_to_merge: {
    label: "Ready to merge",
    icon: "GitPullRequestArrow",
    className: "text-success",
  },
  merged: PULL_REQUEST_STATE_DISPLAY.merged,
  closed: PULL_REQUEST_STATE_DISPLAY.closed,
  none: {
    ...PULL_REQUEST_STATE_DISPLAY.open,
    className: "text-muted-foreground",
  },
};

export function getPullRequestGithubStatus(
  pullRequest: ThreadPullRequest,
): GithubStatus | null {
  if (pullRequest.state !== "open" && pullRequest.state !== "draft") {
    return null;
  }
  switch (pullRequest.attention) {
    case "checks_failed":
    case "changes_requested":
    case "conflicts":
      return "failure";
    case "queued":
    case "review_requested":
    case "checks_pending":
    case "blocked":
      return "pending";
    case "ready_to_merge":
      return pullRequest.autoMerge ? "pending" : "success";
    default:
      return null;
  }
}

export function getPullRequestAttentionDisplay(
  pullRequest: ThreadPullRequest,
): PullRequestDisplay {
  const display =
    pullRequest.attention === "review_requested" &&
    pullRequest.review.state === "review_required"
      ? REVIEW_DISPLAY.review_required
      : ATTENTION_DISPLAY[pullRequest.attention];
  const waitingOrReady = [
    "review_requested",
    "checks_pending",
    "blocked",
    "ready_to_merge",
  ].includes(pullRequest.attention);
  if (!waitingOrReady) return display;
  const labels: string[] = [];
  if (pullRequest.autoMerge) labels.push("Auto-merge on");
  if (pullRequest.review.state === "approved") labels.push("Approved");
  labels.push(
    pullRequest.autoMerge && pullRequest.attention === "ready_to_merge"
      ? "Waiting to merge"
      : display.label,
  );
  return {
    ...display,
    label: labels.join(" · "),
    className: pullRequest.autoMerge ? "text-attention" : display.className,
  };
}

export function getPullRequestStateDisplay(
  pullRequest: ThreadPullRequest,
): PullRequestStateDisplay {
  if (
    pullRequest.state === "open" &&
    (pullRequest.autoMerge || pullRequest.inMergeQueue)
  ) {
    return {
      label: pullRequest.inMergeQueue ? "Queued to merge" : "Auto-merge on",
      icon: "GitMerge",
      className: "text-attention",
      dotClass: "bg-attention",
    };
  }
  return PULL_REQUEST_STATE_DISPLAY[pullRequest.state];
}
