import { useMemo } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import {
  useEnvironment,
  useEnvironmentFilePreview,
} from "@/hooks/queries/environment-queries";
import {
  useProjectAttachmentPreview,
  useProjectFilePreview,
} from "@/hooks/queries/project-queries";
import {
  useThreadHostFilePreview,
  useThreadStorageFilePreview,
} from "@/hooks/queries/thread-panel-queries";
import { useHostFilePreview } from "@/hooks/queries/host-file-preview-query";
import {
  buildEnvironmentFileContentUrl,
  buildProjectFileContentUrl,
  buildThreadHostFileContentUrl,
  buildThreadStorageRawContentUrl,
} from "@/lib/file-content-urls";
import type {
  EnvironmentFilePreviewSource,
  FilePreview,
  FilePreviewLineRange,
  WorkspaceFilePreviewStatusLabel,
} from "@bb/client-core";
import { SecondaryPanelFilePreview } from "./ThreadStorageFilePreview";
import {
  buildMarkdownFileImageRouting,
  buildMarkdownHostFileImageRouting,
} from "@/components/ui/markdown-file-image-routing";
import { getAbsoluteDirname } from "@bb/shared-ui/lib/absolute-file-path";


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
  rootPath?: string | null;
  threadId?: string | null;
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

interface AttachmentFilePreviewTabContentProps {
  isPanelOpen: boolean;
  name: string;
  onSelectionAddToChat?: (text: string) => void;
  path: string;
  projectId: string;
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

function filePreviewQueryProps(query: UseQueryResult<FilePreview>) {
  return {
    error: query.error,
    filePreview: query.data,
    isLoading: query.isLoading,
    isRefreshing: query.isFetching,
    onRefresh: () => void query.refetch(),
  };
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
  const environmentQuery = useEnvironment(environmentId ?? null, {
    enabled:
      environmentId !== null &&
      environmentId !== undefined &&
      markdownLinkRouting?.localImage === undefined,
    staleTime: 5_000,
  });
  const workspaceFilePreviewQuery = useEnvironmentFilePreview(
    environmentId,
    activePath,
    source,
    { enabled: isPanelOpen },
  );
  const environmentRootPath = environmentQuery.data?.path ?? null;
  const resolvedMarkdownLinkRouting = useMemo(() => {
    if (source === null || !environmentId) {
      return markdownLinkRouting;
    }
    return buildMarkdownFileImageRouting({
      path: activePath,
      rootPath: environmentRootPath,
      threadId: threadId ?? null,
      linkRouting: markdownLinkRouting,
      resolveRelativeSrc: (path) =>
        buildEnvironmentFileContentUrl(environmentId, source, path),
    });
  }, [
    activePath,
    environmentId,
    environmentRootPath,
    markdownLinkRouting,
    source,
    threadId,
  ]);

  return (
    <SecondaryPanelFilePreview
      {...filePreviewQueryProps(workspaceFilePreviewQuery)}
      activePath={activePath}
      copyPath={copyPath}
      htmlPreviewUrl={
        environmentId && source?.kind === "working-tree"
          ? buildEnvironmentFileContentUrl(environmentId, source, activePath)
          : null
      }
      lineRange={lineRange}
      markdownLinkRouting={resolvedMarkdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
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
  rootPath = null,
  threadId = null,
}: ProjectFilePreviewTabContentProps) {
  const projectFilePreviewQuery = useProjectFilePreview(
    projectId,
    activePath,
    { environmentId, hostId },
    { enabled: isPanelOpen },
  );
  const resolvedMarkdownLinkRouting = useMemo(() => {
    return buildMarkdownFileImageRouting({
      path: activePath,
      rootPath,
      threadId,
      linkRouting: markdownLinkRouting,
      resolveRelativeSrc: (path) =>
        buildProjectFileContentUrl(projectId, path, { environmentId, hostId }),
    });
  }, [
    activePath,
    environmentId,
    hostId,
    markdownLinkRouting,
    projectId,
    rootPath,
    threadId,
  ]);

  return (
    <SecondaryPanelFilePreview
      {...filePreviewQueryProps(projectFilePreviewQuery)}
      activePath={activePath}
      copyPath={copyPath}
      htmlPreviewUrl={buildProjectFileContentUrl(projectId, activePath, {
        environmentId,
        hostId,
      })}
      lineRange={lineRange}
      markdownLinkRouting={resolvedMarkdownLinkRouting}
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
  isPanelOpen,
  lineRange,
  markdownLinkRouting,
  onSelectionAddToChat,
  onOpenInEditor,
  threadId,
}: HostFilePreviewTabContentProps) {
  const hostFilePreviewQuery = useThreadHostFilePreview(
    threadId,
    environmentId,
    activePath,
    { enabled: isPanelOpen },
  );
  const resolvedMarkdownLinkRouting = useMemo(() => {
    return buildMarkdownFileImageRouting({
      path: activePath,
      rootPath:
        markdownLinkRouting?.localFile?.relativeLinks?.rootPath ??
        getAbsoluteDirname({ path: activePath }),
      threadId,
      linkRouting: markdownLinkRouting,
      resolveRelativeSrc: (_relativePath, path) =>
        buildThreadHostFileContentUrl(threadId, path),
    });
  }, [activePath, markdownLinkRouting, threadId]);

  return (
    <SecondaryPanelFilePreview
      {...filePreviewQueryProps(hostFilePreviewQuery)}
      activePath={activePath}
      copyPath={copyPath}
      htmlPreviewUrl={buildThreadHostFileContentUrl(threadId, activePath)}
      lineRange={lineRange}
      markdownLinkRouting={resolvedMarkdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
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
  const hostFilePreviewQuery = useHostFilePreview(hostId, activePath, {
    enabled: isPanelOpen,
  });
  const markdownLinkRouting = useMemo(() => {
    return buildMarkdownHostFileImageRouting({
      path: activePath,
      rootPath: getAbsoluteDirname({ path: activePath }),
      hostId,
    });
  }, [activePath, hostId]);
  return (
    <SecondaryPanelFilePreview
      {...filePreviewQueryProps(hostFilePreviewQuery)}
      activePath={activePath}
      copyPath={activePath}
      htmlPreviewUrl={hostFilePreviewQuery.data?.url ?? null}
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
  isPanelOpen,
  lineRange,
  markdownLinkRouting,
  onSelectionAddToChat,
  onOpenInEditor,
  threadId,
}: ThreadStorageFilePreviewTabContentProps) {
  const threadStorageFilePreviewQuery = useThreadStorageFilePreview(
    threadId,
    activePath,
    { enabled: isPanelOpen },
  );
  const resolvedMarkdownLinkRouting = useMemo(() => {
    return buildMarkdownFileImageRouting({
      path: activePath,
      rootPath: null,
      threadId,
      linkRouting: markdownLinkRouting,
      resolveRelativeSrc: (path) =>
        buildThreadStorageRawContentUrl(threadId, path),
    });
  }, [activePath, markdownLinkRouting, threadId]);

  return (
    <SecondaryPanelFilePreview
      {...filePreviewQueryProps(threadStorageFilePreviewQuery)}
      activePath={activePath}
      copyPath={copyPath}
      htmlPreviewUrl={buildThreadStorageRawContentUrl(threadId, activePath)}
      lineRange={lineRange}
      markdownLinkRouting={resolvedMarkdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      statusLabel={null}
    />
  );
}

export function AttachmentFilePreviewTabContent({
  isPanelOpen,
  name,
  onSelectionAddToChat,
  path,
  projectId,
}: AttachmentFilePreviewTabContentProps) {
  const attachmentPreviewQuery = useProjectAttachmentPreview(
    projectId,
    path,
    name,
    { enabled: isPanelOpen },
  );

  return (
    <SecondaryPanelFilePreview
      {...filePreviewQueryProps(attachmentPreviewQuery)}
      activePath={name}
      copyPath={null}
      lineRange={null}
      onSelectionAddToChat={onSelectionAddToChat}
      statusLabel={null}
    />
  );
}
