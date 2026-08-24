import type {
  PullRequestState,
  ThreadPullRequest,
  ThreadPullRequestAttentionState,
  ThreadPullRequestChecksState,
  ThreadPullRequestMergeabilityState,
  ThreadPullRequestReviewState,
} from "@bb/domain";
import type {
  EnvironmentPullRequestResponse,
  PullRequestMergeMethod,
} from "@bb/server-contract";
import type { IconName } from "@/ui/icon-map";

/**
 * Pull-request presentation (port of apps/app/src/lib/pull-request-display.ts
 * and PullRequestStatusPill.tsx) with theme tones in place of class names,
 * plus the query freshness policy from the web environment queries.
 */

export type PullRequestDisplayTone =
  | "success"
  | "destructive"
  | "warning"
  | "muted"
  | "merged";

export interface PullRequestDisplay {
  label: string;
  icon: IconName;
  tone: PullRequestDisplayTone;
}

export const PULL_REQUEST_STATE_DISPLAY: Record<
  PullRequestState,
  PullRequestDisplay
> = {
  open: { label: "Open", icon: "GitPullRequestArrow", tone: "success" },
  draft: { label: "Draft", icon: "GitPullRequestDraft", tone: "muted" },
  merged: { label: "Merged", icon: "GitMerge", tone: "merged" },
  closed: {
    label: "Closed",
    icon: "GitPullRequestClosed",
    tone: "destructive",
  },
};

const CHECKS_DISPLAY: Record<ThreadPullRequestChecksState, PullRequestDisplay> =
  {
    passing: { label: "Checks passing", icon: "CircleCheck", tone: "success" },
    failing: { label: "Checks failing", icon: "CircleX", tone: "destructive" },
    pending: { label: "Checks pending", icon: "Clock", tone: "warning" },
    no_checks: { label: "No checks", icon: "Circle", tone: "muted" },
    unknown: {
      label: "Checks unknown",
      icon: "AlertTriangle",
      tone: "warning",
    },
  };

const REVIEW_DISPLAY: Record<ThreadPullRequestReviewState, PullRequestDisplay> =
  {
    approved: { label: "Approved", icon: "CircleCheck", tone: "success" },
    changes_requested: {
      label: "Changes requested",
      icon: "CircleX",
      tone: "destructive",
    },
    review_required: {
      label: "Review required",
      icon: "Clock",
      tone: "destructive",
    },
    review_requested: {
      label: "Review requested",
      icon: "Clock",
      tone: "destructive",
    },
    none: { label: "No review", icon: "Circle", tone: "muted" },
  };

const MERGEABILITY_DISPLAY: Record<
  ThreadPullRequestMergeabilityState,
  PullRequestDisplay
> = {
  mergeable: { label: "Mergeable", icon: "CircleCheck", tone: "success" },
  conflicts: { label: "Conflicts", icon: "AlertTriangle", tone: "destructive" },
  blocked: { label: "Blocked", icon: "AlertTriangle", tone: "destructive" },
  draft: { label: "Draft", icon: "Clock", tone: "muted" },
  unknown: {
    label: "Mergeability unknown",
    icon: "AlertTriangle",
    tone: "warning",
  },
};

const ATTENTION_DISPLAY: Record<
  ThreadPullRequestAttentionState,
  PullRequestDisplay
> = {
  checks_failed: { ...CHECKS_DISPLAY.failing, icon: "GitPullRequestArrow" },
  checks_pending: { ...CHECKS_DISPLAY.pending, icon: "GitPullRequestArrow" },
  changes_requested: {
    ...REVIEW_DISPLAY.changes_requested,
    icon: "GitPullRequestArrow",
  },
  review_requested: {
    ...REVIEW_DISPLAY.review_requested,
    icon: "GitPullRequestArrow",
  },
  conflicts: { ...MERGEABILITY_DISPLAY.conflicts, icon: "GitPullRequestArrow" },
  blocked: { ...MERGEABILITY_DISPLAY.blocked, icon: "GitPullRequestArrow" },
  draft: PULL_REQUEST_STATE_DISPLAY.draft,
  ready_to_merge: {
    label: "Ready to merge",
    icon: "GitPullRequestArrow",
    tone: "success",
  },
  merged: PULL_REQUEST_STATE_DISPLAY.merged,
  closed: PULL_REQUEST_STATE_DISPLAY.closed,
  none: PULL_REQUEST_STATE_DISPLAY.open,
};

export function getPullRequestAttentionDisplay(
  pullRequest: ThreadPullRequest,
): PullRequestDisplay {
  return ATTENTION_DISPLAY[pullRequest.attention];
}

/** Attention states worth a "· <label>" suffix next to the PR number. */
export function shouldShowPullRequestAttentionLabel(
  pullRequest: ThreadPullRequest,
): boolean {
  return (
    pullRequest.attention === "checks_failed" ||
    pullRequest.attention === "changes_requested" ||
    pullRequest.attention === "review_requested" ||
    pullRequest.attention === "conflicts" ||
    pullRequest.attention === "blocked"
  );
}

export type GithubCheckStatus = "success" | "failure" | "pending";

/**
 * The GitHub-style check glyph beside the PR state icon: only live (open /
 * draft) pull requests carry one, and only when checks ran.
 */
export function getPullRequestGithubCheckStatus(
  pullRequest: ThreadPullRequest,
): GithubCheckStatus | null {
  if (pullRequest.state !== "open" && pullRequest.state !== "draft") {
    return null;
  }
  switch (pullRequest.checks.state) {
    case "passing":
      return "success";
    case "failing":
      return "failure";
    case "pending":
      return "pending";
    case "no_checks":
    case "unknown":
      return null;
  }
}

/** "PR #12 · Merged" — the banner's PR row label. */
export function formatPullRequestRowLabel(
  pullRequest: ThreadPullRequest,
): string {
  const stateSuffix =
    pullRequest.state === "open"
      ? ""
      : ` · ${PULL_REQUEST_STATE_DISPLAY[pullRequest.state].label}`;
  return `PR #${pullRequest.number}${stateSuffix}`;
}

export const PULL_REQUEST_MERGE_ACTIONS: readonly {
  method: PullRequestMergeMethod;
  label: string;
}[] = [
  { method: "merge", label: "Merge" },
  { method: "squash", label: "Squash merge" },
  { method: "rebase", label: "Rebase and merge" },
];

export type PullRequestBannerAction =
  | { kind: "mark-ready" }
  | { kind: "merge" }
  | { kind: "none" };

/**
 * Which primary action the banner offers: a draft can be marked ready; an
 * open, mergeable PR can be merged (with "convert to draft" in its menu);
 * anything else has no action.
 */
export function resolvePullRequestBannerAction(
  pullRequest: ThreadPullRequest,
): PullRequestBannerAction {
  if (pullRequest.state === "draft") return { kind: "mark-ready" };
  if (
    pullRequest.state === "open" &&
    pullRequest.mergeability.state === "mergeable"
  ) {
    return { kind: "merge" };
  }
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Query freshness (mirrors apps/app/src/hooks/queries/environment-queries.ts)

const ENVIRONMENT_PULL_REQUEST_STALE_MS = 30_000;
const ENVIRONMENT_SETTLED_PULL_REQUEST_STALE_MS = 60 * 60_000;
const ENVIRONMENT_ACTIVE_PULL_REQUEST_REFETCH_MS = 5_000;

/**
 * The PR carried by a lookup response, or `null` when the lookup answered
 * "absent" or could not run ("unavailable" — treated like absent for
 * freshness so a transient gh failure retries on the short cycle).
 */
export function getEnvironmentPullRequestFromResponse(
  response: EnvironmentPullRequestResponse | undefined,
): ThreadPullRequest | null {
  return response?.outcome === "available" ? response.pullRequest : null;
}

export function getEnvironmentPullRequestStaleTime(
  pullRequest: ThreadPullRequest | null | undefined,
): number {
  return pullRequest?.state === "closed" || pullRequest?.state === "merged"
    ? ENVIRONMENT_SETTLED_PULL_REQUEST_STALE_MS
    : ENVIRONMENT_PULL_REQUEST_STALE_MS;
}

export function getEnvironmentPullRequestRefetchInterval(
  pullRequest: ThreadPullRequest | null | undefined,
): number | false {
  if (!pullRequest || pullRequest.state !== "open") {
    return false;
  }
  if (
    pullRequest.checks.state === "pending" ||
    pullRequest.mergeability.state === "unknown"
  ) {
    return ENVIRONMENT_ACTIVE_PULL_REQUEST_REFETCH_MS;
  }
  return false;
}
