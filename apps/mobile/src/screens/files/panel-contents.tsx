import type { FilePreviewLineRange } from "@bb/client-core";
import { useCallback, useEffect, useMemo } from "react";
import { useEnvironment } from "@/data/environments";
import type { PanelScope } from "../panel/panel-model";
import { usePanel } from "../panel/PanelProvider";
import type {
  PanelLauncherContentProps,
  PanelTabContentProps,
} from "../panel/registry";
import type { FilePreviewTarget } from "./file-preview-target";
import { FilePreviewView } from "./FilePreviewView";
import { FilesTabContent } from "./FilesTabContent";

/**
 * Panel-hosted variants of the Files surfaces: the launcher page renders
 * `FilesTabContent` inside the sheet and opens files as panel tabs; the
 * three preview tab kinds render `FilePreviewView` for the client-core tab
 * state (path / source / line range), "Add to chat" quoting into the thread
 * composer and closing the panel.
 */

function scopeThreadId(scope: PanelScope): string | null {
  return scope.kind === "thread" ? scope.threadId : null;
}

export function FilesLauncherContent({
  scope,
  filesParams,
}: PanelLauncherContentProps) {
  const panel = usePanel();
  const consumeFilesParams = panel.consumeFilesParams;
  const initialQuery = filesParams?.initialQuery ?? null;
  useEffect(() => {
    if (filesParams !== null) consumeFilesParams();
  }, [consumeFilesParams, filesParams]);
  // Files open through the default opener, which targets this panel (the
  // sheet re-provides the controller) and records recents.
  return (
    <FilesTabContent
      threadId={scopeThreadId(scope)}
      projectId={scope.projectId}
      environmentId={scope.environmentId}
      hostId={scope.hostId}
      scroll="sheet"
      initialQuery={initialQuery}
      testID="panel-files-launcher"
    />
  );
}

function PanelFilePreview({
  scope,
  target,
  lineRange,
  environmentId,
  threadId,
  projectId,
}: {
  scope: PanelScope;
  target: FilePreviewTarget;
  lineRange: FilePreviewLineRange | null;
  environmentId: string | null;
  threadId: string | null;
  projectId: string | null;
}) {
  const panel = usePanel();
  const environment = useEnvironment(environmentId);
  const closePanel = panel.close;
  const onAddedToChat = useCallback(() => closePanel(), [closePanel]);
  return (
    <FilePreviewView
      threadId={threadId}
      projectId={projectId}
      environmentId={environmentId}
      hostId={scope.hostId}
      workspaceRootPath={environment.data?.path ?? null}
      target={target}
      lineRange={lineRange}
      onAddedToChat={onAddedToChat}
      inSheet
      testID="panel-file-preview"
    />
  );
}

export function WorkspaceFilePreviewTabContent({
  scope,
  tab,
}: PanelTabContentProps<
  Extract<PanelTabContentProps["tab"], { kind: "workspace-file-preview" }>
>) {
  const environmentId = tab.environmentId ?? scope.environmentId;
  const projectId = tab.projectId ?? scope.projectId;
  const target = useMemo<FilePreviewTarget>(
    () =>
      environmentId === null
        ? { kind: "project-file", path: tab.path }
        : {
            kind: "workspace-file",
            path: tab.path,
            source: tab.source,
            statusLabel: tab.statusLabel,
          },
    [environmentId, tab.path, tab.source, tab.statusLabel],
  );
  return (
    <PanelFilePreview
      scope={scope}
      target={target}
      lineRange={tab.lineRange}
      environmentId={environmentId}
      threadId={scopeThreadId(scope)}
      projectId={projectId}
    />
  );
}

export function HostFilePreviewTabContent({
  scope,
  tab,
}: PanelTabContentProps<
  Extract<PanelTabContentProps["tab"], { kind: "host-file-preview" }>
>) {
  const target = useMemo<FilePreviewTarget>(
    () => ({ kind: "host-file", path: tab.path }),
    [tab.path],
  );
  return (
    <PanelFilePreview
      scope={scope}
      target={target}
      lineRange={tab.lineRange}
      environmentId={tab.environmentId ?? scope.environmentId}
      threadId={tab.threadId ?? scopeThreadId(scope)}
      projectId={scope.projectId}
    />
  );
}

export function ThreadStorageFilePreviewTabContent({
  scope,
  tab,
}: PanelTabContentProps<
  Extract<PanelTabContentProps["tab"], { kind: "thread-storage-file-preview" }>
>) {
  const target = useMemo<FilePreviewTarget>(
    () => ({ kind: "storage-file", path: tab.path }),
    [tab.path],
  );
  return (
    <PanelFilePreview
      scope={scope}
      target={target}
      lineRange={tab.lineRange}
      environmentId={tab.environmentId ?? scope.environmentId}
      threadId={tab.threadId ?? scopeThreadId(scope)}
      projectId={scope.projectId}
    />
  );
}
