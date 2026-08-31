import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DiffPresentation } from "@/components/code/code-rendering";
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
import { useHostFilePreview } from "@/hooks/queries/host-file-preview-query";
import { loadFilePreview } from "@/lib/api";
import { resolveFileInteraction } from "@/lib/file-resolver";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import {
  getAbsoluteDirname,
  resolveRootRelativeFilePath,
} from "@/lib/absolute-file-path";
import { fileNameFromPath } from "@bb/thread-view";
import type { ExperimentalFileIdentity } from "@get-bb/plugin-sdk";
import {
  buildHostFileDownloadUrl,
  buildEnvironmentFileDownloadUrl,
  buildEnvironmentFilePreviewUrl,
  buildProjectFileDownloadUrl,
  buildRawFilesystemHtmlContentUrl,
  buildThreadHostFileDownloadUrl,
  buildThreadStorageDownloadUrl,
  buildThreadWorktreeDownloadUrl,
  buildThreadWorktreeRawContentUrl,
} from "@/lib/file-content-urls";
import type {
  EnvironmentFilePreviewSource,
  FilePreviewLineRange,
  WorkspaceFilePreviewStatusLabel,
} from "@bb/client-core";
import { cn } from "@bb/shared-ui/lib/utils";
import { DiffFilesPanel } from "./git-diff/DiffFilesPanel";
import { clearDiffFileCardStates } from "./git-diff/diffFilesStore";
import { buildGitDiffIdentity } from "./git-diff/gitDiffPanelHelpers";
import { useDiffFileContentsRequester } from "./git-diff/useDiffFileContentsRequester";
import {
  SecondaryPanelFilePreview,
  ThreadStorageFilePreview,
} from "./ThreadStorageFilePreview";
import { buildMarkdownFilePreviewRouting } from "./markdown-file-preview-routing";

const GIT_DIFF_SKELETON_FILE_COUNT = 3;
const PANEL_SCROLL_SLOT_CLASS =
  "min-h-0 flex-1 overflow-x-auto overflow-y-auto";

interface GitDiffTabContentProps {
  environmentId?: string;
  target: WorkspaceDiffTarget | undefined;
  isDiffPanelActive: boolean;
  isPanelOpen: boolean;
  gitDiffPresentation: DiffPresentation;
  onClearPendingGitDiffIntent?: () => void;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onSelectionAddToChat?: (text: string) => void;
  pendingGitDiffScrollPath?: string | null;
  workspaceRootPath?: string | null;
}

interface WorkspaceFilePreviewTabContentProps {
  activePath: string;
  isPanelOpen: boolean;
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

interface ProjectFilePreviewTabContentProps {
  activePath: string;
  isPanelOpen: boolean;
  copyPath?: string | null;
  environmentId: string | null;
  hostId: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  projectId: string;
}

interface HostFilePreviewTabContentProps {
  activePath: string;
  isPanelOpen: boolean;
  copyPath: string;
  environmentId?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  threadId: string;
}

interface HostScopedFilePreviewTabContentProps {
  activePath: string;
  hostId: string;
  isPanelOpen: boolean;
  lineRange: FilePreviewLineRange | null;
  onOpenInEditor?: (path: string) => void;
}

interface ThreadStorageFilePreviewTabContentProps {
  activePath: string;
  isPanelOpen: boolean;
  copyPath?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  threadId: string;
}

interface ByteFilePreviewTabContentProps {
  identity: ExperimentalFileIdentity;
  isPanelOpen: boolean;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
}

function ThreadDiffSkeleton() {
  return (
    <div className="space-y-2 pt-2">
      {Array.from({ length: GIT_DIFF_SKELETON_FILE_COUNT }).map((_, index) => (
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

export function GitDiffTabContent({
  environmentId,
  target,
  isDiffPanelActive,
  isPanelOpen,
  gitDiffPresentation,
  onClearPendingGitDiffIntent,
  onOpenFileInEditor,
  onOpenFilePreview,
  onSelectionAddToChat,
  pendingGitDiffScrollPath,
  workspaceRootPath,
}: GitDiffTabContentProps) {
  const isQueryEnabled =
    isDiffPanelActive &&
    isPanelOpen &&
    Boolean(environmentId) &&
    target !== undefined;
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

  useEffect(() => {
    clearDiffFileCardStates(diffIdentity);
  }, [diffIdentity]);

  const isPreparing =
    isQueryEnabled &&
    (isDiffFilesLoading ||
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
    <div className="flex min-h-0 flex-1 flex-col">
      {diffFilesResponse.truncated ? (
        <div
          role="status"
          className="mx-4 mb-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground"
        >
          Showing the first {diffFilesResponse.files.length} changed files.
          Additional changes are omitted.
        </div>
      ) : null}
      <DiffFilesPanel
        environmentId={environmentId}
        target={target}
        diffIdentity={diffIdentity}
        files={diffFilesResponse.files}
        initialPatches={diffFilesResponse.initialPatches}
        filesUpdatedAt={diffFilesUpdatedAt}
        presentation={gitDiffPresentation}
        filePathRoot={workspaceRootPath}
        isPanelOpen={isPanelOpen}
        isPlaceholderData={isDiffFilesPlaceholder}
        scrollToPath={pendingGitDiffScrollPath}
        onScrolledToPath={onClearPendingGitDiffIntent}
        onOpenFileInEditor={onOpenFileInEditor}
        onOpenFilePreview={onOpenFilePreview}
        onRequestFileContents={onRequestFileContents}
        onSelectionAddToChat={onSelectionAddToChat}
      />
    </div>
  );
}

export function WorkspaceFilePreviewTabContent({
  activePath,
  copyPath = null,
  environmentId,
  isPanelOpen,
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
    isFetching: isWorkspaceFilePreviewFetching,
    isLoading: isWorkspaceFilePreviewLoading,
    refetch: refetchWorkspaceFilePreview,
  } = useEnvironmentFilePreview(environmentId, activePath, source, {
    enabled: isPanelOpen,
  });

  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      copyPath={copyPath}
      downloadUrl={
        threadId && source?.kind === "working-tree"
          ? buildThreadWorktreeDownloadUrl(threadId, activePath)
          : environmentId && source?.kind === "working-tree"
            ? buildEnvironmentFileDownloadUrl(environmentId, activePath)
            : null
      }
      error={workspaceFilePreviewError}
      filePreview={workspaceFilePreview}
      htmlPreviewUrl={
        threadId && source?.kind === "working-tree"
          ? buildThreadWorktreeRawContentUrl(threadId, activePath)
          : environmentId && source?.kind === "working-tree"
            ? buildEnvironmentFilePreviewUrl(environmentId, activePath)
            : null
      }
      isLoading={isWorkspaceFilePreviewLoading}
      isRefreshing={isWorkspaceFilePreviewFetching}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      onRefresh={() => void refetchWorkspaceFilePreview()}
      statusLabel={statusLabel}
    />
  );
}

export function ProjectFilePreviewTabContent({
  activePath,
  copyPath = null,
  environmentId,
  hostId,
  isPanelOpen,
  lineRange,
  markdownLinkRouting,
  onSelectionAddToChat,
  onOpenInEditor,
  projectId,
}: ProjectFilePreviewTabContentProps) {
  const {
    data: projectFilePreview,
    error: projectFilePreviewError,
    isFetching: isProjectFilePreviewFetching,
    isLoading: isProjectFilePreviewLoading,
    refetch: refetchProjectFilePreview,
  } = useProjectFilePreview(
    projectId,
    activePath,
    { environmentId, hostId },
    { enabled: isPanelOpen },
  );

  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      copyPath={copyPath}
      downloadUrl={buildProjectFileDownloadUrl(projectId, activePath, {
        ...(environmentId !== null
          ? { environmentId }
          : hostId !== null
            ? { hostId }
            : {}),
      })}
      error={projectFilePreviewError}
      filePreview={projectFilePreview}
      isLoading={isProjectFilePreviewLoading}
      isRefreshing={isProjectFilePreviewFetching}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      onRefresh={() => void refetchProjectFilePreview()}
      statusLabel={null}
    />
  );
}

export function HostFilePreviewTabContent({
  activePath,
  copyPath,
  environmentId,
  isPanelOpen,
  lineRange,
  markdownLinkRouting,
  onSelectionAddToChat,
  onOpenInEditor,
  threadId,
}: HostFilePreviewTabContentProps) {
  const {
    data: hostFilePreview,
    error: hostFilePreviewError,
    isFetching: isHostFilePreviewFetching,
    isLoading: isHostFilePreviewLoading,
    refetch: refetchHostFilePreview,
  } = useThreadHostFilePreview(threadId, environmentId, activePath, {
    enabled: isPanelOpen,
  });

  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      copyPath={copyPath}
      downloadUrl={buildThreadHostFileDownloadUrl(threadId, activePath)}
      error={hostFilePreviewError}
      filePreview={hostFilePreview}
      htmlPreviewUrl={buildRawFilesystemHtmlContentUrl(threadId, activePath)}
      isLoading={isHostFilePreviewLoading}
      isRefreshing={isHostFilePreviewFetching}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      onRefresh={() => void refetchHostFilePreview()}
      statusLabel={null}
    />
  );
}

export function HostScopedFilePreviewTabContent({
  activePath,
  hostId,
  isPanelOpen,
  lineRange,
  onOpenInEditor,
}: HostScopedFilePreviewTabContentProps) {
  const {
    data: hostFilePreview,
    error,
    isFetching,
    isLoading,
    refetch,
  } = useHostFilePreview(hostId, activePath, { enabled: isPanelOpen });
  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      copyPath={activePath}
      downloadUrl={buildHostFileDownloadUrl(hostId, activePath)}
      error={error}
      filePreview={hostFilePreview}
      htmlPreviewUrl={hostFilePreview?.url ?? null}
      isLoading={isLoading}
      isRefreshing={isFetching}
      lineRange={lineRange}
      onOpenInEditor={onOpenInEditor}
      onRefresh={() => void refetch()}
      statusLabel={null}
    />
  );
}

export function ThreadStorageFilePreviewTabContent({
  activePath,
  copyPath = null,
  isPanelOpen,
  lineRange,
  markdownLinkRouting,
  onSelectionAddToChat,
  onOpenInEditor,
  threadId,
}: ThreadStorageFilePreviewTabContentProps) {
  const {
    data: threadStorageFilePreview,
    error: threadStorageFilePreviewError,
    isFetching: isThreadStorageFilePreviewFetching,
    isLoading: isThreadStorageFilePreviewLoading,
    refetch: refetchThreadStorageFilePreview,
  } = useThreadStorageFilePreview(threadId, activePath, {
    enabled: isPanelOpen,
  });

  return (
    <ThreadStorageFilePreview
      activePath={activePath}
      copyPath={copyPath}
      downloadUrl={buildThreadStorageDownloadUrl(threadId, activePath)}
      error={threadStorageFilePreviewError}
      filePreview={threadStorageFilePreview}
      isLoading={isThreadStorageFilePreviewLoading}
      isRefreshing={isThreadStorageFilePreviewFetching}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      onRefresh={() => void refetchThreadStorageFilePreview()}
      threadId={threadId}
    />
  );
}

export function ByteFilePreviewTabContent({
  identity,
  isPanelOpen,
  markdownLinkRouting,
  onSelectionAddToChat,
}: ByteFilePreviewTabContentProps) {
  const navigation = useAppNavigationHost();
  const interaction = resolveFileInteraction(identity);
  const previewUrl = interaction.previewUrl;
  const previewQuery = useQuery({
    queryKey: ["byte-file-preview", previewUrl, identity.displayName],
    queryFn: ({ signal }) => {
      if (previewUrl === null) {
        throw new Error("File preview context is missing.");
      }
      return loadFilePreview(
        {
          name: identity.displayName,
          path: identity.displayName,
          url: previewUrl,
        },
        signal,
      );
    },
    enabled: isPanelOpen && previewUrl !== null,
  });
  const projectAttachmentMarkdownLinkRouting = useMemo(() => {
    if (identity.source.store !== "project-attachment") return undefined;
    const attachmentPath = identity.source.path.replace(/^\/+/, "");
    const source = identity.source;
    return buildMarkdownFilePreviewRouting({
      baseDir: getAbsoluteDirname({ path: `/${attachmentPath}` }),
      contentSource: {
        kind: "project-attachment",
        projectId: source.ownerId,
      },
      onOpenLink: ({ href }) => navigation.openUrl({ url: href }),
      onOpenLocalFileLink: (link) => {
        const path = resolveRootRelativeFilePath({
          path: link.path,
          rootPath: "/",
        });
        if (path === null) return false;
        return navigation.openFilePreview({
          identity: {
            source: { ...source, path },
            displayName: fileNameFromPath(path),
            mimeType: null,
            sizeBytes: null,
            location:
              link.lineRange === null
                ? null
                : {
                    kind: "range",
                    startLine: link.lineRange.startLineNumber,
                    endLine: link.lineRange.endLineNumber,
                  },
          },
        });
      },
      rootPath: "/",
    });
  }, [identity.source, navigation]);

  return (
    <SecondaryPanelFilePreview
      activePath={identity.displayName}
      copyPath={identity.displayName}
      downloadUrl={interaction.downloadUrl}
      error={
        previewUrl === null
          ? new Error("File preview context is missing.")
          : previewQuery.error
      }
      filePreview={previewQuery.data}
      htmlPreviewUrl={previewUrl}
      isLoading={previewQuery.isLoading}
      isRefreshing={previewQuery.isFetching}
      lineRange={
        identity.location === null
          ? null
          : {
              startLineNumber:
                identity.location.kind === "line"
                  ? identity.location.line
                  : identity.location.startLine,
              endLineNumber:
                identity.location.kind === "line"
                  ? identity.location.line
                  : identity.location.endLine,
            }
      }
      markdownLinkRouting={
        markdownLinkRouting ?? projectAttachmentMarkdownLinkRouting
      }
      onSelectionAddToChat={onSelectionAddToChat}
      onRefresh={() => void previewQuery.refetch()}
      statusLabel={null}
    />
  );
}
