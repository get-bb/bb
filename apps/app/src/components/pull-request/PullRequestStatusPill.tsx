import type {
  PullRequestState,
  ThreadPullRequest,
  ThreadPullRequestChecksState,
} from "@bb/domain";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

const checksSuccessIcon =
  "https://github.githubassets.com/favicons/favicon-success.png";
const checksSuccessDarkIcon =
  "https://github.githubassets.com/favicons/favicon-success-dark.png";
const checksFailureIcon =
  "https://github.githubassets.com/favicons/favicon-failure.png";
const checksFailureDarkIcon =
  "https://github.githubassets.com/favicons/favicon-failure-dark.png";
const checksPendingIcon =
  "https://github.githubassets.com/favicons/favicon-pending.png";
const checksPendingDarkIcon =
  "https://github.githubassets.com/favicons/favicon-pending-dark.png";

export type GithubCheckStatus = "success" | "failure" | "pending";

const PR_STATUS_COLOR: Record<PullRequestState, { textClassName: string }> = {
  open: {
    textClassName: "text-success",
  },
  closed: {
    textClassName: "text-destructive",
  },
  merged: {
    textClassName: "text-pr-merged",
  },
  draft: {
    textClassName: "text-muted-foreground",
  },
};

const PR_STATUS_ICON: Record<
  PullRequestState,
  { icon: IconName; className: string; title: string }
> = {
  open: {
    icon: "GitPullRequestArrow",
    className: PR_STATUS_COLOR.open.textClassName,
    title: "Open Pull Request",
  },
  closed: {
    icon: "GitPullRequestClosed",
    className: PR_STATUS_COLOR.closed.textClassName,
    title: "Closed Pull Request",
  },
  merged: {
    icon: "GitMerge",
    className: PR_STATUS_COLOR.merged.textClassName,
    title: "Merged Pull Request",
  },
  draft: {
    icon: "GitPullRequestDraft",
    className: PR_STATUS_COLOR.draft.textClassName,
    title: "Draft Pull Request",
  },
};

const CHECKED_PULL_REQUEST_STATUS_MIN_WIDTH_CLASS = "min-w-9";
const SINGLE_PULL_REQUEST_STATUS_MIN_WIDTH_CLASS = "min-w-4";

function getGithubCheckStatus(
  state: ThreadPullRequestChecksState,
): GithubCheckStatus | null {
  switch (state) {
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

function getPullRequestGithubCheckStatus(
  pullRequest: ThreadPullRequest,
): GithubCheckStatus | null {
  if (pullRequest.state !== "open" && pullRequest.state !== "draft") {
    return null;
  }
  return getGithubCheckStatus(pullRequest.checks.state);
}

export function PullRequestStateIcon({
  state,
  className,
}: {
  state: PullRequestState;
  className?: string;
}) {
  const statusIcon = PR_STATUS_ICON[state];
  return (
    <Icon
      name={statusIcon.icon}
      className={cn("size-4 shrink-0", statusIcon.className, className)}
      aria-hidden="true"
    />
  );
}

export function PullRequestGithubCheckIcon({
  pullRequest,
  className,
}: {
  pullRequest: ThreadPullRequest;
  className?: string;
}) {
  const status = getPullRequestGithubCheckStatus(pullRequest);
  const checkStatusClassName = "size-4 shrink-0";
  switch (status) {
    case "success":
      return (
        <>
          <img
            src={checksSuccessIcon}
            alt=""
            aria-hidden="true"
            className={cn(checkStatusClassName, "dark:hidden", className)}
          />
          <img
            src={checksSuccessDarkIcon}
            alt=""
            aria-hidden="true"
            className={cn(checkStatusClassName, "hidden dark:block", className)}
          />
        </>
      );
    case "failure":
      return (
        <>
          <img
            src={checksFailureIcon}
            alt=""
            aria-hidden="true"
            className={cn(checkStatusClassName, "dark:hidden", className)}
          />
          <img
            src={checksFailureDarkIcon}
            alt=""
            aria-hidden="true"
            className={cn(checkStatusClassName, "hidden dark:block", className)}
          />
        </>
      );
    case "pending":
      return (
        <>
          <img
            src={checksPendingIcon}
            alt=""
            aria-hidden="true"
            className={cn(checkStatusClassName, "dark:hidden", className)}
          />
          <img
            src={checksPendingDarkIcon}
            alt=""
            aria-hidden="true"
            className={cn(checkStatusClassName, "hidden dark:block", className)}
          />
        </>
      );
    case null:
      return null;
  }
}

export function PullRequestStatusPill({
  pullRequest,
  className,
}: {
  pullRequest: ThreadPullRequest;
  className?: string;
}) {
  const hasCheckIcon = getPullRequestGithubCheckStatus(pullRequest) !== null;
  return (
    <span
      title={PR_STATUS_ICON[pullRequest.state].title}
      className={cn(
        "flex h-5 shrink-0 cursor-pointer items-center gap-1",
        hasCheckIcon
          ? CHECKED_PULL_REQUEST_STATUS_MIN_WIDTH_CLASS
          : SINGLE_PULL_REQUEST_STATUS_MIN_WIDTH_CLASS,
        className,
      )}
    >
      <PullRequestStateIcon state={pullRequest.state} />
      <PullRequestGithubCheckIcon pullRequest={pullRequest} />
    </span>
  );
}
