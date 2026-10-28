import { useState } from "react";
import { useMemo } from "react";
import {
  experimental_useRpcKeyedQuery,
  type ExperimentalThreadRowMetadataDataInput,
  type ExperimentalThreadRowMetadataProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { EnvironmentPullRequest, PullRequest } from "../contract";
import { pullRequestsReadContract } from "../read-contract";
import {
  PULL_REQUEST_STATE_DISPLAY,
  describePullRequestStatus,
  getPullRequestGithubCheckStatus,
  type GithubCheckStatus,
} from "./display";
import { useRefetchOnShowAndFocus } from "./refetch-on-show";

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

const CHECKS_LABEL: Record<GithubCheckStatus, string> = {
  success: "checks passing",
  failure: "checks failing",
  pending: "checks running",
};

function AttentionGlyph({ kind }: { kind: "blocked" | "running" }) {
  return kind === "running" ? (
    <span className="flex size-3 shrink-0 items-center justify-center">
      <span className="size-1.5 rounded-full bg-attention" />
    </span>
  ) : (
    <Icon
      name="X"
      className="size-3 shrink-0 text-destructive-text [&_path]:stroke-[2.75]"
    />
  );
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
  const conflicts =
    (pullRequest.state === "open" || pullRequest.state === "draft") &&
    pullRequest.attention === "conflicts";
  const glyph =
    conflicts || checks === "failure"
      ? "blocked"
      : checks === "pending"
        ? "running"
        : null;
  const label = [
    `Pull request #${pullRequest.number}`,
    state.label.toLowerCase(),
    conflicts ? "conflicts" : null,
    checks === null ? null : CHECKS_LABEL[checks],
  ]
    .filter((part) => part !== null)
    .join(", ");
  const badge = (
    <span
      role="img"
      aria-label={label}
      data-pull-request-badge={pullRequest.state}
      className="flex shrink-0 items-center gap-1 text-xs leading-3.5 tabular-nums"
      onPointerEnter={hovered ? undefined : () => setHovered(true)}
    >
      <Icon
        name={state.icon}
        className={cn("size-3.5 shrink-0", state.className)}
      />
      <span className="text-subtle-foreground">#{pullRequest.number}</span>
      {glyph === null ? null : <AttentionGlyph kind={glyph} />}
    </span>
  );
  if (!hovered) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
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

type PullRequestRows = Record<string, EnvironmentPullRequest> | undefined;

export function usePullRequestRows({
  threads,
}: ExperimentalThreadRowMetadataDataInput): PullRequestRows {
  const keys = useMemo(
    () => [
      ...new Set(
        threads.flatMap((thread) => {
          const environmentId = thread.environment?.id;
          return environmentId == null ? [] : [environmentId];
        }),
      ),
    ],
    [threads],
  );
  const query = experimental_useRpcKeyedQuery({
    contract: pullRequestsReadContract,
    method: "pullRequests",
    keys,
    enabled: keys.length > 0,
  });
  useRefetchOnShowAndFocus({
    shown: keys.length > 0 ? "thread-row-metadata" : null,
    loaded: query.data !== undefined && Object.keys(query.data).length > 0,
    refetch: query.refetch,
  });
  return query.data;
}

export function PullRequestRowMetadata({
  thread,
  data,
}: ExperimentalThreadRowMetadataProps<PullRequestRows>) {
  const environmentId = thread.environment?.id ?? null;
  const row = environmentId === null ? undefined : data?.[environmentId];
  const pullRequest = row?.outcome === "available" ? row.pullRequest : null;
  return pullRequest === null ? null : (
    <PullRequestBadge pullRequest={pullRequest} />
  );
}
