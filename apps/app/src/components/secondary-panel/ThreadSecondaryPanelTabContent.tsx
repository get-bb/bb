import { useMemo } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
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
import {
  getEnvironmentFilePreviewSourceRef,
  type EnvironmentFilePreviewSource,
  type FilePreview,
  type FilePreviewLineRange,
} from "@bb/client-core";
import { SecondaryPanelFilePreview } from "./ThreadStorageFilePreview";
import { buildMarkdownFileRouting } from "@/components/ui/markdown-file-routing";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import {
  getAbsoluteDirname,
  isAbsoluteFilePathWithinRoot,
} from "@bb/shared-ui/lib/absolute-file-path";
import { buildHostFileContentUrl } from "@/lib/file-content-urls";

interface WorkspaceFilePreviewTabContentProps {
  activePath: string;
  isPanelOpen: boolean;
  copyPath?: string | null;
  environmentId?: string | null;
  lineRange: FilePreviewLineRange | null;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  source: EnvironmentFilePreviewSource | null;
  threadId?: string | null;
}

interface ProjectFilePreviewTabContentProps {
  activePath: string;
  isPanelOpen: boolean;
  copyPath?: string | null;
  environmentId: string | null;
  hostId: string | null;
  lineRange: FilePreviewLineRange | null;
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
  onSelectionAddToChat,
  onOpenInEditor,
  source,
  threadId,
}: WorkspaceFilePreviewTabContentProps) {
  const navigation = useAppNavigationHost();
  const environmentQuery = useEnvironment(environmentId ?? null, {
    staleTime: 5_000,
  });
  const workspaceFilePreviewQuery = useEnvironmentFilePreview(
    environmentId,
    activePath,
    source,
    { enabled: isPanelOpen },
  );
  const environmentRootPath = environmentQuery.data?.path ?? null;
  const markdownLinkRouting = useMemo(() => {
    if (source === null || !environmentId) return undefined;
    return buildMarkdownFileRouting({
      path: activePath,
      rootPath: environmentRootPath,
      threadId: threadId ?? null,
      resolveRelativeSrc: (path) =>
        buildEnvironmentFileContentUrl(environmentId, source, path),
      openFile: (path, _absolutePath, location) =>
        navigation.openFilePreview({
          target: { kind: "workspace", environmentId, path },
          location,
        }),
    });
  }, [
    activePath,
    environmentId,
    environmentRootPath,
    navigation,
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
      markdownLinkRouting={markdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      statusLabel={
        source === null ? null : getEnvironmentFilePreviewSourceRef(source)
      }
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
  const markdownLinkRouting = useMemo(
    () =>
      buildMarkdownFileRouting({
        path: activePath,
        rootPath,
        threadId,
        resolveRelativeSrc: (path) =>
          buildProjectFileContentUrl(projectId, path, {
            environmentId,
            hostId,
          }),
      }),
    [activePath, environmentId, hostId, projectId, rootPath, threadId],
  );

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
      markdownLinkRouting={markdownLinkRouting}
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
  onSelectionAddToChat,
  onOpenInEditor,
  threadId,
}: HostFilePreviewTabContentProps) {
  const navigation = useAppNavigationHost();
  const environment = useEnvironment(environmentId ?? null, {
    staleTime: 5_000,
  }).data;
  const hostFilePreviewQuery = useThreadHostFilePreview(
    threadId,
    environmentId,
    activePath,
    { enabled: isPanelOpen },
  );
  const markdownLinkRouting = useMemo(() => {
    const workspaceRootPath = environment?.path ?? null;
    const hostId = environment?.hostId;
    return buildMarkdownFileRouting({
      path: activePath,
      rootPath:
        workspaceRootPath !== null &&
        isAbsoluteFilePathWithinRoot({
          candidatePath: activePath,
          rootPath: workspaceRootPath,
        })
          ? workspaceRootPath
          : getAbsoluteDirname({ path: activePath }),
      threadId,
      resolveRelativeSrc: (_relativePath, path) =>
        buildThreadHostFileContentUrl(threadId, path),
      openFile:
        hostId === undefined
          ? undefined
          : (_relativePath, path, location) =>
              navigation.openFilePreview({
                target: { kind: "host", hostId, path },
                location,
              }),
    });
  }, [activePath, environment, navigation, threadId]);

  return (
    <SecondaryPanelFilePreview
      {...filePreviewQueryProps(hostFilePreviewQuery)}
      activePath={activePath}
      copyPath={copyPath}
      htmlPreviewUrl={buildThreadHostFileContentUrl(threadId, activePath)}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
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
  const navigation = useAppNavigationHost();
  const markdownLinkRouting = useMemo(
    () =>
      buildMarkdownFileRouting({
        path: activePath,
        rootPath: getAbsoluteDirname({ path: activePath }),
        threadId: null,
        resolveRelativeSrc: (_relativePath, path) =>
          buildHostFileContentUrl(hostId, path),
        openFile: (_relativePath, path, location) =>
          navigation.openFilePreview({
            target: { kind: "host", hostId, path },
            location,
          }),
      }),
    [activePath, hostId, navigation],
  );
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
  onSelectionAddToChat,
  onOpenInEditor,
  threadId,
}: ThreadStorageFilePreviewTabContentProps) {
  const navigation = useAppNavigationHost();
  const threadStorageFilePreviewQuery = useThreadStorageFilePreview(
    threadId,
    activePath,
    { enabled: isPanelOpen },
  );
  const markdownLinkRouting = useMemo(
    () =>
      buildMarkdownFileRouting({
        path: activePath,
        rootPath: null,
        threadId,
        resolveRelativeSrc: (path) =>
          buildThreadStorageRawContentUrl(threadId, path),
        openFile: (path, _absolutePath, location) =>
          navigation.openFilePreview({
            target: { kind: "thread-storage", threadId, path },
            location,
          }),
      }),
    [activePath, navigation, threadId],
  );

  return (
    <SecondaryPanelFilePreview
      {...filePreviewQueryProps(threadStorageFilePreviewQuery)}
      activePath={activePath}
      copyPath={copyPath}
      htmlPreviewUrl={buildThreadStorageRawContentUrl(threadId, activePath)}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
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
