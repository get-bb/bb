import { type ReactNode, useEffect } from "react";
import type { DiffPresentation } from "@bb/shared-ui/git-diff/renderers";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { DiffLoadingSkeleton } from "@bb/shared-ui/diff-loading-skeleton";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { cn } from "@bb/shared-ui/lib/utils";
import type { GitFilesResult, WorkspaceDiffTarget } from "../../contract.js";
import type { DiffFileFilters } from "./diff-file-filters.js";
import { DiffFilesPanel } from "./DiffFilesPanel.js";
import { clearDiffFileCardStates } from "./diffFilesStore.js";
import { PANEL_SCROLL_SLOT_CLASS } from "./panel-chrome.js";
import {
  useDiffFileContentsRequester,
} from "./useDiffFileContentsRequester.js";

const GIT_DIFF_SKELETON_FILE_COUNT = 3;

export function GitDiffMessageSlot({ children }: { children: ReactNode }) {
  return (
    <div className={cn(PANEL_SCROLL_SLOT_CLASS, "px-4 pb-3")}>{children}</div>
  );
}

export function GitDiffLoadingSkeleton() {
  return (
    <GitDiffMessageSlot>
      <div className="space-y-2 pt-2" role="status" aria-label="Loading diff">
        {Array.from({ length: GIT_DIFF_SKELETON_FILE_COUNT }).map(
          (_, index) => (
            <div
              key={`git-diff-skeleton-${index}`}
              className="overflow-clip rounded-lg border border-border bg-background"
            >
              <div className="flex h-8 items-center justify-between gap-2 py-1.5 pl-2 pr-3">
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <Skeleton className="size-4 shrink-0 rounded-sm" />
                  <Skeleton className="h-3 w-48 max-w-full rounded-sm" />
                </div>
                <Skeleton className="h-3 w-14 shrink-0 rounded-sm" />
              </div>
              <DiffLoadingSkeleton />
            </div>
          ),
        )}
      </div>
    </GitDiffMessageSlot>
  );
}

function GitDiffUnavailableNotice({ message }: { message: string }) {
  return (
    <GitDiffMessageSlot>
      <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Workspace unavailable</p>
        <p className="mt-1 leading-5">{message}</p>
      </div>
    </GitDiffMessageSlot>
  );
}

function GitDiffNotApplicableNotice({ message }: { message: string }) {
  return (
    <GitDiffMessageSlot>
      <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
        <p className="mt-1 leading-5">{message}</p>
      </div>
    </GitDiffMessageSlot>
  );
}

export function GitDiffEmptyNotice() {
  return (
    <GitDiffMessageSlot>
      <EmptyStatePanel className="rounded-lg">No diff to display.</EmptyStatePanel>
    </GitDiffMessageSlot>
  );
}

interface GitDiffTabContentProps {
  environmentId: string;
  target: WorkspaceDiffTarget | undefined;
  diffIdentity: string;
  files: {
    result: GitFilesResult | undefined;
    error: Error | null;
    isLoading: boolean;
    isPlaceholder: boolean;
  };
  gitDiffPresentation: DiffPresentation;
  ignoreWhitespace: boolean;
  isLive: boolean;
  fileFilter: string;
  filters: DiffFileFilters;
  onClearPendingGitDiffIntent?: () => void;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  pendingGitDiffScrollPath?: string | null;
  workspaceRootPath?: string | null;
}

export function GitDiffTabContent({
  environmentId,
  target,
  diffIdentity,
  files,
  gitDiffPresentation,
  ignoreWhitespace,
  isLive,
  fileFilter,
  filters,
  onClearPendingGitDiffIntent,
  onOpenFileInEditor,
  onOpenFilePreview,
  pendingGitDiffScrollPath,
  workspaceRootPath,
}: GitDiffTabContentProps) {
  const { result, error, isLoading, isPlaceholder } = files;
  const mergeBaseRef =
    result?.outcome === "available" ? result.mergeBaseRef : null;
  const onRequestFileContents = useDiffFileContentsRequester({
    environmentId,
    target,
    mergeBaseRef,
  });

  useEffect(() => {
    clearDiffFileCardStates(diffIdentity);
  }, [diffIdentity]);

  const isPreparing =
    target !== undefined &&
    (isLoading || (result === undefined && error === null));

  if (isPreparing) {
    return <GitDiffLoadingSkeleton />;
  }

  if (error && result === undefined) {
    return (
      <GitDiffMessageSlot>
        <div className="rounded-lg border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-xs text-destructive">
          <p>{error.message || "Failed to load git diff"}</p>
        </div>
      </GitDiffMessageSlot>
    );
  }

  if (result === undefined) {
    return <GitDiffEmptyNotice />;
  }

  if (result.outcome === "unavailable") {
    return <GitDiffUnavailableNotice message={result.failure.message} />;
  }

  if (result.outcome === "not_applicable") {
    return <GitDiffNotApplicableNotice message={result.message} />;
  }

  if (result.files.length === 0 || target === undefined) {
    return <GitDiffEmptyNotice />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {result.truncated ? (
        <div
          role="status"
          className="mx-4 mb-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground"
        >
          Showing the first {result.files.length} changed files. Additional
          changes are omitted.
        </div>
      ) : null}
      <DiffFilesPanel
        environmentId={environmentId}
        target={target}
        diffIdentity={diffIdentity}
        files={result.files}
        fileFilter={fileFilter}
        filters={filters}
        initialPatches={result.initialPatches}
        presentation={gitDiffPresentation}
        ignoreWhitespace={ignoreWhitespace}
        isPlaceholder={isPlaceholder}
        isLive={isLive}
        filePathRoot={workspaceRootPath}
        scrollToPath={pendingGitDiffScrollPath}
        onScrolledToPath={onClearPendingGitDiffIntent}
        onOpenFileInEditor={onOpenFileInEditor}
        onOpenFilePreview={onOpenFilePreview}
        onRequestFileContents={onRequestFileContents}
      />
    </div>
  );
}
