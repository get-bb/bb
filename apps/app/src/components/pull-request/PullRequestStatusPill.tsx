import type { ThreadPullRequest } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getPullRequestAttentionDisplay,
  getPullRequestStateDisplay,
  getPullRequestGithubStatus,
} from "@/lib/pull-request-display";
import { GithubFaviconIcon } from "./GithubFaviconIcon";

const CHECKED_PULL_REQUEST_STATUS_MIN_WIDTH_CLASS = "min-w-9";
const SINGLE_PULL_REQUEST_STATUS_MIN_WIDTH_CLASS = "min-w-4";

export function PullRequestStateIcon({
  pullRequest,
  className,
}: {
  pullRequest: ThreadPullRequest;
  className?: string;
}) {
  const statusIcon = getPullRequestStateDisplay(pullRequest);
  return (
    <Icon
      name={statusIcon.icon}
      className={cn("size-4 shrink-0", statusIcon.className, className)}
      aria-hidden="true"
    />
  );
}

export function PullRequestStatusPill({
  pullRequest,
  className,
}: {
  pullRequest: ThreadPullRequest;
  className?: string;
}) {
  const checkStatus = getPullRequestGithubStatus(pullRequest);
  return (
    <span
      title={getPullRequestAttentionDisplay(pullRequest).label}
      className={cn(
        "flex h-5 shrink-0 cursor-pointer items-center gap-1",
        checkStatus !== null
          ? CHECKED_PULL_REQUEST_STATUS_MIN_WIDTH_CLASS
          : SINGLE_PULL_REQUEST_STATUS_MIN_WIDTH_CLASS,
        className,
      )}
    >
      <PullRequestStateIcon pullRequest={pullRequest} />
      {checkStatus === null ? null : <GithubFaviconIcon status={checkStatus} />}
    </span>
  );
}
