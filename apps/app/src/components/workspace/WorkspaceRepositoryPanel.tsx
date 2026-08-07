import { useEffect, useRef, useState } from "react";
import type {
  GitHostPullRequestCheck,
  ThreadPullRequest,
  WorkspaceFileStatus,
  WorkspaceStatus,
} from "@bb/domain";
import type { EnvironmentPullRequestResponse } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { selectWorkspaceChangedFilesSections } from "./workspace-change-summary";
import { WorkspaceFileTree } from "./file-tree/WorkspaceFileTree";
import { useWorkspaceFileTree } from "./file-tree/useWorkspaceFileTree";

export type WorkspaceUpperTabId = "all-files" | "changes" | "checks";

interface WorkspaceRepositoryPanelProps {
  activeTab: WorkspaceUpperTabId;
  environmentId: string | null | undefined;
  onOpenAllChanges: () => void;
  onOpenChangedFile: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenUrl: (url: string) => void;
  pullRequestResponse: EnvironmentPullRequestResponse | undefined;
  workspaceStatus: WorkspaceStatus | undefined;
}

function changePresentation(file: WorkspaceFileStatus) {
  if (file.status === "A" || file.status === "??") {
    return { label: "Added", className: "bg-success" };
  }
  if (file.status === "D") {
    return { label: "Deleted", className: "bg-destructive" };
  }
  return { label: "Modified", className: "bg-warning" };
}

function ChangesPanel({
  onOpenAllChanges,
  onOpenChangedFile,
  workspaceStatus,
}: Pick<
  WorkspaceRepositoryPanelProps,
  "onOpenAllChanges" | "onOpenChangedFile" | "workspaceStatus"
>) {
  const sections = selectWorkspaceChangedFilesSections(workspaceStatus);
  const files = sections.flatMap((section) => section.files);
  return (
    <div className="h-full overflow-y-auto p-2">
      <Button
        type="button"
        variant="ghost"
        className="h-8 w-full justify-between px-2 text-xs font-semibold"
        onClick={onOpenAllChanges}
      >
        <span>All changes</span>
        <span className="text-muted-foreground">{files.length}</span>
      </Button>
      {files.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
          No changes
        </p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {files.map((file) => {
            const presentation = changePresentation(file);
            return (
              <li key={`${file.path}:${file.status}`}>
                <button
                  type="button"
                  className="flex h-7 w-full min-w-0 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent"
                  onClick={() => onOpenChangedFile(file.path)}
                >
                  <span className="min-w-0 flex-1 truncate">{file.path}</span>
                  <span
                    className="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground"
                    aria-label={presentation.label}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 rounded-full",
                        presentation.className,
                      )}
                    />
                    {presentation.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CheckIcon({ check }: { check: GitHostPullRequestCheck }) {
  const successful =
    check.conclusion === "success" ||
    check.conclusion === "neutral" ||
    check.conclusion === "skipped";
  const failed = check.status === "completed" && !successful;
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 rounded-full",
        successful ? "bg-success" : failed ? "bg-destructive" : "bg-warning",
      )}
    />
  );
}

function PullRequestChecks({
  pullRequest,
  onOpenUrl,
}: {
  pullRequest: ThreadPullRequest;
  onOpenUrl: (url: string) => void;
}) {
  return (
    <div className="space-y-3">
      <section>
        <h3 className="mb-1 px-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Comments
        </h3>
        {pullRequest.comments.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No comments</p>
        ) : (
          <ul className="space-y-1">
            {pullRequest.comments.map((comment, index) => (
              <li key={`${comment.createdAt}:${comment.authorLogin}:${index}`}>
                <button
                  type="button"
                  disabled={!comment.url}
                  onClick={() => comment.url && onOpenUrl(comment.url)}
                  className="flex w-full min-w-0 items-start gap-2 rounded px-2 py-1 text-left hover:bg-accent disabled:pointer-events-none"
                >
                  {comment.authorAvatarUrl ? (
                    <img
                      src={comment.authorAvatarUrl}
                      alt=""
                      className="mt-0.5 size-4 shrink-0 rounded-full"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-[9px]"
                    >
                      {comment.authorLogin.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <p className="line-clamp-2 min-w-0 text-xs leading-4">
                    <strong className="mr-1 font-medium">
                      {comment.authorLogin}
                    </strong>
                    <span className="text-muted-foreground">
                      {comment.bodySummary}
                    </span>
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-1 px-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          CI/CD checks
        </h3>
        {pullRequest.checkItems.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No checks</p>
        ) : (
          <ul className="space-y-0.5">
            {pullRequest.checkItems.map((check, index) => (
              <li key={`${check.name}:${index}`}>
                <button
                  type="button"
                  disabled={!check.url}
                  onClick={() => check.url && onOpenUrl(check.url)}
                  className="flex h-7 w-full min-w-0 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent disabled:pointer-events-none"
                >
                  <CheckIcon check={check} />
                  <span className="min-w-0 flex-1 truncate">{check.name}</span>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {check.conclusion ?? check.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ChecksPanel({
  onOpenUrl,
  pullRequestResponse,
  workspaceStatus,
}: Pick<
  WorkspaceRepositoryPanelProps,
  "onOpenUrl" | "pullRequestResponse" | "workspaceStatus"
>) {
  const commits = workspaceStatus?.mergeBase?.commits ?? [];
  const currentCommit = commits[commits.length - 1];
  const branchName =
    workspaceStatus?.checkout.kind === "branch"
      ? workspaceStatus.checkout.branchName
      : workspaceStatus?.checkout.kind === "detached"
        ? "Detached HEAD"
        : "No branch";
  const checkoutSha =
    workspaceStatus?.checkout.kind === "branch" ||
    workspaceStatus?.checkout.kind === "detached"
      ? workspaceStatus.checkout.headSha
      : null;
  const commitSha = currentCommit?.shortSha ?? checkoutSha?.slice(0, 8) ?? "—";
  const gitStatus = workspaceStatus?.workingTree.hasUncommittedChanges
    ? "Uncommitted changes"
    : workspaceStatus
      ? "Committed"
      : "Git status unavailable";
  return (
    <div className="h-full overflow-y-auto p-2">
      <div className="mb-3 border-b border-border-seam px-2 pb-2">
        <h2 className="truncate text-xs font-semibold">
          {currentCommit?.subject ?? "Current commit"}
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-2xs">
          <dt className="text-muted-foreground">Branch</dt>
          <dd className="truncate font-mono text-foreground">{branchName}</dd>
          <dt className="text-muted-foreground">Commit</dt>
          <dd className="font-mono text-foreground">{commitSha}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="text-foreground">{gitStatus}</dd>
        </dl>
      </div>
      {pullRequestResponse?.outcome === "unavailable" ? (
        <p className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <Icon name="AlertCircle" className="size-3.5" />
          Offline
        </p>
      ) : pullRequestResponse?.outcome === "absent" ? (
        <p className="px-2 text-xs text-muted-foreground">No pull request</p>
      ) : pullRequestResponse?.outcome === "available" ? (
        <PullRequestChecks
          pullRequest={pullRequestResponse.pullRequest}
          onOpenUrl={onOpenUrl}
        />
      ) : (
        <p className="px-2 text-xs text-muted-foreground">Loading checks…</p>
      )}
    </div>
  );
}

export function WorkspaceRepositoryPanel(props: WorkspaceRepositoryPanelProps) {
  const [fileTreeActivated, setFileTreeActivated] = useState(
    props.activeTab === "all-files",
  );
  useEffect(() => {
    if (props.activeTab === "all-files") setFileTreeActivated(true);
  }, [props.activeTab]);
  const tree = useWorkspaceFileTree({
    environmentId: fileTreeActivated ? props.environmentId : null,
    onSelectFile: props.onOpenFile,
  });
  const treeRevision = JSON.stringify({
    checkout: props.workspaceStatus?.checkout ?? null,
    files: props.workspaceStatus?.workingTree.files.map(({ path, status }) => ({
      path,
      status,
    })),
  });
  const previousTreeRevisionRef = useRef(treeRevision);
  useEffect(() => {
    if (fileTreeActivated && previousTreeRevisionRef.current !== treeRevision) {
      previousTreeRevisionRef.current = treeRevision;
      tree.refresh();
    }
  }, [fileTreeActivated, tree, treeRevision]);
  if (props.activeTab === "all-files")
    return <WorkspaceFileTree controller={tree} />;
  if (props.activeTab === "changes") return <ChangesPanel {...props} />;
  return <ChecksPanel {...props} />;
}
