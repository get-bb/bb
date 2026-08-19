import type {
  PullRequestState,
  ThreadPullRequest,
  ThreadPullRequestChecksState,
} from "@bb/domain";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

export type GithubCheckStatus = "success" | "failure" | "pending";

// The check glyph is the bundled GitHub mark with a small status dot in the
// corner, drawn from theme tokens. It replaces the light + dark favicon PNGs
// that were fetched from github.githubassets.com on every thread that has a
// pull request: two cross-origin image requests per pill (and per row on the
// sidebar/thread list), which on phones over a tunnel meant late-arriving,
// layout-shifting icons and a third-party request on every cold start.
const GITHUB_CHECK_STATUS_DOT_CLASS: Record<GithubCheckStatus, string> = {
  success: "bg-success",
  failure: "bg-destructive",
  pending: "bg-attention",
};

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
  if (status === null) {
    return null;
  }
  return (
    <span
      data-pull-request-check-status={status}
      aria-hidden="true"
      className={cn("relative inline-flex size-4 shrink-0", className)}
    >
      <Icon name="Github" className="size-4 shrink-0" aria-hidden="true" />
      <span
        className={cn(
          "absolute -right-px -bottom-px size-2 rounded-full ring-2 ring-background",
          GITHUB_CHECK_STATUS_DOT_CLASS[status],
        )}
      />
    </span>
  );
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
