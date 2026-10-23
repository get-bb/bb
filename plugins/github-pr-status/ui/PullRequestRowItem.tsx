import { useState } from "react";
import {
  experimental_useRpcKeyedQuery,
  type ExperimentalThreadRowItemProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PullRequest } from "../contract";
import {
  PULL_REQUESTS_ANY_AGE_MS,
  pullRequestsReadContract,
} from "../read-contract";
import {
  PULL_REQUEST_STATE_DISPLAY,
  describePullRequestStatus,
  getPullRequestGithubCheckStatus,
  type GithubCheckStatus,
} from "./display";

const CHECK_DOT_CLASS: Record<GithubCheckStatus, string> = {
  success: "bg-success",
  failure: "bg-destructive",
  pending: "bg-warning",
};

const CHECK_LABEL: Record<GithubCheckStatus, string> = {
  success: "checks passing",
  failure: "checks failing",
  pending: "checks running",
};

function checkCounts(pullRequest: PullRequest): string | null {
  const { totalCount, passedCount, failedCount, pendingCount } =
    pullRequest.checks;
  if (totalCount === 0) return null;
  return [
    `${passedCount} passed`,
    failedCount > 0 ? `${failedCount} failed` : null,
    pendingCount > 0 ? `${pendingCount} pending` : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

export function PullRequestBadge({
  pullRequest,
}: {
  pullRequest: PullRequest;
}) {
  const [hovered, setHovered] = useState(false);
  const state = PULL_REQUEST_STATE_DISPLAY[pullRequest.state];
  const checks = getPullRequestGithubCheckStatus(pullRequest);
  const counts = checks === null ? null : checkCounts(pullRequest);
  const label = [
    `Pull request #${pullRequest.number}`,
    state.label.toLowerCase(),
    checks === null ? null : CHECK_LABEL[checks],
  ]
    .filter((part) => part !== null)
    .join(", ");
  const glyph = (
    <span
      role="img"
      aria-label={label}
      data-pull-request-badge={pullRequest.state}
      data-pull-request-checks={checks ?? undefined}
      className="relative flex size-4 shrink-0 items-center justify-center"
      onPointerEnter={hovered ? undefined : () => setHovered(true)}
    >
      <Icon name={state.icon} className={cn("size-3.5", state.className)} />
      {checks === null ? null : (
        <span
          aria-hidden
          className={cn(
            "absolute -bottom-px -right-px size-1.5 rounded-full ring-1 ring-sidebar",
            CHECK_DOT_CLASS[checks],
            checks === "pending" && "animate-pulse",
          )}
        />
      )}
    </span>
  );
  if (!hovered) return glyph;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{glyph}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">
        <div className="truncate">
          #{pullRequest.number} {pullRequest.title}
        </div>
        <div className="text-muted-foreground">
          {describePullRequestStatus(pullRequest)}
          {counts === null ? null : ` · ${counts}`}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

const ROW_READ_INPUT = { maxAgeMs: PULL_REQUESTS_ANY_AGE_MS };

export function PullRequestRowItem({
  thread,
  isLive,
}: ExperimentalThreadRowItemProps) {
  const environmentId = thread.environment?.id ?? null;
  const query = experimental_useRpcKeyedQuery({
    contract: pullRequestsReadContract,
    method: "pullRequests",
    keys: environmentId === null ? [] : [environmentId],
    input: ROW_READ_INPUT,
    enabled: isLive && environmentId !== null,
  });
  const row = environmentId === null ? undefined : query.data?.[environmentId];
  const pullRequest = row?.outcome === "available" ? row.pullRequest : null;
  return pullRequest === null ? null : (
    <PullRequestBadge pullRequest={pullRequest} />
  );
}
