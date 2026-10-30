import { PluginDetailTabContent } from "@/components/plugin/plugin-detail-navigation";
import type { ReactNode } from "react";
import type { SidebarProject } from "@/hooks/queries/project-queries";
import { findLocalPathProjectSourceForHost } from "@bb/domain";
import type {
  ExperimentalLiveFileTarget,
  PluginFileOpenerSource,
} from "@get-bb/plugin-sdk";
import type {
  PluginPanelFixedPanelTab,
  SecondaryFileFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import type { SecondaryPanelPaneRenderContext } from "@/components/secondary-panel/ThreadSecondaryPanel";
import {
  LazyFilePreview,
  LazyHostFilePreviewTabContent,
  LazyHostScopedFilePreviewTabContent,
  LazyNewTabPage,
  LazyProjectFilePreviewTabContent,
  LazyThreadStorageFilePreviewTabContent,
  LazyAttachmentFilePreviewTabContent,
  LazyThreadTerminalPanel,
  LazyWorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/lazySecondaryPanelComponents";
import type { FileSearchSelection } from "@/components/secondary-panel/useThreadFileTabs";
import {
  PluginPanelTabContent,
  type PluginPanelActionEntry,
} from "@/components/plugin/PluginPanelActions";
import {
  createFileOpenerOriginalTab,
  parseFileOpenerParams,
  type FileOpenerOriginalTab,
} from "@/components/plugin/file-opener-tabs";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useThreadStorageLocation } from "@/hooks/queries/thread-panel-queries";
import { useCanOpenFileExternally } from "@/hooks/useCanOpenFileExternally";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { getFilePreviewLineRangeStart } from "@bb/client-core";
import { resolveAbsoluteFilePath } from "@bb/shared-ui/lib/absolute-file-path";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";

export const ROOT_COMPOSE_FIXED_PANEL_STATE_ID = "root-compose";

export type RootComposeTerminalTarget =
  | { kind: "environment"; environmentId: string }
  | { kind: "host_path"; cwd: string | null; hostId: string };

interface RootComposePanelTabContentProps {
  activeTabId: string | null;
  canCreateTerminal: boolean;
  currentProjectId: string;
  isPanelOpen: boolean;
  isPanelPersistedOpen: boolean;
  isProjectless: boolean;
  onActivateTab: (tabId: string) => void;
  onAutoFocusNewTabHandled: () => void;
  onAutoFocusTerminalHandled: () => void;
  onCloseTerminal: (terminalId: string) => void;
  onOpenBrowser: (() => void) | null;
  onOpenPanelLink: MarkdownPreviewLinkHandler;
  onRetryTerminalStart: (terminalId: string) => void;
  onSelectFileSearchResult: (selection: FileSearchSelection) => void;
  onSelectionAddToChat: (text: string) => void;
  onStartTerminal: () => void;
  pane: SecondaryPanelPaneRenderContext;
  primaryHostId: string | null;
  pluginActions: readonly PluginPanelActionEntry[];
  projectSources: SidebarProject["sources"];
  projects: readonly SidebarProject[] | undefined;
  rootPanelEnvironmentId: string | null;
  rootPanelThreadId: string | null;
  rootProjectHostId: string | null;
  shouldAutoFocusNewTab: boolean;
  autoFocusTerminalId: string | null;
  tab: SecondaryFileFixedPanelTab;
  terminalTarget: RootComposeTerminalTarget | null;
}

interface RootComposeFilePreviewTabContentProps {
  currentProjectId: string;
  isFocused: boolean;
  isPanelOpen: boolean;
  isProjectless: boolean;
  fileOpenerSource: PluginFileOpenerSource | null;
  onSelectionAddToChat: (text: string) => void;
  pluginPanelTab?: PluginPanelFixedPanelTab;
  primaryHostId: string | null;
  projectSources: SidebarProject["sources"];
  projects: readonly SidebarProject[] | undefined;
  rootPanelEnvironmentId: string | null;
  rootPanelThreadId: string | null;
  rootProjectHostId: string | null;
  tab: FileOpenerOriginalTab;
}

export function resolveRootComposeProjectFileRouting({
  fileOpenerSource,
  selectedEnvironmentId,
  selectedHostId,
}: {
  fileOpenerSource: PluginFileOpenerSource | null;
  selectedEnvironmentId: string | null;
  selectedHostId: string | null;
}): { environmentId: string | null; hostId: string | null } {
  if (
    fileOpenerSource?.kind === "workspace" &&
    fileOpenerSource.environmentId === null &&
    fileOpenerSource.projectId !== null
  ) {
    return {
      environmentId: null,
      hostId: fileOpenerSource.experimental_hostId ?? null,
    };
  }
  return {
    environmentId: selectedEnvironmentId,
    hostId: selectedHostId,
  };
}

export function RootComposePanelTabContent({
  activeTabId,
  canCreateTerminal,
  currentProjectId,
  isPanelOpen,
  isPanelPersistedOpen,
  isProjectless,
  onActivateTab,
  onAutoFocusNewTabHandled,
  onAutoFocusTerminalHandled,
  onCloseTerminal,
  onOpenBrowser,
  onOpenPanelLink,
  onRetryTerminalStart,
  onSelectFileSearchResult,
  onSelectionAddToChat,
  onStartTerminal,
  pane,
  primaryHostId,
  pluginActions,
  projectSources,
  projects,
  rootPanelEnvironmentId,
  rootPanelThreadId,
  rootProjectHostId,
  shouldAutoFocusNewTab,
  autoFocusTerminalId,
  tab,
  terminalTarget,
}: RootComposePanelTabContentProps) {
  switch (tab.kind) {
    case "plugin-detail":
      return <PluginDetailTabContent detailKey={tab.detailKey} />;
    case "browser":
      return null;
    case "attachment-file-preview":
      return (
        <LazyAttachmentFilePreviewTabContent
          isPanelOpen={isPanelOpen}
          name={tab.name}
          onSelectionAddToChat={onSelectionAddToChat}
          path={tab.path}
          projectId={tab.projectId}
        />
      );
    case "terminal":
      return terminalTarget === null ? null : (
        <LazyThreadTerminalPanel
          autoFocus={
            pane.isFocused &&
            tab.id === activeTabId &&
            tab.terminalId === autoFocusTerminalId
          }
          isPanelOpen={isPanelOpen}
          isPanelPersistedOpen={isPanelPersistedOpen}
          onAutoFocusHandled={onAutoFocusTerminalHandled}
          onCloseStart={() => onCloseTerminal(tab.terminalId)}
          onOpenLink={onOpenPanelLink}
          onRetryStart={() => onRetryTerminalStart(tab.terminalId)}
          onSelectionAddToChat={onSelectionAddToChat}
          target={terminalTarget}
          terminalId={tab.terminalId}
        />
      );
    case "new-tab":
      return (
        <LazyNewTabPage
          autoFocus={
            pane.isFocused && tab.id === activeTabId && shouldAutoFocusNewTab
          }
          projectId={isProjectless ? undefined : currentProjectId}
          environmentId={rootPanelEnvironmentId}
          hostId={rootProjectHostId}
          currentThreadId={rootPanelThreadId ?? ""}
          onAutoFocusHandled={onAutoFocusNewTabHandled}
          onSelect={(selection) => {
            onActivateTab(tab.id);
            onSelectFileSearchResult(selection);
          }}
          recentItemsThreadId={ROOT_COMPOSE_FIXED_PANEL_STATE_ID}
          onOpenBrowser={
            onOpenBrowser === null
              ? undefined
              : () => {
                  onActivateTab(tab.id);
                  onOpenBrowser();
                }
          }
          onStartTerminal={
            canCreateTerminal
              ? () => {
                  onActivateTab(tab.id);
                  onStartTerminal();
                }
              : undefined
          }
          pluginActions={pluginActions}
          showFileSearch={!isProjectless}
        />
      );
    case "workspace-file-preview":
    case "host-file-preview":
    case "thread-storage-file-preview":
      return (
        <RootComposeFilePreviewTabContent
          currentProjectId={currentProjectId}
          fileOpenerSource={null}
          isFocused={pane.isFocused}
          isPanelOpen={isPanelOpen}
          isProjectless={isProjectless}
          onSelectionAddToChat={onSelectionAddToChat}
          primaryHostId={primaryHostId}
          projectSources={projectSources}
          projects={projects}
          rootPanelEnvironmentId={rootPanelEnvironmentId}
          rootPanelThreadId={rootPanelThreadId}
          rootProjectHostId={rootProjectHostId}
          tab={tab}
        />
      );
    case "plugin-panel": {
      const fileOpenerFile = parseFileOpenerParams(tab.paramsJson);
      const originalTab = createFileOpenerOriginalTab(tab);
      if (originalTab === null) {
        return (
          <PluginPanelTabContent
            tab={tab}
            context={{
              kind: "new-thread",
              projectId: isProjectless ? null : currentProjectId,
            }}
          />
        );
      }
      return (
        <RootComposeFilePreviewTabContent
          currentProjectId={currentProjectId}
          fileOpenerSource={fileOpenerFile?.source ?? null}
          isFocused={pane.isFocused}
          isPanelOpen={isPanelOpen}
          isProjectless={isProjectless}
          onSelectionAddToChat={onSelectionAddToChat}
          pluginPanelTab={tab}
          primaryHostId={primaryHostId}
          projectSources={projectSources}
          projects={projects}
          rootPanelEnvironmentId={rootPanelEnvironmentId}
          rootPanelThreadId={rootPanelThreadId}
          rootProjectHostId={rootProjectHostId}
          tab={originalTab}
        />
      );
    }
  }
}

function RootComposeFilePreviewTabContent({
  currentProjectId,
  fileOpenerSource,
  isFocused,
  isPanelOpen,
  isProjectless,
  onSelectionAddToChat,
  pluginPanelTab,
  primaryHostId,
  projectSources,
  projects,
  rootPanelEnvironmentId,
  rootPanelThreadId,
  rootProjectHostId,
  tab,
}: RootComposeFilePreviewTabContentProps) {
  const environmentId =
    fileOpenerSource === null
      ? (tab.environmentId ?? rootPanelEnvironmentId)
      : fileOpenerSource.environmentId;
  const environmentQuery = useEnvironment(environmentId, {
    enabled: environmentId !== null,
    staleTime: 5_000,
  });
  const environment = environmentQuery.data;
  const imageThreadId = fileOpenerSource?.threadId ?? rootPanelThreadId;
  const storageThreadId =
    tab.kind === "thread-storage-file-preview"
      ? fileOpenerSource === null
        ? (tab.threadId ?? rootPanelThreadId)
        : fileOpenerSource.threadId
      : null;
  const threadStorageLocationQuery = useThreadStorageLocation(
    storageThreadId ?? "",
    { enabled: storageThreadId !== null },
  );
  const threadStorageRootPath =
    threadStorageLocationQuery.data?.storageRootPath ?? null;
  const projectPreviewId =
    tab.kind === "workspace-file-preview" && tab.environmentId === null
      ? fileOpenerSource?.kind === "workspace"
        ? fileOpenerSource.projectId
        : (tab.projectId ?? currentProjectId)
      : null;
  const previewProjectSources =
    projectPreviewId === null
      ? []
      : projectPreviewId === currentProjectId
        ? projectSources
        : (projects?.find((project) => project.id === projectPreviewId)
            ?.sources ?? []);
  const projectFilePreviewRouting = resolveRootComposeProjectFileRouting({
    fileOpenerSource,
    selectedEnvironmentId: rootPanelEnvironmentId,
    selectedHostId: rootProjectHostId,
  });
  const projectSourceRoutingHostId =
    projectFilePreviewRouting.environmentId === null
      ? (projectFilePreviewRouting.hostId ?? primaryHostId)
      : null;
  const projectPreviewRootPath =
    projectPreviewId === null
      ? null
      : projectFilePreviewRouting.environmentId !== null
        ? (environment?.path ?? null)
        : projectSourceRoutingHostId !== null
          ? (findLocalPathProjectSourceForHost(
              previewProjectSources,
              projectSourceRoutingHostId,
            )?.path ?? null)
          : null;
  const projectPreviewHostId =
    projectPreviewRootPath === null
      ? null
      : projectFilePreviewRouting.environmentId !== null
        ? (environment?.hostId ?? null)
        : projectSourceRoutingHostId;
  const workspaceRootPath = environment?.path ?? null;
  const projectPreviewPath = resolveAbsoluteFilePath({
    path: tab.path,
    rootPath: projectPreviewRootPath,
  });
  const externalFileTarget: ExperimentalLiveFileTarget | null =
    tab.kind === "host-file-preview"
      ? environment
        ? { kind: "host", hostId: environment.hostId, path: tab.path }
        : null
      : tab.kind === "thread-storage-file-preview"
        ? storageThreadId
          ? {
              kind: "thread-storage",
              threadId: storageThreadId,
              path: tab.path,
            }
          : null
        : tab.environmentId !== null
          ? environmentId
            ? { kind: "workspace", environmentId, path: tab.path }
            : null
          : projectPreviewHostId !== null && projectPreviewPath !== null
            ? {
                kind: "host",
                hostId: projectPreviewHostId,
                path: projectPreviewPath,
              }
            : null;
  const canOpenFileExternally = useCanOpenFileExternally(externalFileTarget);
  const { openFileExternally } = useAppNavigationHost();
  const hostFileLineNumber = getFilePreviewLineRangeStart({
    lineRange: tab.kind === "host-file-preview" ? tab.lineRange : null,
  });
  const onOpenInEditor =
    externalFileTarget !== null && canOpenFileExternally
      ? () => {
          openFileExternally({
            target: externalFileTarget,
            location:
              hostFileLineNumber === null
                ? null
                : { kind: "line", line: hostFileLineNumber, column: null },
          });
        }
      : undefined;

  useAppCommandHandler("workspace.openPreferred", () => {
    if (!isFocused || onOpenInEditor === undefined) return false;
    onOpenInEditor();
    return true;
  });

  let original: ReactNode;
  switch (tab.kind) {
    case "workspace-file-preview": {
      const copyPath =
        tab.environmentId === null
          ? projectPreviewPath
          : resolveAbsoluteFilePath({
              path: tab.path,
              rootPath: workspaceRootPath,
            });
      original =
        tab.environmentId !== null ? (
          <LazyWorkspaceFilePreviewTabContent
            activePath={tab.path}
            copyPath={copyPath}
            environmentId={tab.environmentId}
            isPanelOpen={isPanelOpen}
            lineRange={tab.lineRange}
            onOpenInEditor={onOpenInEditor}
            onSelectionAddToChat={onSelectionAddToChat}
            source={tab.source}
            threadId={imageThreadId}
          />
        ) : projectPreviewId !== null ? (
          <LazyProjectFilePreviewTabContent
            activePath={tab.path}
            copyPath={copyPath}
            environmentId={projectFilePreviewRouting.environmentId}
            hostId={projectFilePreviewRouting.hostId}
            isPanelOpen={isPanelOpen}
            lineRange={tab.lineRange}
            onOpenInEditor={onOpenInEditor}
            onSelectionAddToChat={onSelectionAddToChat}
            projectId={projectPreviewId}
            rootPath={projectPreviewRootPath}
            threadId={imageThreadId}
          />
        ) : (
          <LazyFilePreview
            path={tab.path}
            copyPath={copyPath}
            onOpenInEditor={onOpenInEditor}
            state={{ kind: "loading" }}
          />
        );
      break;
    }
    case "host-file-preview": {
      const threadId =
        fileOpenerSource === null
          ? (tab.threadId ?? rootPanelThreadId)
          : fileOpenerSource.threadId;
      original =
        tab.hostId !== null ? (
          <LazyHostScopedFilePreviewTabContent
            activePath={tab.path}
            hostId={tab.hostId}
            isPanelOpen={isPanelOpen}
            lineRange={tab.lineRange}
            onOpenInEditor={onOpenInEditor}
          />
        ) : threadId && environmentId ? (
          <LazyHostFilePreviewTabContent
            activePath={tab.path}
            copyPath={tab.path}
            environmentId={environmentId}
            isPanelOpen={isPanelOpen}
            lineRange={tab.lineRange}
            onOpenInEditor={onOpenInEditor}
            onSelectionAddToChat={onSelectionAddToChat}
            threadId={threadId}
          />
        ) : (
          <LazyFilePreview
            path={tab.path}
            copyPath={tab.path}
            onOpenInEditor={onOpenInEditor}
            state={{ kind: "loading" }}
          />
        );
      break;
    }
    case "thread-storage-file-preview": {
      const copyPath = resolveAbsoluteFilePath({
        path: tab.path,
        rootPath: threadStorageRootPath,
      });
      original = storageThreadId ? (
        <LazyThreadStorageFilePreviewTabContent
          activePath={tab.path}
          copyPath={copyPath}
          isPanelOpen={isPanelOpen}
          lineRange={tab.lineRange}
          onOpenInEditor={onOpenInEditor}
          onSelectionAddToChat={onSelectionAddToChat}
          threadId={storageThreadId}
        />
      ) : (
        <LazyFilePreview
          path={tab.path}
          copyPath={copyPath}
          onOpenInEditor={onOpenInEditor}
          state={{ kind: "loading" }}
        />
      );
      break;
    }
  }

  return pluginPanelTab === undefined ? (
    original
  ) : (
    <PluginPanelTabContent
      tab={pluginPanelTab}
      context={{
        kind: "new-thread",
        projectId: isProjectless ? null : currentProjectId,
      }}
      fileOpenerOriginal={original}
    />
  );
}
