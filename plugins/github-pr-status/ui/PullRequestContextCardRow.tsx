import {
  experimental_copyToClipboard as copyToClipboard,
  experimental_ThreadContextCardRow as ThreadContextCardRow,
  useBbNavigate,
  useSettings,
  type ExperimentalThreadContextCardProps,
} from "@get-bb/plugin-sdk/app";
import { useRef, useState } from "react";
import {
  getThreadContextCardMenuOffsets,
  type ThreadContextCardMenuOffsets,
  THREAD_CONTEXT_CARD_MENU_CONTENT_CLASS,
  THREAD_CONTEXT_CARD_MENU_TRIGGER_CLASS,
} from "@bb/shared-ui/chrome-style-tokens";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import {
  SHOW_PULL_REQUEST_SETTING,
  type PullRequest,
  type PullRequestMergeMethod,
} from "../contract";
import {
  describePullRequestStatus,
  getPullRequestGithubCheckStatus,
} from "./display";
import { GithubFaviconIcon } from "./GithubFaviconIcon";
import {
  MERGE_ACTIONS,
  PullRequestSummaryLabel,
} from "./PullRequestContextSegment";
import { useEnvironmentPullRequest, usePullRequestActions } from "./queries";

export interface PullRequestRowHandlers {
  isPending: boolean;
  onOpen(): void;
  onCopyLink(): void;
  onMarkReady(): void;
  onMarkDraft(): void;
  onMerge(method: PullRequestMergeMethod): void;
}

function PullRequestRowMenu({
  pullRequest,
  handlers,
}: {
  pullRequest: PullRequest;
  handlers: PullRequestRowHandlers;
}) {
  const canMerge =
    pullRequest.state === "open" &&
    pullRequest.mergeability.state === "mergeable";
  const canChangeStatus =
    pullRequest.state === "open" || pullRequest.state === "draft";
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [offsets, setOffsets] = useState<ThreadContextCardMenuOffsets>({
    sideOffset: 0,
    alignOffset: 0,
  });
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && triggerRef.current !== null) {
          setOffsets(getThreadContextCardMenuOffsets(triggerRef.current));
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label="Pull request actions"
          className={THREAD_CONTEXT_CARD_MENU_TRIGGER_CLASS}
        >
          <Icon name="MoreHorizontal" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        alignOffset={offsets.alignOffset}
        sideOffset={offsets.sideOffset}
        className={THREAD_CONTEXT_CARD_MENU_CONTENT_CLASS}
        mobileTitle={`PR #${pullRequest.number}`}
      >
        <DropdownMenuItem textValue="Open on GitHub" onSelect={handlers.onOpen}>
          <Icon name="ExternalLink" />
          Open on GitHub
        </DropdownMenuItem>
        <DropdownMenuItem textValue="Copy link" onSelect={handlers.onCopyLink}>
          <Icon name="Link" />
          Copy link
        </DropdownMenuItem>
        {canMerge ? (
          <>
            <DropdownMenuSeparator />
            {MERGE_ACTIONS.map((action) => (
              <DropdownMenuItem
                key={action.method}
                textValue={action.label}
                disabled={handlers.isPending}
                onSelect={() => handlers.onMerge(action.method)}
              >
                <Icon name="GitMerge" />
                {action.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {canChangeStatus ? (
          <>
            <DropdownMenuSeparator />
            {pullRequest.state === "draft" ? (
              <DropdownMenuItem
                textValue="Mark ready for review"
                disabled={handlers.isPending}
                onSelect={handlers.onMarkReady}
              >
                <Icon name="GitPullRequestArrow" />
                Mark ready for review
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                textValue="Convert to draft"
                disabled={handlers.isPending}
                onSelect={handlers.onMarkDraft}
              >
                <Icon name="GitPullRequestDraft" />
                Convert to draft
              </DropdownMenuItem>
            )}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PullRequestContextCardRowView({
  pullRequest,
  handlers,
}: {
  pullRequest: PullRequest;
  handlers: PullRequestRowHandlers;
}) {
  return (
    <ThreadContextCardRow
      leading={
        <GithubFaviconIcon
          status={getPullRequestGithubCheckStatus(pullRequest)}
          className="size-3.5"
        />
      }
      label={
        <span className="flex min-w-0 items-center gap-1.5">
          <PullRequestSummaryLabel
            pullRequest={pullRequest}
            showState
            hideNumberWhenCompact={false}
          />
        </span>
      }
      title={`${pullRequest.title} (${describePullRequestStatus(pullRequest)})`}
      onClick={handlers.onOpen}
      action={
        <PullRequestRowMenu pullRequest={pullRequest} handlers={handlers} />
      }
    />
  );
}

function PullRequestRow({
  environmentId,
  pullRequest,
}: {
  environmentId: string;
  pullRequest: PullRequest;
}) {
  const navigate = useBbNavigate();
  const actions = usePullRequestActions(environmentId);
  return (
    <PullRequestContextCardRowView
      pullRequest={pullRequest}
      handlers={{
        isPending: actions.isPending,
        onOpen: () => {
          if (!navigate.openUrl(pullRequest.url)) {
            window.open(pullRequest.url, "_blank", "noopener,noreferrer");
          }
        },
        onCopyLink: () => void copyToClipboard({ text: pullRequest.url }),
        onMarkReady: () => void actions.markReady(),
        onMarkDraft: () => void actions.markDraft(),
        onMerge: (method) => void actions.merge(method),
      }}
    />
  );
}

export function PullRequestContextCardRow({
  environment,
}: ExperimentalThreadContextCardProps) {
  const show = useSettings().values?.[SHOW_PULL_REQUEST_SETTING] === true;
  const environmentId = show ? (environment?.id ?? null) : null;
  const { pullRequest } = useEnvironmentPullRequest(environmentId);
  if (environmentId === null || pullRequest === null) return null;
  return (
    <PullRequestRow environmentId={environmentId} pullRequest={pullRequest} />
  );
}
