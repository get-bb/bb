import {
  experimental_DetailRow as DetailRow,
  type ExperimentalThreadInfoProps,
} from "@get-bb/plugin-sdk/app";
import {
  describePullRequestStatus,
  getPullRequestListNames,
  getPullRequestNextStep,
  getPullRequestStateDisplay,
  isPullRequestAutoMergeOn,
} from "./display";
import { GithubFaviconIcon } from "./GithubFaviconIcon";
import { useOpenUrlClick } from "./PullRequestContextSegment";
import { PullRequestNextStepLabel } from "./PullRequestNextStepLabel";
import { PullRequestStateIcon } from "./PullRequestStatusPill";
import { useEnvironmentPullRequest } from "./queries";
import type { PullRequest } from "../contract";

export function PullRequestSummary({
  pullRequest,
  name = `#${pullRequest.number}`,
}: {
  pullRequest: PullRequest;
  name?: string;
}) {
  const handleClick = useOpenUrlClick(pullRequest.url);
  const stateDisplay = getPullRequestStateDisplay(pullRequest);
  const nextStep = getPullRequestNextStep(pullRequest);
  return (
    <span className="flex h-5 max-w-full min-w-0 items-center gap-2">
      <a
        href={pullRequest.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        aria-label={`Pull request ${pullRequest.number}: ${describePullRequestStatus(pullRequest)}`}
        className="flex min-w-0 items-center gap-2 overflow-hidden text-xs text-foreground no-underline transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <GithubFaviconIcon />
        <span className="shrink-0 text-muted-foreground">{name}</span>
        <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-1.5 text-muted-foreground">
          <PullRequestStateIcon
            pullRequest={pullRequest}
            className="size-3.5"
          />
          <span>{stateDisplay.label}</span>
        </span>
        {nextStep ? <PullRequestNextStepLabel nextStep={nextStep} /> : null}
      </a>
      {isPullRequestAutoMergeOn(pullRequest) &&
      pullRequest.attention !== "queued" ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          Auto-merge on
        </span>
      ) : null}
    </span>
  );
}

export function PullRequestRow({ pullRequest }: { pullRequest: PullRequest }) {
  return (
    <DetailRow icon="GitPullRequestArrow" label="Pull request">
      <PullRequestSummary pullRequest={pullRequest} />
    </DetailRow>
  );
}

export function PullRequestsRow({
  pullRequests,
}: {
  pullRequests: readonly PullRequest[];
}) {
  const names = getPullRequestListNames(pullRequests);
  return (
    <DetailRow icon="GitPullRequestArrow" label="Pull requests" align="start">
      <span className="flex min-w-0 flex-col gap-0.5">
        {pullRequests.map((pullRequest, index) => (
          <PullRequestSummary
            key={pullRequest.url}
            pullRequest={pullRequest}
            name={names[index]}
          />
        ))}
      </span>
    </DetailRow>
  );
}

export function PullRequestInfoRow({
  environment,
}: ExperimentalThreadInfoProps) {
  const { pullRequest, pullRequests } = useEnvironmentPullRequest(
    environment?.id ?? null,
  );
  if (pullRequest === null) return null;
  if (pullRequests.length > 1)
    return (
      <PullRequestsRow
        pullRequests={pullRequests.map((entry) => entry.pullRequest)}
      />
    );
  return <PullRequestRow pullRequest={pullRequest} />;
}
