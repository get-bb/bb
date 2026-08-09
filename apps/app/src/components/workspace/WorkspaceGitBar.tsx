import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import type { WorkspaceStatus } from "@bb/domain";
import type {
  EnvironmentPullRequestResponse,
  PullRequestMergeMethod,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { SplitButton } from "@/components/ui/split-button.js";
import {
  DEFAULT_PULL_REQUEST_AGENT_PROMPT,
  DEFAULT_DRAFT_PULL_REQUEST_AGENT_PROMPT,
  WorkspacePullRequestAgentDialog,
  type StartPullRequestAgentRequest,
  type WorkspacePullRequestAgentConfig,
  type WorkspacePullRequestDraft,
} from "./WorkspacePullRequestAgentDialog";

type PullRequestPendingAction = "merge" | null;

const PULL_REQUEST_ACTION_CLASS = "h-6 px-2 text-2xs";
const PULL_REQUEST_SPLIT_BUTTON_CLASS = "h-6 px-1.5 text-2xs";

interface WorkspacePullRequestButtonProps {
  canSpawnAgent: boolean;
  onMerge: (method: PullRequestMergeMethod) => void;
  onOpenUrl: (url: string) => void;
  onStartAgent: (request: StartPullRequestAgentRequest) => Promise<void>;
  pendingAction: PullRequestPendingAction;
  pullRequestDraft: WorkspacePullRequestDraft;
  pullRequestResponse: EnvironmentPullRequestResponse | undefined;
  repositoryUrl: string | null;
  agentConfig: WorkspacePullRequestAgentConfig | null;
  workspaceStatus: WorkspaceStatus | undefined;
}

export interface WorkspacePullRequestButtonHandle {
  openCreatePullRequest: () => void;
}

export function getGitHubRepositoryUrl(
  remoteUrl: string | null | undefined,
): string | null {
  if (!remoteUrl) return null;
  const remote = remoteUrl.trim();
  const scpMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
    remote,
  );
  if (scpMatch) {
    return `https://github.com/${scpMatch[1]}/${scpMatch[2]}`;
  }

  try {
    const parsed = new URL(remote);
    if (parsed.hostname.toLowerCase() !== "github.com") return null;
    const segments = parsed.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean);
    if (segments.length !== 2) return null;
    const repository = segments[1]?.replace(/\.git$/, "");
    if (!segments[0] || !repository) return null;
    return `https://github.com/${segments[0]}/${repository}`;
  } catch {
    return null;
  }
}

function getManualPullRequestUrl(
  repositoryUrl: string,
  workspaceStatus: WorkspaceStatus,
): string | null {
  const branch = workspaceStatus.branch.currentBranch;
  if (!branch) return null;
  const base =
    workspaceStatus.mergeBase?.mergeBaseBranch ??
    workspaceStatus.branch.defaultBranch;
  return `${repositoryUrl}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1`;
}

function ActionContent({
  icon,
  label,
}: {
  icon:
    | "ExternalLink"
    | "GitMerge"
    | "GitPullRequestArrow"
    | "GitPullRequestDraft";
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name={icon} className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export const WorkspacePullRequestButton = forwardRef<
  WorkspacePullRequestButtonHandle,
  WorkspacePullRequestButtonProps
>(function WorkspacePullRequestButton(
  {
    agentConfig,
    canSpawnAgent,
    onMerge,
    onOpenUrl,
    onStartAgent,
    pendingAction,
    pullRequestDraft,
    pullRequestResponse,
    repositoryUrl,
    workspaceStatus,
  },
  ref,
) {
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [isStartingAgent, setIsStartingAgent] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState<string | undefined>();
  const handleStartAgent = async (
    request: StartPullRequestAgentRequest,
  ): Promise<void> => {
    setIsStartingAgent(true);
    try {
      await onStartAgent(request);
      setAgentDialogOpen(false);
    } finally {
      setIsStartingAgent(false);
    }
  };

  const openAgentDialog = useCallback(
    (prompt?: string) => {
      const basePrompt = prompt ?? DEFAULT_PULL_REQUEST_AGENT_PROMPT;
      const title = pullRequestDraft.title.trim();
      const description = pullRequestDraft.description.trim();
      const draftDetails = [
        title ? `Title: ${title}` : null,
        description ? `Description:\n${description}` : null,
      ].filter((detail): detail is string => detail !== null);
      setAgentPrompt(
        draftDetails.length > 0
          ? `${basePrompt}\n\nUse these PR details from the user:\n${draftDetails.join("\n")}`
          : basePrompt,
      );
      setAgentDialogOpen(true);
    },
    [pullRequestDraft],
  );

  useImperativeHandle(
    ref,
    () => ({
      openCreatePullRequest: () => openAgentDialog(),
    }),
    [openAgentDialog],
  );

  if (pullRequestResponse === undefined) {
    return (
      <Button
        type="button"
        variant="outline"
        className={PULL_REQUEST_ACTION_CLASS}
        disabled
      >
        Checking…
      </Button>
    );
  }

  if (pullRequestResponse.outcome === "unavailable") {
    return (
      <Button
        type="button"
        variant="outline"
        className={PULL_REQUEST_ACTION_CLASS}
        disabled
      >
        Offline
      </Button>
    );
  }

  const pullRequest =
    pullRequestResponse.outcome === "available"
      ? pullRequestResponse.pullRequest
      : null;

  if (pullRequest) {
    const canMerge =
      pullRequest.state === "open" &&
      pullRequest.mergeability.state === "mergeable";
    if (!canMerge) {
      return (
        <Button
          type="button"
          variant="outline"
          className={PULL_REQUEST_ACTION_CLASS}
          onClick={() => onOpenUrl(pullRequest.url)}
        >
          <ActionContent icon="ExternalLink" label="View PR" />
        </Button>
      );
    }

    const label = pendingAction === "merge" ? "Merging…" : "Merge";
    return (
      <SplitButton
        className={PULL_REQUEST_SPLIT_BUTTON_CLASS}
        disabled={pendingAction !== null}
        primaryAction={{
          label,
          onSelect: () => onMerge("merge"),
          content: <ActionContent icon="GitMerge" label={label} />,
        }}
        secondaryActions={[
          { label: "Squash and merge", onSelect: () => onMerge("squash") },
          { label: "Rebase and merge", onSelect: () => onMerge("rebase") },
          {
            label: "Open pull request",
            onSelect: () => onOpenUrl(pullRequest.url),
            content: (
              <ActionContent icon="ExternalLink" label="Open pull request" />
            ),
          },
        ]}
        triggerLabel="More pull request actions"
        mobileTitle="Pull request actions"
      />
    );
  }

  if (!repositoryUrl || !workspaceStatus) {
    return (
      <Button
        type="button"
        variant="outline"
        className={PULL_REQUEST_ACTION_CLASS}
        disabled
      >
        Offline
      </Button>
    );
  }

  const manualUrl = getManualPullRequestUrl(repositoryUrl, workspaceStatus);
  if (!canSpawnAgent) {
    if (manualUrl) {
      return (
        <Button
          type="button"
          variant="outline"
          className={PULL_REQUEST_ACTION_CLASS}
          onClick={() => onOpenUrl(manualUrl)}
        >
          <ActionContent icon="ExternalLink" label="Create PR manually" />
        </Button>
      );
    }
    return (
      <Button
        type="button"
        variant="outline"
        className={PULL_REQUEST_ACTION_CLASS}
        disabled
      >
        Agent unavailable
      </Button>
    );
  }

  const label = "Create PR";
  const agentDialog = (
    <WorkspacePullRequestAgentDialog
      key={agentPrompt ?? "pull-request"}
      agentConfig={agentConfig}
      initialPrompt={agentPrompt}
      isSubmitting={isStartingAgent}
      onOpenChange={setAgentDialogOpen}
      onSubmit={handleStartAgent}
      open={agentDialogOpen}
    />
  );
  return (
    <>
      <SplitButton
        className={PULL_REQUEST_SPLIT_BUTTON_CLASS}
        disabled={pendingAction !== null}
        showPrimaryDivider
        primaryAction={{
          label,
          onSelect: () => openAgentDialog(),
          content: <ActionContent icon="GitPullRequestArrow" label={label} />,
        }}
        secondaryActions={[
          {
            label: "Create draft PR",
            onSelect: () =>
              openAgentDialog(DEFAULT_DRAFT_PULL_REQUEST_AGENT_PROMPT),
            content: (
              <ActionContent
                icon="GitPullRequestDraft"
                label="Create draft PR"
              />
            ),
          },
          ...(manualUrl
            ? [
                {
                  label: "Create PR manually",
                  onSelect: () => onOpenUrl(manualUrl),
                  content: (
                    <ActionContent
                      icon="ExternalLink"
                      label="Create PR manually"
                    />
                  ),
                },
              ]
            : []),
        ]}
        triggerLabel="More pull request actions"
        mobileTitle="Create pull request"
      />
      {agentDialog}
    </>
  );
});

export type { PullRequestPendingAction };
