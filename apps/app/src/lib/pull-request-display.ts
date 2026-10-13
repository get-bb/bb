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
  icon: IconName | null;
  running: boolean;
}

export const PULL_REQUEST_NEXT_STEP_TONE_CLASS: Record<
  PullRequestNextStepTone,
  string
> = {
  action: "text-destructive",
  ready: "text-success",
  waiting: "text-muted-foreground",
};

function action(label: string): PullRequestNextStep {
  return { label, tone: "action", icon: null, running: false };
}

function waiting(label: string): PullRequestNextStep {
  return { label, tone: "waiting", icon: null, running: false };
}

const CHECKS_FAILING_STEP: PullRequestNextStep = {
  label: "Checks failing",
  tone: "action",
  icon: "CircleX",
  running: false,
};

const CHECKS_RUNNING_STEP: PullRequestNextStep = {
  label: "Checks running",
  tone: "waiting",
  icon: "Clock",
  running: true,
};

function checksResult(label: string, icon: IconName): PullRequestNextStep {
  return { label, tone: "waiting", icon, running: false };
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
      return checksResult("Checks passing", "CircleCheck");
    case "failing":
      return CHECKS_FAILING_STEP;
    case "pending":
      return CHECKS_RUNNING_STEP;
    case "no_checks":
      return checksResult("No checks", "Circle");
    case "unknown":
      return checksResult("Checks unknown", "CircleQuestion");
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
      return CHECKS_FAILING_STEP;
    case "changes_requested":
      return action("Changes requested");
    case "conflicts":
      return action(`Conflicts with ${pullRequest.baseRefName}`);
    case "blocked":
      return blockedStep(pullRequest);
    case "checks_pending":
      return CHECKS_RUNNING_STEP;
    case "review_requested":
      return waiting(
        pullRequest.review.state === "review_required"
          ? "Review required"
          : "Review requested",
      );
    case "queued":
      return waiting("Queued to merge");
    case "ready_to_merge":
      return {
        label: "Ready to merge",
        tone: "ready",
        icon: null,
        running: false,
      };
    case "draft":
    case "none":
      return checksStep(pullRequest);
  }
}

export function describePullRequestStatus(
  pullRequest: ThreadPullRequest,
): string {
  const nextStep = getPullRequestNextStep(pullRequest);
  return [
    PULL_REQUEST_STATE_DISPLAY[pullRequest.state].label,
    nextStep?.label,
    isPullRequestAutoMergeOn(pullRequest) ? "auto-merge on" : null,
  ]
    .filter((part) => part)
    .join(", ");
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
