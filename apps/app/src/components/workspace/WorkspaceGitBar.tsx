import type { WorkspaceStatus } from "@bb/domain";
import type { EnvironmentPullRequestResponse } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

interface WorkspaceGitBarProps {
  onOpenUrl: (url: string) => void;
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

function headSha(status: WorkspaceStatus | undefined): string | null {
  if (!status) return null;
  return status.checkout.kind === "branch" ||
    status.checkout.kind === "detached"
    ? status.checkout.headSha
    : null;
}

export function WorkspaceGitBar({
  onOpenUrl,
  pullRequestResponse,
  repositoryUrl,
  workspaceStatus,
}: WorkspaceGitBarProps) {
  const sha = headSha(workspaceStatus);
  const pullRequest =
    pullRequestResponse?.outcome === "available"
      ? pullRequestResponse.pullRequest
      : null;
  const remoteLabel =
    pullRequestResponse === undefined
      ? "Loading…"
      : pullRequestResponse.outcome === "unavailable"
        ? "Offline"
        : pullRequest
          ? `PR #${pullRequest.number}`
          : "No pull request";
  const githubUrl =
    pullRequest?.url ??
    (repositoryUrl && sha ? `${repositoryUrl}/commit/${sha}` : repositoryUrl);

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-seam bg-background px-3 text-xs">
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <Icon name="GitBranch" className="size-3.5" />
        <span className="font-mono text-foreground">
          {sha ? sha.slice(0, 8) : "No commit"}
        </span>
      </span>
      <span className="text-border">/</span>
      <span
        className={
          pullRequestResponse?.outcome === "unavailable"
            ? "text-muted-foreground"
            : "text-foreground"
        }
      >
        {remoteLabel}
      </span>
      {githubUrl ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1 px-2 text-xs"
          onClick={() => onOpenUrl(githubUrl)}
          aria-label={
            pullRequest
              ? `Open pull request ${pullRequest.number} in BB browser`
              : "Open current commit in BB browser"
          }
        >
          GitHub
          <Icon name="ArrowUpRight" className="size-3.5" />
        </Button>
      ) : null}
    </header>
  );
}
