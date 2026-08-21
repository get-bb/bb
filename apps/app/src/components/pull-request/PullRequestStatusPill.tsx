import type { PullRequestState, ThreadPullRequest } from "@bb/domain";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { getPullRequestGithubCheckStatus } from "@/lib/pull-request-display";
import { GithubFaviconIcon } from "./GithubFaviconIcon";

const PR_STATUS_ICON: Record<
  PullRequestState,
  { icon: IconName; className: string; title: string }
> = {
  open: {
    icon: "GitPullRequestArrow",
    className: "text-success",
    title: "Open Pull Request",
  },
  closed: {
    icon: "GitPullRequestClosed",
    className: "text-destructive",
    title: "Closed Pull Request",
  },
  merged: {
    icon: "GitMerge",
    className: "text-pr-merged",
    title: "Merged Pull Request",
  },
  draft: {
    icon: "GitPullRequestDraft",
    className: "text-muted-foreground",
    title: "Draft Pull Request",
  },
};

const CHECKED_PULL_REQUEST_STATUS_MIN_WIDTH_CLASS = "min-w-9";
const SINGLE_PULL_REQUEST_STATUS_MIN_WIDTH_CLASS = "min-w-4";

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
  if (status === null) {
    return null;
  }
  return <GithubFaviconIcon status={status} className={className} />;
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
