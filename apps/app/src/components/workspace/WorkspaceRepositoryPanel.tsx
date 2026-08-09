import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  GitHostPullRequestCheck,
  ThreadPullRequest,
  WorkspaceFileStatus,
  WorkspaceStatus,
} from "@bb/domain";
import type { EnvironmentPullRequestResponse } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import { Textarea } from "@bb/shared-ui/textarea";
import type { WorkspacePullRequestDraft } from "./WorkspacePullRequestAgentDialog";
import { selectWorkspaceChangedFilesSections } from "./workspace-change-summary";
import { WorkspaceFileTree } from "./file-tree/WorkspaceFileTree";
import { useWorkspaceFileTree } from "./file-tree/useWorkspaceFileTree";

export type WorkspaceUpperTabId = "all-files" | "changes" | "checks";

const GIT_STATUS_ACTION_CLASS =
  "shrink-0 cursor-pointer text-xs text-muted-foreground/60 transition-colors duration-150 hover:text-foreground focus-visible:text-foreground focus-visible:underline focus-visible:outline-none";

interface WorkspaceRepositoryPanelProps {
  activeTab: WorkspaceUpperTabId;
  environmentId: string | null | undefined;
  onCommitAndPush: () => void;
  onCreatePullRequest: () => void;
  onOpenAllChanges: () => void;
  onOpenChangedFile: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenUrl: (url: string) => void;
  onDiscardPullRequestDraft: () => void;
  onPullRequestDraftChange: (draft: WorkspacePullRequestDraft) => void;
  onSavePullRequestDraft: () => void;
  pullRequestDraft: WorkspacePullRequestDraft;
  pullRequestDraftIsDirty: boolean;
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

function GitStatusRow({
  action,
  children,
}: {
  action?: string | { label: string; onClick: () => void };
  children: ReactNode;
}) {
  const actionLabel = typeof action === "string" ? action : action?.label;
  return (
    <li className="flex min-h-8 items-center gap-2 text-sm">
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-full border border-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {typeof action === "object" ? (
        <button
          type="button"
          className={GIT_STATUS_ACTION_CLASS}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : actionLabel ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {actionLabel}
        </span>
      ) : null}
    </li>
  );
}

function ChecksPanel({
  onCommitAndPush,
  onCreatePullRequest,
  onDiscardPullRequestDraft,
  onOpenUrl,
  onPullRequestDraftChange,
  onSavePullRequestDraft,
  pullRequestDraft,
  pullRequestDraftIsDirty,
  pullRequestResponse,
  workspaceStatus,
}: Pick<
  WorkspaceRepositoryPanelProps,
  | "onCommitAndPush"
  | "onCreatePullRequest"
  | "onDiscardPullRequestDraft"
  | "onOpenUrl"
  | "onPullRequestDraftChange"
  | "onSavePullRequestDraft"
  | "pullRequestDraft"
  | "pullRequestDraftIsDirty"
  | "pullRequestResponse"
  | "workspaceStatus"
>) {
  const uncommittedChangeCount = workspaceStatus?.workingTree.files.length ?? 0;
  const behindCount = workspaceStatus?.mergeBase?.behindCount ?? 0;
  const mergeBaseBranch = workspaceStatus?.mergeBase?.mergeBaseBranch;

  return (
    <div className="h-full overflow-y-auto">
      {pullRequestResponse?.outcome === "absent" ? (
        <section
          aria-label="Pull request preparation"
          className="space-y-0.5 px-3 pb-3 pt-4"
        >
          <Input
            aria-label="PR title"
            className={cn(
              "h-7 border-0 px-0 py-0 text-base shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0",
              pullRequestDraft.title.trim().length > 0
                ? "text-foreground"
                : "text-muted-foreground/60",
            )}
            onChange={(event) =>
              onPullRequestDraftChange({
                ...pullRequestDraft,
                title: event.target.value,
              })
            }
            placeholder="PR title"
            value={pullRequestDraft.title}
          />
          <Textarea
            aria-label="PR description"
            className="min-h-0 resize-none border-0 px-0 py-0 text-xs leading-5 text-muted-foreground/60 shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
            onChange={(event) =>
              onPullRequestDraftChange({
                ...pullRequestDraft,
                description: event.target.value,
              })
            }
            placeholder="PR description"
            rows={2}
            value={pullRequestDraft.description}
          />
          <div
            aria-label="Pull request draft actions"
            className="flex h-8 items-start justify-end gap-1 pt-2"
          >
            {pullRequestDraftIsDirty ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-6 px-2 text-2xs"
                  onClick={onDiscardPullRequestDraft}
                >
                  Discard
                </Button>
                <Button
                  type="button"
                  className="h-6 px-2 text-2xs"
                  onClick={onSavePullRequestDraft}
                >
                  Save
                </Button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}
      <section className="px-3 py-3">
        <p className="mb-3 text-sm font-medium text-muted-foreground">
          Git status
        </p>
        <ul className="space-y-2">
          <li className="flex min-h-8 items-center gap-2 text-sm">
            <span
              aria-hidden
              className={cn(
                "size-3 shrink-0 rounded-full border",
                pullRequestResponse?.outcome === "available"
                  ? pullRequestResponse.pullRequest.state === "open"
                    ? "border-success bg-success"
                    : "border-muted-foreground"
                  : "border-muted-foreground",
              )}
            />
            <span className="min-w-0 flex-1 truncate">
              {pullRequestResponse?.outcome === "unavailable" ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Icon name="AlertCircle" className="size-3.5" />
                  Offline
                </span>
              ) : pullRequestResponse?.outcome === "available" ? (
                <button
                  type="button"
                  className="min-w-0 max-w-full truncate text-left hover:underline"
                  onClick={() => onOpenUrl(pullRequestResponse.pullRequest.url)}
                >
                  #{pullRequestResponse.pullRequest.number} ·{" "}
                  {pullRequestResponse.pullRequest.title}
                </button>
              ) : pullRequestResponse?.outcome === "absent" ? (
                "No PR open"
              ) : (
                <span className="text-muted-foreground">Checking PR…</span>
              )}
            </span>
            {pullRequestResponse?.outcome === "absent" ? (
              <button
                type="button"
                className={GIT_STATUS_ACTION_CLASS}
                onClick={onCreatePullRequest}
              >
                Create PR
              </button>
            ) : null}
          </li>
          {uncommittedChangeCount > 0 ? (
            <GitStatusRow
              action={{ label: "Commit and push", onClick: onCommitAndPush }}
            >
              {uncommittedChangeCount} uncommitted change
              {uncommittedChangeCount === 1 ? "" : "s"}
            </GitStatusRow>
          ) : null}
          {behindCount > 0 && mergeBaseBranch ? (
            <GitStatusRow action="Pull">
              {behindCount} commit{behindCount === 1 ? "" : "s"} behind{" "}
              {mergeBaseBranch}
            </GitStatusRow>
          ) : null}
        </ul>
      </section>

      {pullRequestResponse?.outcome === "available" ? (
        <div className="border-t border-border-seam px-2 py-3">
          <PullRequestChecks
            pullRequest={pullRequestResponse.pullRequest}
            onOpenUrl={onOpenUrl}
          />
        </div>
      ) : null}
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
