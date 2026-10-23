import {
  experimental_DetailRow as DetailRow,
  type ExperimentalThreadInfoProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import {
  describePullRequestStatus,
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

export function PullRequestRow({ pullRequest }: { pullRequest: PullRequest }) {
  const handleClick = useOpenUrlClick(pullRequest.url);
  const stateDisplay = getPullRequestStateDisplay(pullRequest);
  const nextStep = getPullRequestNextStep(pullRequest);
  return (
    <DetailRow icon="GitPullRequestArrow" label="Pull request">
      <span className="flex h-5 max-w-full min-w-0 items-center gap-2">
        <a
          href={pullRequest.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
          aria-label={`Pull request ${pullRequest.number}: ${describePullRequestStatus(pullRequest)}`}
          className="flex min-w-0 items-center gap-2 text-xs text-foreground no-underline transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <GithubFaviconIcon />
          <span className="shrink-0 text-muted-foreground">
            #{pullRequest.number}
          </span>
          <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-1.5 text-muted-foreground">
            <PullRequestStateIcon
              pullRequest={pullRequest}
              className="size-3.5"
            />
            <span>{stateDisplay.label}</span>
          </span>
          {nextStep ? <PullRequestNextStepLabel nextStep={nextStep} /> : null}
        </a>
        {isPullRequestAutoMergeOn(pullRequest) ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="img"
                aria-label="Auto-merge on"
                className="flex shrink-0 items-center text-subtle-foreground"
              >
                <Icon name="Zap" className="size-3" aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent>Auto-merge on</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
    </DetailRow>
  );
}

export function PullRequestInfoRow({
  environment,
}: ExperimentalThreadInfoProps) {
  const { pullRequest } = useEnvironmentPullRequest(environment?.id ?? null);
  return pullRequest ? <PullRequestRow pullRequest={pullRequest} /> : null;
}
