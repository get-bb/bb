import { useCallback, useEffect, type ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import {
  useEnvironmentDiffFiles,
  useEnvironmentFilePreview,
} from "@/hooks/queries/environment-queries";
import { useProjectFilePreview } from "@/hooks/queries/project-queries";
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
import { cn } from "@bb/shared-ui/lib/utils";
import { DiffFilesPanel } from "./git-diff/DiffFilesPanel";
import { clearDiffFileCardStates } from "./git-diff/diffFilesStore";
import { buildGitDiffIdentity } from "./git-diff/gitDiffPanelHelpers";
import { useDiffFileContentsRequester } from "./git-diff/useDiffFileContentsRequester";
import { pendingGitDiffScrollPathAtom } from "./threadSecondaryPanelAtoms";
import {
  SecondaryPanelFilePreview,
  ThreadStorageFilePreview,
} from "./ThreadStorageFilePreview";

const GIT_DIFF_SKELETON_FILE_COUNT = 3;
const PANEL_SCROLL_SLOT_CLASS =
  "min-h-0 flex-1 overflow-x-auto overflow-y-auto";

interface ThreadDiffSkeletonProps {
  count?: number;
}

export interface GitDiffTabContentProps {
  environmentId?: string;
  target: WorkspaceDiffTarget | undefined;
  isDiffPanelActive: boolean;
  gitDiffViewOptions: Record<string, string | boolean | number>;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onSelectionAddToChat?: (text: string) => void;
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
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  source: EnvironmentFilePreviewSource | null;
  statusLabel: WorkspaceFilePreviewStatusLabel | null;
  threadId?: string | null;
}

export interface ProjectFilePreviewTabContentProps {
  activePath: string;
  copyPath?: string | null;
  lineRange: FilePreviewLineRange | null;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  projectId: string;
}

export interface HostFilePreviewTabContentProps {
  activePath: string;
  copyPath: string;
  environmentId?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  threadId: string;
}

export interface ThreadStorageFilePreviewTabContentProps {
  activePath: string;
  copyPath?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
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

/**
 * The diff tab body. Fetches the diff's table of contents
 * ({@link useEnvironmentDiffFiles}) and renders it through the virtualized
 * {@link DiffFilesPanel}, which fetches per-file patches on demand as rows
 * scroll into view. Handles the TOC's loading / empty / `not_applicable`
 * (`too_many_files`) / `unavailable` states; per-file patch errors surface as
 * retryable card errors inside the panel.
 */
export function GitDiffTabContent({
  environmentId,
  target,
  isDiffPanelActive,
  gitDiffViewOptions,
  onOpenFileInEditor,
  onOpenFilePreview,
  onSelectionAddToChat,
  workspaceRootPath,
}: GitDiffTabContentProps) {
  const isQueryEnabled =
    isDiffPanelActive && Boolean(environmentId) && target !== undefined;
  const {
    data: diffFilesResponse,
    dataUpdatedAt: diffFilesUpdatedAt,
    isLoading: isDiffFilesLoading,
    isPlaceholderData: isDiffFilesPlaceholder,
    error: diffFilesError,
  } = useEnvironmentDiffFiles(environmentId ?? "", {
    enabled: isQueryEnabled,
    target,
  });

  const mergeBaseRef =
    diffFilesResponse?.outcome === "available"
      ? diffFilesResponse.mergeBaseRef
      : null;
  const diffIdentity = buildGitDiffIdentity({
    environmentId,
    mergeBaseRef,
    target,
  });
  const onRequestFileContents = useDiffFileContentsRequester({
    environmentId,
    target,
    mergeBaseRef,
  });

  // A file opened from the info tab / prompt banner sets this path;
  // useGitDiffPanelState resets the diff to all-changes so the file is in the
  // slice, and the panel scrolls it into view, then clears the request here.
  const pendingGitDiffScrollPath = useAtomValue(pendingGitDiffScrollPathAtom);
  const setPendingGitDiffScrollPath = useSetAtom(pendingGitDiffScrollPathAtom);
  const clearPendingGitDiffScrollPath = useCallback(
    () => setPendingGitDiffScrollPath(null),
    [setPendingGitDiffScrollPath],
  );

  // Drop per-card UI state belonging to any other diff slice once a new target
  // / environment resolves, so collapse defaults are re-derived fresh rather
  // than inheriting a previous diff's choices at a shared path.
  useEffect(() => {
    clearDiffFileCardStates(diffIdentity);
  }, [diffIdentity]);

  const isPreparing =
    isQueryEnabled &&
    (target === undefined ||
      isDiffFilesLoading ||
      (diffFilesResponse === undefined && diffFilesError === null));

  if (isPreparing) {
    return (
      <div className={cn(PANEL_SCROLL_SLOT_CLASS, "px-4 pb-3")}>
        <ThreadDiffSkeleton />
      </div>
    );
  }

  if (diffFilesError) {
    return (
      <div className={cn(PANEL_SCROLL_SLOT_CLASS, "px-4 pb-3")}>
        <div className="rounded-lg border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-xs text-destructive">
          <p>
            {diffFilesError instanceof Error
              ? diffFilesError.message
              : "Failed to load git diff"}
          </p>
        </div>
      </div>
    );
  }

  if (diffFilesResponse === undefined) {
    return (
      <div className={cn(PANEL_SCROLL_SLOT_CLASS, "px-4 pb-3")}>
        <EmptyStatePanel className="rounded-lg">
          No diff to display.
        </EmptyStatePanel>
      </div>
    );
  }

  if (diffFilesResponse.outcome === "unavailable") {
    return (
      <div className={cn(PANEL_SCROLL_SLOT_CLASS, "px-4 pb-3")}>
        <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Workspace unavailable</p>
          <p className="mt-1 leading-5">{diffFilesResponse.failure.message}</p>
        </div>
      </div>
    );
  }

  if (diffFilesResponse.outcome === "not_applicable") {
    return (
      <div className={cn(PANEL_SCROLL_SLOT_CLASS, "px-4 pb-3")}>
        <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
          <p className="mt-1 leading-5">{diffFilesResponse.message}</p>
        </div>
      </div>
    );
  }

  if (diffFilesResponse.files.length === 0) {
    return (
      <div className={cn(PANEL_SCROLL_SLOT_CLASS, "px-4 pb-3")}>
        <EmptyStatePanel className="rounded-lg">
          No diff to display.
        </EmptyStatePanel>
      </div>
    );
  }

  // The panel needs a concrete target to drive its patch fetches; `isQueryEnabled`
  // above already guarantees both once an `available` outcome resolved.
  if (!environmentId || target === undefined) {
    return (
      <div className={cn(PANEL_SCROLL_SLOT_CLASS, "px-4 pb-3")}>
        <EmptyStatePanel className="rounded-lg">
          No diff to display.
        </EmptyStatePanel>
      </div>
    );
  }

  return (
    <DiffFilesPanel
      environmentId={environmentId}
      target={target}
      diffIdentity={diffIdentity}
      files={diffFilesResponse.files}
      initialPatches={diffFilesResponse.initialPatches}
      filesUpdatedAt={diffFilesUpdatedAt}
      diffViewOptions={gitDiffViewOptions}
      filePathRoot={workspaceRootPath}
      isPlaceholderData={isDiffFilesPlaceholder}
      scrollToPath={pendingGitDiffScrollPath}
      onScrolledToPath={clearPendingGitDiffScrollPath}
      onOpenFileInEditor={onOpenFileInEditor}
      onOpenFilePreview={onOpenFilePreview}
      onRequestFileContents={onRequestFileContents}
      onSelectionAddToChat={onSelectionAddToChat}
    />
  );
}

export function ThreadInfoTabContent({
  metadataContent,
}: ThreadInfoTabContentProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col pb-3">{metadataContent}</div>
  );
}

export function WorkspaceFilePreviewTabContent({
  activePath,
  copyPath = null,
  environmentId,
  lineRange,
  markdownLinkRouting,
  onSelectionAddToChat,
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
        threadId && source?.kind === "working-tree"
          ? buildThreadWorktreeRawContentUrl(threadId, activePath)
          : null
      }
      isLoading={isWorkspaceFilePreviewLoading}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      statusLabel={statusLabel}
    />
  );
}

export function ProjectFilePreviewTabContent({
  activePath,
  copyPath = null,
  lineRange,
  onSelectionAddToChat,
  onOpenInEditor,
  projectId,
}: ProjectFilePreviewTabContentProps) {
  const {
    data: projectFilePreview,
    error: projectFilePreviewError,
    isLoading: isProjectFilePreviewLoading,
  } = useProjectFilePreview(projectId, activePath);

  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      copyPath={copyPath}
      error={projectFilePreviewError}
      filePreview={projectFilePreview}
      isLoading={isProjectFilePreviewLoading}
      lineRange={lineRange}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      statusLabel={null}
    />
  );
}

export function HostFilePreviewTabContent({
  activePath,
  copyPath,
  environmentId,
  lineRange,
  markdownLinkRouting,
  onSelectionAddToChat,
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
      copyPath={copyPath}
      error={hostFilePreviewError}
      filePreview={hostFilePreview}
      htmlPreviewUrl={buildRawFilesystemHtmlContentUrl(threadId, activePath)}
      isLoading={isHostFilePreviewLoading}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
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
  onSelectionAddToChat,
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
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      threadId={threadId}
    />
  );
}
