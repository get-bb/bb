import type { WorkspaceStatus } from "@bb/domain";
import type {
  EnvironmentPullRequestResponse,
  PullRequestMergeMethod,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { SplitButton } from "@/components/ui/split-button.js";

type PullRequestPendingAction = "create" | "merge" | null;

interface WorkspacePullRequestButtonProps {
  onCreate: (draft: boolean) => void;
  onMerge: (method: PullRequestMergeMethod) => void;
  onOpenUrl: (url: string) => void;
  pendingAction: PullRequestPendingAction;
  pullRequestResponse: EnvironmentPullRequestResponse | undefined;
  repositoryUrl: string | null;
  workspaceStatus: WorkspaceStatus | undefined;
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
  icon: "ExternalLink" | "GitMerge" | "GitPullRequestArrow";
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name={icon} className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function WorkspacePullRequestButton({
  onCreate,
  onMerge,
  onOpenUrl,
  pendingAction,
  pullRequestResponse,
  repositoryUrl,
  workspaceStatus,
}: WorkspacePullRequestButtonProps) {
  if (pullRequestResponse === undefined) {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        Checking…
      </Button>
    );
  }

  if (pullRequestResponse.outcome === "unavailable") {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
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
          size="sm"
          onClick={() => onOpenUrl(pullRequest.url)}
        >
          <ActionContent icon="ExternalLink" label="View PR" />
        </Button>
      );
    }

    const label = pendingAction === "merge" ? "Merging…" : "Merge";
    return (
      <SplitButton
        className="h-7 px-2 text-xs"
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
      <Button type="button" variant="outline" size="sm" disabled>
        Offline
      </Button>
    );
  }

  const manualUrl = getManualPullRequestUrl(repositoryUrl, workspaceStatus);
  const label = pendingAction === "create" ? "Creating…" : "Create PR";
  return (
    <SplitButton
      className="h-7 px-2 text-xs"
      disabled={pendingAction !== null}
      primaryAction={{
        label,
        onSelect: () => onCreate(false),
        content: <ActionContent icon="GitPullRequestArrow" label={label} />,
      }}
      secondaryActions={[
        { label: "Create draft PR", onSelect: () => onCreate(true) },
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
  );
}

export type { PullRequestPendingAction };
