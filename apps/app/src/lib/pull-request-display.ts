import type { PullRequestState, ThreadPullRequest } from "@bb/domain";
import type { IconName } from "@bb/shared-ui/icon";

interface PullRequestDisplay {
  label: string;
  icon: IconName;
  className: string;
}

export type GithubCheckStatus = "success" | "failure" | "pending";

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

export type PullRequestNextStepTone = "action" | "ready" | "waiting";

export interface PullRequestNextStep {
  label: string;
  tone: PullRequestNextStepTone;
}

export const PULL_REQUEST_NEXT_STEP_TONE_CLASS: Record<
  PullRequestNextStepTone,
  string
> = {
  action: "text-destructive",
  ready: "text-foreground",
  waiting: "text-muted-foreground",
};

function action(label: string): PullRequestNextStep {
  return { label, tone: "action" };
}

function waiting(label: string): PullRequestNextStep {
  return { label, tone: "waiting" };
}

function blockedStep(pullRequest: ThreadPullRequest): PullRequestNextStep {
  switch (pullRequest.mergeability.mergeStateStatus) {
    case "BEHIND":
      return action(`Behind ${pullRequest.baseRefName}`);
    case "HAS_HOOKS":
      return action("Blocked by hooks");
    default:
      return action("Blocked by rules");
  }
}

function checksStep(pullRequest: ThreadPullRequest): PullRequestNextStep {
  switch (pullRequest.checks.state) {
    case "passing":
      return waiting("Checks passing");
    case "failing":
      return action("Checks failing");
    case "pending":
      return waiting("Checks running");
    case "no_checks":
      return waiting("No checks");
    case "unknown":
      return waiting("Checks unknown");
  }
}

export function getPullRequestNextStep(
  pullRequest: ThreadPullRequest,
): PullRequestNextStep | null {
  switch (pullRequest.attention) {
    case "merged":
    case "closed":
      return null;
    case "checks_failed":
      return action("Checks failing");
    case "changes_requested":
      return action("Changes requested");
    case "conflicts":
      return action(`Conflicts with ${pullRequest.baseRefName}`);
    case "blocked":
      return blockedStep(pullRequest);
    case "checks_pending":
      return waiting("Checks running");
    case "review_requested":
      return waiting(
        pullRequest.review.state === "review_required"
          ? "Review required"
          : "Review requested",
      );
    case "queued":
      return waiting("Queued to merge");
    case "ready_to_merge":
      return { label: "Ready to merge", tone: "ready" };
    case "draft":
    case "none":
      return checksStep(pullRequest);
  }
}

export function isPullRequestAutoMergeOn(
  pullRequest: ThreadPullRequest,
): boolean {
  return pullRequest.state === "open" && pullRequest.autoMerge;
}

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

export function getPullRequestStateDisplay(
  pullRequest: ThreadPullRequest,
): PullRequestStateDisplay {
  return PULL_REQUEST_STATE_DISPLAY[pullRequest.state];
}
