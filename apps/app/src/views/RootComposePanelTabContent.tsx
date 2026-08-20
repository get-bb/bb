import { useMemo, type ReactNode } from "react";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import type { SidebarProject } from "@/hooks/queries/project-queries";
import { findLocalPathProjectSourceForHost } from "@bb/domain";
import type {
  PluginPanelFixedPanelTab,
  SecondaryFileFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import type { SecondaryPanelPaneRenderContext } from "@/components/secondary-panel/ThreadSecondaryPanel";
import {
  LazyFilePreview,
  LazyHostFilePreviewTabContent,
  LazyNewTabPage,
  LazyProjectFilePreviewTabContent,
  LazyThreadStorageFilePreviewTabContent,
  LazyThreadTerminalPanel,
  LazyWorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/lazySecondaryPanelComponents";
import type { FileSearchSelection } from "@/components/secondary-panel/useThreadFileTabs";
import {
  PluginPanelTabContent,
  type PluginPanelActionEntry,
} from "@/components/plugin/PluginPanelActions";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useThreadStorageViewer } from "@/components/secondary-panel/useThreadStorageViewer";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import {
  buildOpenInEditorHandler,
  resolveEnvironmentOpenContext,
  resolveThreadWorkspacePreviewRootPath,
} from "./thread-detail/threadWorkspaceOpenPath";
import { getFilePreviewLineRangeStart } from "@/lib/file-preview";
import { resolveAbsoluteFilePath } from "@/lib/absolute-file-path";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";

export const ROOT_COMPOSE_FIXED_PANEL_STATE_ID = "root-compose";

export type RootComposeTerminalTarget =
  | { kind: "environment"; environmentId: string }
  | { kind: "host_path"; cwd: string | null; hostId: string };

type RootComposeFilePreviewTab = Extract<
  SecondaryFileFixedPanelTab,
  {
    kind:
      | "workspace-file-preview"
      | "host-file-preview"
      | "thread-storage-file-preview";
  }
>;

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
  onOpenBrowser: () => void;
  onOpenPanelLink: MarkdownPreviewLinkHandler;
  onSelectFileSearchResult: (selection: FileSearchSelection) => void;
  onSelectionAddToChat: (text: string) => void;
  onStartTerminal: () => void;
  pane: SecondaryPanelPaneRenderContext;
  pluginActions: readonly PluginPanelActionEntry[];
  projectSources: SidebarProject["sources"];
  projects: readonly SidebarProject[] | undefined;
  rootPanelEnvironmentId: string | null;
  rootPanelThreadId: string | null;
  rootProjectHostId: string | null;
  shouldAutoFocusNewTab: boolean;
  shouldAutoFocusTerminal: boolean;
  tab: SecondaryFileFixedPanelTab;
  terminalTarget: RootComposeTerminalTarget | null;
}

interface RootComposeFilePreviewTabContentProps {
  currentProjectId: string;
  isFocused: boolean;
  isPanelOpen: boolean;
  isProjectless: boolean;
  onSelectionAddToChat: (text: string) => void;
  pluginPanelTab?: PluginPanelFixedPanelTab;
  projectSources: SidebarProject["sources"];
  projects: readonly SidebarProject[] | undefined;
  rootPanelEnvironmentId: string | null;
  rootPanelThreadId: string | null;
  rootProjectHostId: string | null;
  tab: RootComposeFilePreviewTab;
}

function resolveHostOpenContext(args: {
  hostId: string | null;
  isLocal: boolean;
  serverOrigin: string;
}): OpenInTargetContext | null {
  if (args.hostId === null) return null;
  if (args.isLocal) return { kind: "local" };
  return {
    kind: "remote-ssh",
    serverOrigin: args.serverOrigin,
    hostId: args.hostId,
  };
}

function fileOpenerOriginalTab(
  tab: PluginPanelFixedPanelTab,
): RootComposeFilePreviewTab | null {
  const owner = tab.fileOpenerOwner;
  if (owner === undefined) return null;
  if (owner.kind === "workspace-file-preview") {
    return {
      ...owner.tab,
      environmentId: owner.environmentId,
      id: `${tab.id}:file-opener-original`,
      kind: "workspace-file-preview",
      projectId: owner.projectId,
    };
  }
  if (owner.kind === "host-file-preview") {
    return {
      ...owner.tab,
      environmentId: owner.environmentId,
      id: `${tab.id}:file-opener-original`,
      kind: "host-file-preview",
      threadId: owner.threadId,
    };
  }
  return {
    ...owner.tab,
    environmentId: owner.environmentId,
    id: `${tab.id}:file-opener-original`,
    isPinned: false,
    kind: "thread-storage-file-preview",
    threadId: owner.threadId,
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
  onOpenBrowser,
  onOpenPanelLink,
  onSelectFileSearchResult,
  onSelectionAddToChat,
  onStartTerminal,
  pane,
  pluginActions,
  projectSources,
  projects,
  rootPanelEnvironmentId,
  rootPanelThreadId,
  rootProjectHostId,
  shouldAutoFocusNewTab,
  shouldAutoFocusTerminal,
  tab,
  terminalTarget,
}: RootComposePanelTabContentProps) {
  switch (tab.kind) {
    case "browser":
      return null;
    case "terminal":
      return terminalTarget === null ? null : (
        <LazyThreadTerminalPanel
          autoFocus={
            pane.isFocused && tab.id === activeTabId && shouldAutoFocusTerminal
          }
          canCreateTerminal={canCreateTerminal}
          isPanelOpen={isPanelOpen}
          isPanelPersistedOpen={isPanelPersistedOpen}
          onAutoFocusHandled={onAutoFocusTerminalHandled}
          onOpenLink={onOpenPanelLink}
          onSelectionAddToChat={onSelectionAddToChat}
          panelStateId={ROOT_COMPOSE_FIXED_PANEL_STATE_ID}
          syncThreadId={null}
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
            rootPanelThreadId
              ? () => {
                  onActivateTab(tab.id);
                  onOpenBrowser();
                }
              : undefined
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
          isFocused={pane.isFocused}
          isPanelOpen={isPanelOpen}
          isProjectless={isProjectless}
          onSelectionAddToChat={onSelectionAddToChat}
          projectSources={projectSources}
          projects={projects}
          rootPanelEnvironmentId={rootPanelEnvironmentId}
          rootPanelThreadId={rootPanelThreadId}
          rootProjectHostId={rootProjectHostId}
          tab={tab}
        />
      );
    case "plugin-panel": {
      const originalTab = fileOpenerOriginalTab(tab);
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
          isFocused={pane.isFocused}
          isPanelOpen={isPanelOpen}
          isProjectless={isProjectless}
          onSelectionAddToChat={onSelectionAddToChat}
          pluginPanelTab={tab}
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
  isFocused,
  isPanelOpen,
  isProjectless,
  onSelectionAddToChat,
  pluginPanelTab,
  projectSources,
  projects,
  rootPanelEnvironmentId,
  rootPanelThreadId,
  rootProjectHostId,
  tab,
}: RootComposeFilePreviewTabContentProps) {
  const environmentId = tab.environmentId ?? rootPanelEnvironmentId;
  const environmentQuery = useEnvironment(environmentId, {
    enabled: environmentId !== null,
    staleTime: 5_000,
  });
  const environment = environmentQuery.data;
  const storageThreadId =
    tab.kind === "thread-storage-file-preview"
      ? (tab.threadId ?? rootPanelThreadId)
      : null;
  const { threadStorageRootPath } = useThreadStorageViewer({
    activePath: null,
    fileListEnabled: storageThreadId !== null,
    filePreviewEnabled: false,
    threadId: storageThreadId ?? undefined,
  });
  const projectPreviewId =
    tab.kind === "workspace-file-preview" && tab.environmentId === null
      ? (tab.projectId ?? currentProjectId)
      : null;
  const previewProjectSources =
    projectPreviewId === null
      ? []
      : projectPreviewId === currentProjectId
        ? projectSources
        : (projects?.find((project) => project.id === projectPreviewId)
            ?.sources ?? []);
  const projectPreviewRootPath =
    projectPreviewId === null
      ? null
      : rootPanelEnvironmentId !== null
        ? (environment?.path ?? null)
        : rootProjectHostId !== null
          ? (findLocalPathProjectSourceForHost(
              previewProjectSources,
              rootProjectHostId,
            )?.path ?? null)
          : null;
  const projectPreviewHostId =
    projectPreviewRootPath === null
      ? null
      : (environment?.hostId ?? rootProjectHostId);
  const { isLocalDaemonHost } = useHostDaemon();
  const serverOrigin = window.location.origin;
  const environmentOpenContext = resolveEnvironmentOpenContext({
    environment,
    threadEnvironmentIsLocal: environment
      ? isLocalDaemonHost(environment.hostId)
      : false,
    serverOrigin,
  });
  const projectOpenContext = resolveHostOpenContext({
    hostId: projectPreviewHostId,
    isLocal: isLocalDaemonHost(projectPreviewHostId),
    serverOrigin,
  });
  const openContext =
    tab.kind === "workspace-file-preview" && tab.environmentId === null
      ? projectOpenContext
      : environmentOpenContext;
  const { canOpenPreferredFileTarget, openPathInPreferredFileTarget } =
    useLocalOpenTargets({
      enabled: openContext !== null,
      ...(openContext ? { openContext } : {}),
    });
  const workspaceRootPath = resolveThreadWorkspacePreviewRootPath({
    environment,
  });
  const relativeFileRootPath =
    tab.kind === "workspace-file-preview"
      ? tab.environmentId === null
        ? projectPreviewRootPath
        : workspaceRootPath
      : tab.kind === "thread-storage-file-preview"
        ? threadStorageRootPath
        : null;
  const openRelativeFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: relativeFileRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
      relativeFileRootPath,
    ],
  );
  const hostFileLineNumber = getFilePreviewLineRangeStart({
    lineRange: tab.kind === "host-file-preview" ? tab.lineRange : null,
  });
  const openHostFileInEditor =
    tab.kind === "host-file-preview" && canOpenPreferredFileTarget
      ? (path: string) => {
          void openPathInPreferredFileTarget({
            lineNumber: hostFileLineNumber,
            path,
          });
        }
      : undefined;
  const onOpenInEditor =
    tab.kind === "host-file-preview"
      ? openHostFileInEditor
      : openRelativeFileInEditor;

  useAppCommandHandler("workspace.openPreferred", () => {
    if (!isFocused || onOpenInEditor === undefined) return false;
    onOpenInEditor(tab.path);
    return true;
  });

  let original: ReactNode;
  switch (tab.kind) {
    case "workspace-file-preview": {
      const copyPath = resolveAbsoluteFilePath({
        path: tab.path,
        rootPath:
          tab.environmentId === null
            ? projectPreviewRootPath
            : workspaceRootPath,
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
            statusLabel={tab.statusLabel}
            threadId={rootPanelThreadId}
          />
        ) : projectPreviewId !== null ? (
          <LazyProjectFilePreviewTabContent
            activePath={tab.path}
            copyPath={copyPath}
            environmentId={rootPanelEnvironmentId}
            hostId={projectPreviewHostId}
            isPanelOpen={isPanelOpen}
            lineRange={tab.lineRange}
            onOpenInEditor={onOpenInEditor}
            onSelectionAddToChat={onSelectionAddToChat}
            projectId={projectPreviewId}
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
      const threadId = tab.threadId ?? rootPanelThreadId;
      original =
        threadId && environmentId ? (
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
