import { memo, useCallback, type ReactNode } from "react";
import type { ThreadGitDiffResponse } from "@bb/domain";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { useEnvironmentFilePreview } from "@/hooks/queries/environment-queries";
import {
  useThreadHostFilePreview,
  useThreadStorageFilePreview,
} from "@/hooks/queries/thread-queries";
import {
  buildRawFilesystemHtmlContentUrl,
  buildThreadWorktreeRawContentUrl,
} from "@/lib/file-content-urls";
import type {
  EnvironmentFilePreviewSource,
  FilePreviewLineRange,
  WorkspaceFilePreviewStatusLabel,
} from "@/lib/file-preview";
import { describeLifecycleError } from "@/lib/lifecycle-errors";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { cn } from "@/lib/utils";
import {
  GitDiffCard,
  type RequestDiffFileContents,
} from "../git-diff/GitDiffCard";
import type { ParsedGitDiffFile } from "../git-diff/git-diff-parsing";
import {
  SecondaryPanelFilePreview,
  ThreadStorageFilePreview,
} from "./ThreadStorageFilePreview";

const GIT_DIFF_SKELETON_FILE_COUNT = 3;
const PANEL_SCROLL_SLOT_CLASS =
  "min-h-0 flex-1 overflow-x-hidden overflow-y-auto";

interface ThreadDiffSkeletonProps {
  count?: number;
}

interface GitDiffFileCardContainerProps {
  fileDiff: ParsedGitDiffFile;
  fileKey: string;
  diffViewOptions: Record<string, string | boolean | number>;
  filePathRoot?: string | null;
  isCollapsed: boolean;
  isRendering: boolean;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onRequestFileContents?: RequestDiffFileContents;
  setGitDiffFileRef: (fileKey: string, element: HTMLDivElement | null) => void;
  toggleGitDiffFileCollapsed: (fileKey: string) => void;
}

export interface ParsedGitDiffFileEntry {
  fileDiff: ParsedGitDiffFile;
  key: string;
}

export interface GitDiffTabContentProps {
  collapsedGitDiffFileKeys: ReadonlySet<string>;
  currentGitDiff: string;
  gitDiffError: Error | null;
  gitDiffUnavailableMessage: string | null;
  gitDiffViewOptions: Record<string, string | boolean | number>;
  isParsingGitDiffFiles: boolean;
  isPreparingGitDiff: boolean;
  loadingGitDiffFileKeys: ReadonlySet<string>;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onRequestFileContents?: RequestDiffFileContents;
  parsedGitDiffFileEntries: readonly ParsedGitDiffFileEntry[];
  queuedGitDiffFileRenderKeys: ReadonlySet<string>;
  setGitDiffFileRef: (fileKey: string, element: HTMLDivElement | null) => void;
  threadGitDiff?: ThreadGitDiffResponse;
  toggleGitDiffFileCollapsed: (fileKey: string) => void;
  workspaceRootPath?: string | null;
}

export interface ThreadInfoTabContentProps {
  metadataContent: ReactNode;
}

export interface WorkspaceFilePreviewTabContentProps {
  activePath: string;
  copyPath?: string | null;
  environmentId?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onOpenInEditor?: (path: string) => void;
  source: EnvironmentFilePreviewSource | null;
  statusLabel: WorkspaceFilePreviewStatusLabel | null;
  threadId: string;
}

export interface HostFilePreviewTabContentProps {
  activePath: string;
  environmentId?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onOpenInEditor?: (path: string) => void;
  threadId: string;
}

export interface ThreadStorageFilePreviewTabContentProps {
  activePath: string;
  copyPath?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onOpenInEditor?: (path: string) => void;
  threadId: string;
}

function ThreadDiffSkeleton({
  count = GIT_DIFF_SKELETON_FILE_COUNT,
}: ThreadDiffSkeletonProps) {
  return (
    <div className="space-y-2 pt-2">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={`git-diff-skeleton-${index}`}
          className="rounded-lg border border-border bg-surface-raised"
        >
          <div className="border-b border-border bg-surface-recessed px-3 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <Skeleton className="h-3 w-48 max-w-full rounded-sm" />
              </div>
              <Skeleton className="h-3 w-14 shrink-0 rounded-sm" />
            </div>
          </div>
          <div className="space-y-1.5 px-2.5 py-2">
            <Skeleton className="h-3 w-full rounded-sm" />
            <Skeleton className="h-3 w-[94%] rounded-sm" />
            <Skeleton className="h-3 w-[90%] rounded-sm" />
            <Skeleton className="h-3 w-[86%] rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}

const GitDiffFileCardContainer = memo(function GitDiffFileCardContainer({
  fileKey,
  fileDiff,
  diffViewOptions,
  filePathRoot,
  onOpenFileInEditor,
  onOpenFilePreview,
  isCollapsed,
  isRendering,
  setGitDiffFileRef,
  toggleGitDiffFileCollapsed,
  onRequestFileContents,
}: GitDiffFileCardContainerProps) {
  const handleToggleCollapsed = useCallback(() => {
    toggleGitDiffFileCollapsed(fileKey);
  }, [fileKey, toggleGitDiffFileCollapsed]);
  const handleCardRef = useCallback(
    (element: HTMLDivElement | null) => {
      setGitDiffFileRef(fileKey, element);
    },
    [fileKey, setGitDiffFileRef],
  );

  return (
    <GitDiffCard
      fileDiff={fileDiff}
      diffViewOptions={diffViewOptions}
      filePathRoot={filePathRoot}
      onOpenFileInEditor={onOpenFileInEditor}
      onOpenFilePreview={onOpenFilePreview}
      isCollapsed={isCollapsed}
      onToggleCollapsed={handleToggleCollapsed}
      stickyHeader
      isRendering={isRendering}
      cardRef={handleCardRef}
      onRequestFileContents={onRequestFileContents}
    />
  );
});

export function GitDiffTabContent({
  collapsedGitDiffFileKeys,
  currentGitDiff,
  gitDiffError,
  gitDiffUnavailableMessage,
  gitDiffViewOptions,
  isParsingGitDiffFiles,
  isPreparingGitDiff,
  loadingGitDiffFileKeys,
  onOpenFileInEditor,
  onOpenFilePreview,
  onRequestFileContents,
  parsedGitDiffFileEntries,
  queuedGitDiffFileRenderKeys,
  setGitDiffFileRef,
  threadGitDiff,
  toggleGitDiffFileCollapsed,
  workspaceRootPath,
}: GitDiffTabContentProps) {
  const hasCurrentGitDiff = currentGitDiff.trim().length > 0;
  const gitDiffLifecycleErrorDescription = gitDiffError
    ? describeLifecycleError({
        error: gitDiffError,
        operation: "load_diff",
      })
    : null;
  const gitDiffErrorMessage =
    gitDiffLifecycleErrorDescription?.body ??
    (gitDiffError
      ? getMutationErrorMessage({
          error: gitDiffError,
          fallbackMessage: "Failed to load git diff",
          lifecycleOperation: "load_diff",
        })
      : null);
  return (
    <div className={cn(PANEL_SCROLL_SLOT_CLASS, "px-4 pb-3")}>
      {isPreparingGitDiff ? (
        <ThreadDiffSkeleton />
      ) : gitDiffError ? (
        <div
          className={cn(
            "rounded-lg border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-destructive",
            COARSE_POINTER_TEXT_SM_CLASS,
          )}
        >
          {gitDiffLifecycleErrorDescription ? (
            <p className="font-medium">
              {gitDiffLifecycleErrorDescription.title}
            </p>
          ) : null}
          <p
            className={
              gitDiffLifecycleErrorDescription ? "mt-1 leading-5" : undefined
            }
          >
            {gitDiffErrorMessage}
          </p>
        </div>
      ) : gitDiffUnavailableMessage ? (
        <div
          className={cn(
            "rounded-lg border border-border bg-surface-raised px-3 py-2 text-muted-foreground",
            COARSE_POINTER_TEXT_SM_CLASS,
          )}
        >
          <p className="font-medium text-foreground">Workspace unavailable</p>
          <p className="mt-1 leading-5">{gitDiffUnavailableMessage}</p>
        </div>
      ) : threadGitDiff && hasCurrentGitDiff ? (
        <>
          {parsedGitDiffFileEntries.length > 0 ? (
            <div className="space-y-2">
              {parsedGitDiffFileEntries.map(({ key, fileDiff }) => {
                const isCollapsed = collapsedGitDiffFileKeys.has(key);
                const hasQueuedFileRender =
                  queuedGitDiffFileRenderKeys.has(key);
                const isRendering =
                  !hasQueuedFileRender || loadingGitDiffFileKeys.has(key);

                return (
                  <GitDiffFileCardContainer
                    key={key}
                    fileKey={key}
                    fileDiff={fileDiff}
                    diffViewOptions={gitDiffViewOptions}
                    filePathRoot={workspaceRootPath}
                    onOpenFileInEditor={onOpenFileInEditor}
                    onOpenFilePreview={onOpenFilePreview}
                    isCollapsed={isCollapsed}
                    isRendering={isRendering}
                    setGitDiffFileRef={setGitDiffFileRef}
                    toggleGitDiffFileCollapsed={toggleGitDiffFileCollapsed}
                    onRequestFileContents={onRequestFileContents}
                  />
                );
              })}
              {isParsingGitDiffFiles ? (
                <div className="rounded-lg border border-border bg-surface-raised px-3 py-3">
                  <div className="space-y-1.5">
                    <Skeleton className="h-3 w-52 max-w-full rounded-sm" />
                    <Skeleton className="h-3 w-5/6 rounded-sm" />
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <pre className="overflow-auto whitespace-pre rounded-lg border border-border bg-surface-raised p-3 font-mono text-xs text-foreground">
              {threadGitDiff.diff}
            </pre>
          )}
          {threadGitDiff.truncated ? (
            <p
              className={cn(
                "pt-2 text-muted-foreground",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
            >
              Diff output was truncated for display.
            </p>
          ) : null}
        </>
      ) : (
        <EmptyStatePanel className="rounded-lg">
          No diff to display.
        </EmptyStatePanel>
      )}
    </div>
  );
}

export function ThreadInfoTabContent({
  metadataContent,
}: ThreadInfoTabContentProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col pb-3">
      {metadataContent}
    </div>
  );
}

export function WorkspaceFilePreviewTabContent({
  activePath,
  copyPath = null,
  environmentId,
  lineRange,
  markdownLinkRouting,
  onOpenInEditor,
  source,
  statusLabel,
  threadId,
}: WorkspaceFilePreviewTabContentProps) {
  const {
    data: workspaceFilePreview,
    error: workspaceFilePreviewError,
    isLoading: isWorkspaceFilePreviewLoading,
  } = useEnvironmentFilePreview(environmentId, activePath, source);

  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      copyPath={copyPath}
      error={workspaceFilePreviewError}
      filePreview={workspaceFilePreview}
      htmlPreviewUrl={
        source?.kind === "working-tree"
          ? buildThreadWorktreeRawContentUrl(threadId, activePath)
          : null
      }
      isLoading={isWorkspaceFilePreviewLoading}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onOpenInEditor={onOpenInEditor}
      statusLabel={statusLabel}
    />
  );
}

export function HostFilePreviewTabContent({
  activePath,
  environmentId,
  lineRange,
  markdownLinkRouting,
  onOpenInEditor,
  threadId,
}: HostFilePreviewTabContentProps) {
  const {
    data: hostFilePreview,
    error: hostFilePreviewError,
    isLoading: isHostFilePreviewLoading,
  } = useThreadHostFilePreview(threadId, environmentId, activePath);

  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      error={hostFilePreviewError}
      filePreview={hostFilePreview}
      htmlPreviewUrl={buildRawFilesystemHtmlContentUrl(threadId, activePath)}
      isLoading={isHostFilePreviewLoading}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onOpenInEditor={onOpenInEditor}
      statusLabel={null}
    />
  );
}

export function ThreadStorageFilePreviewTabContent({
  activePath,
  copyPath = null,
  lineRange,
  markdownLinkRouting,
  onOpenInEditor,
  threadId,
}: ThreadStorageFilePreviewTabContentProps) {
  const {
    data: threadStorageFilePreview,
    error: threadStorageFilePreviewError,
    isLoading: isThreadStorageFilePreviewLoading,
  } = useThreadStorageFilePreview(threadId, activePath);

  return (
    <ThreadStorageFilePreview
      activePath={activePath}
      copyPath={copyPath}
      error={threadStorageFilePreviewError}
      filePreview={threadStorageFilePreview}
      isLoading={isThreadStorageFilePreviewLoading}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onOpenInEditor={onOpenInEditor}
      threadId={threadId}
    />
  );
}
