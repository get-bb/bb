import {
  forwardRef,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  experimental_useThreadContextKind,
  useBbNavigate,
  useSettings,
  type ExperimentalThreadContextSegmentInput,
  type ExperimentalThreadContextSegmentProps,
  type ExperimentalThreadContextSegmentReference,
} from "@get-bb/plugin-sdk/app";
import { CONTEXT_CARD_SEGMENT_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  BannerActionSlot,
  PROMPT_BANNER_ACTION_FILL_CLASS,
  PROMPT_BANNER_ACTION_SEGMENT_CLASS,
  PromptBannerActionButton,
} from "@bb/shared-ui/prompt-banner-actions";
import {
  SHOW_PULL_REQUEST_SETTING,
  type PullRequest,
  type PullRequestMergeMethod,
} from "../contract";
import {
  describePullRequestStatus,
  getPullRequestGithubCheckStatus,
  getPullRequestNextStep,
  isPullRequestAutoMergeOn,
  PULL_REQUEST_STATE_DISPLAY,
} from "./display";
import { PullRequestNextStepLabel } from "./PullRequestNextStepLabel";
import { PullRequestStatusPill } from "./PullRequestStatusPill";
import { useEnvironmentPullRequest, usePullRequestActions } from "./queries";

const CHANGED_FILES_SEGMENT_KEY = "bb--git/changed-files";

export function useOpenUrlClick(
  url: string,
): (event: MouseEvent<HTMLAnchorElement>) => void {
  const navigate = useBbNavigate();
  return (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (navigate.openUrl(url)) event.preventDefault();
  };
}

function useThreadPullRequest(
  environment: ExperimentalThreadContextSegmentInput["environment"],
): PullRequest | null {
  return useEnvironmentPullRequest(environment?.id ?? null).pullRequest;
}

export function usePullRequestSegmentVisible(
  input: ExperimentalThreadContextSegmentInput,
): boolean {
  const enabled = useSettings().values?.[SHOW_PULL_REQUEST_SETTING] === true;
  const show = enabled && experimental_useThreadContextKind() === "banner";
  return useThreadPullRequest(show ? input.environment : null) !== null;
}

function shouldShowAttentionLabel(pullRequest: PullRequest): boolean {
  if (pullRequest.attention === "checks_failed") return false;
  return (
    (pullRequest.state === "open" && pullRequest.attention === "queued") ||
    pullRequest.attention === "changes_requested" ||
    pullRequest.attention === "review_requested" ||
    pullRequest.attention === "conflicts" ||
    pullRequest.attention === "blocked"
  );
}

function isChangedFilesSegment(
  segment: ExperimentalThreadContextSegmentReference,
): boolean {
  return segment.key === CHANGED_FILES_SEGMENT_KEY;
}

export function PullRequestLink({
  pullRequest,
  segments,
}: {
  pullRequest: PullRequest;
  segments: readonly ExperimentalThreadContextSegmentReference[];
}) {
  const isAlone = segments.length === 1;
  const showLabel =
    isAlone || (segments.length === 2 && segments.some(isChangedFilesSegment));
  const handleClick = useOpenUrlClick(pullRequest.url);
  return (
    <a
      href={pullRequest.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      aria-label={`Pull request ${pullRequest.number}: ${describePullRequestStatus(pullRequest)}`}
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground no-underline transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        CONTEXT_CARD_SEGMENT_CLASS,
        getPullRequestGithubCheckStatus(pullRequest) !== null
          ? "min-w-13"
          : "min-w-8",
        "overflow-hidden",
      )}
    >
      <PullRequestStatusPill pullRequest={pullRequest} className="h-4" />
      {showLabel ? (
        <PullRequestSummaryLabel
          pullRequest={pullRequest}
          showState={isAlone}
          hideNumberWhenCompact={!isAlone}
        />
      ) : null}
    </a>
  );
}

export function PullRequestSummaryLabel({
  pullRequest,
  showState,
  hideNumberWhenCompact,
}: {
  pullRequest: PullRequest;
  showState: boolean;
  hideNumberWhenCompact: boolean;
}) {
  const nextStep = shouldShowAttentionLabel(pullRequest)
    ? getPullRequestNextStep(pullRequest)
    : null;
  const showAutoMerge =
    nextStep === null && isPullRequestAutoMergeOn(pullRequest);
  return (
    <>
      <span
        className="min-w-0 truncate"
        data-promptbox-hide-compact={hideNumberWhenCompact ? "" : undefined}
      >
        PR #{pullRequest.number}
        {showState && pullRequest.state !== "open"
          ? ` · ${PULL_REQUEST_STATE_DISPLAY[pullRequest.state].label}`
          : ""}
      </span>
      {nextStep ? (
        <>
          <span aria-hidden>·</span>
          <PullRequestNextStepLabel nextStep={nextStep} />
        </>
      ) : null}
      {showAutoMerge ? (
        <>
          <span aria-hidden>·</span>
          <span className="shrink-0">Auto-merge</span>
        </>
      ) : null}
    </>
  );
}

export const MERGE_ACTIONS: readonly {
  method: PullRequestMergeMethod;
  label: string;
}[] = [
  { method: "merge", label: "Merge" },
  { method: "squash", label: "Squash merge" },
  { method: "rebase", label: "Rebase and merge" },
];

function ActionGroup({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "inline-flex overflow-hidden rounded border border-border",
        PROMPT_BANNER_ACTION_FILL_CLASS,
      )}
    >
      {children}
    </div>
  );
}

const ActionSegmentButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function ActionSegmentButton({ className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "px-1.5 py-0.5",
        PROMPT_BANNER_ACTION_SEGMENT_CLASS,
        className,
      )}
      {...props}
    />
  );
});

function MergeSplitButton({
  disabled,
  onConvertToDraft,
  onMerge,
  selectedMethod,
}: {
  disabled: boolean;
  onConvertToDraft: () => void;
  onMerge: (method: PullRequestMergeMethod) => void;
  selectedMethod: PullRequestMergeMethod;
}) {
  const selectedAction =
    MERGE_ACTIONS.find((action) => action.method === selectedMethod) ??
    MERGE_ACTIONS[0];
  return (
    <ActionGroup>
      <ActionSegmentButton
        disabled={disabled}
        onClick={() => onMerge(selectedAction.method)}
      >
        {selectedAction.label}
      </ActionSegmentButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ActionSegmentButton
            disabled={disabled}
            className="inline-flex items-center border-l border-border px-1 data-[state=open]:bg-state-active data-[state=open]:text-foreground"
            aria-label="Choose pull request merge method"
          >
            <Icon name="ChevronDown" className="size-3" aria-hidden="true" />
          </ActionSegmentButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={2}
          mobileTitle="Merge pull request"
        >
          {MERGE_ACTIONS.map((action) => (
            <DropdownMenuItem
              key={action.method}
              onSelect={() => onMerge(action.method)}
              textValue={action.label}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={onConvertToDraft}
            textValue="Convert to draft"
          >
            Convert to draft
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ActionGroup>
  );
}

export function PullRequestActionButtons({
  pullRequest,
  isPending,
  mergeMethod,
  onMarkReady,
  onMerge,
  onConvertToDraft,
}: {
  pullRequest: PullRequest;
  isPending: boolean;
  mergeMethod: PullRequestMergeMethod;
  onMarkReady: () => void;
  onMerge: (method: PullRequestMergeMethod) => void;
  onConvertToDraft: () => void;
}) {
  if (pullRequest.state === "draft") {
    return (
      <BannerActionSlot>
        <PromptBannerActionButton onClick={onMarkReady} disabled={isPending}>
          {isPending ? "Marking..." : "Mark ready"}
        </PromptBannerActionButton>
      </BannerActionSlot>
    );
  }
  if (
    pullRequest.state === "open" &&
    pullRequest.mergeability.state === "mergeable"
  ) {
    return (
      <BannerActionSlot>
        <MergeSplitButton
          disabled={isPending}
          onConvertToDraft={onConvertToDraft}
          onMerge={onMerge}
          selectedMethod={mergeMethod}
        />
      </BannerActionSlot>
    );
  }
  return null;
}

function PullRequestAction({
  environmentId,
  pullRequest,
}: {
  environmentId: string;
  pullRequest: PullRequest;
}) {
  const actions = usePullRequestActions(environmentId);
  return (
    <PullRequestActionButtons
      pullRequest={pullRequest}
      isPending={actions.isPending}
      mergeMethod={actions.mergeMethod}
      onMarkReady={() => void actions.markReady()}
      onMerge={(method) => void actions.merge(method)}
      onConvertToDraft={() => void actions.markDraft()}
    />
  );
}

export function PullRequestSegmentSummary({
  environment,
  segments,
}: ExperimentalThreadContextSegmentProps) {
  const pullRequest = useThreadPullRequest(environment);
  if (pullRequest === null) return null;
  return <PullRequestLink pullRequest={pullRequest} segments={segments} />;
}

export function PullRequestSegmentAction({
  environment,
}: ExperimentalThreadContextSegmentProps) {
  const pullRequest = useThreadPullRequest(environment);
  if (environment === null || pullRequest === null) return null;
  return (
    <PullRequestAction
      environmentId={environment.id}
      pullRequest={pullRequest}
    />
  );
}
