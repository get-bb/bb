import { useMemo } from "react";
import type {
  ExperimentalFilePreviewProps,
  ExperimentalLiveFileTarget,
} from "@get-bb/plugin-sdk";
import { getEnvironmentFilePreviewSourceAtRef } from "@bb/client-core";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { normalizeExperimentalLiveFileTarget } from "@/lib/live-file-navigation";
import { useLiveFileOpenTargets } from "@/hooks/useLiveFileOpenTargets";
import { resolveLiveFilePath } from "@/hooks/useResolvedLiveFileTarget";
import { useSelectionAddToChat } from "@/components/thread/SelectionAddToChatContext";
import { FilePreviewRenderPreviewContext } from "@/components/secondary-panel/filePreviewRenderPreviewContext";
import { useShownOutsideHiddenTab } from "@/components/secondary-panel/tab-visibility";
import {
  LazyHostScopedFilePreviewTabContent,
  LazyThreadStorageFilePreviewTabContent,
  LazyWorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/lazySecondaryPanelComponents";

function liveFileRoot(target: ExperimentalLiveFileTarget) {
  switch (target.kind) {
    case "workspace":
      return { kind: target.kind, environmentId: target.environmentId };
    case "host":
      return { kind: target.kind, hostId: target.hostId };
    case "thread-storage":
      return { kind: target.kind, threadId: target.threadId };
  }
}

export function ExperimentalFilePreview({
  target,
  renderPreview,
}: ExperimentalFilePreviewProps) {
  const normalized = useMemo(
    () => normalizeExperimentalLiveFileTarget(target),
    [target],
  );
  const navigation = useAppNavigationHost();
  const onSelectionAddToChat = useSelectionAddToChat();
  const shown = useShownOutsideHiddenTab();
  const openTargets = useLiveFileOpenTargets(
    normalized === null ? null : liveFileRoot(normalized),
  );
  if (normalized === null) return null;

  const copyPath =
    openTargets.root.status === "available"
      ? resolveLiveFilePath(openTargets.root, normalized.path)
      : null;
  const onOpenInEditor = openTargets.canOpenExternally
    ? () => {
        navigation.openFileExternally({ target: normalized, location: null });
      }
    : undefined;

  return (
    <FilePreviewRenderPreviewContext.Provider value={renderPreview}>
      {normalized.kind === "workspace" ? (
        <LazyWorkspaceFilePreviewTabContent
          activePath={normalized.path}
          copyPath={copyPath}
          environmentId={normalized.environmentId}
          isPanelOpen={shown}
          lineRange={null}
          onOpenInEditor={onOpenInEditor}
          onSelectionAddToChat={onSelectionAddToChat}
          source={getEnvironmentFilePreviewSourceAtRef(
            normalized.experimental_ref,
          )}
        />
      ) : normalized.kind === "thread-storage" ? (
        <LazyThreadStorageFilePreviewTabContent
          activePath={normalized.path}
          copyPath={copyPath}
          isPanelOpen={shown}
          lineRange={null}
          onOpenInEditor={onOpenInEditor}
          onSelectionAddToChat={onSelectionAddToChat}
          threadId={normalized.threadId}
        />
      ) : (
        <LazyHostScopedFilePreviewTabContent
          activePath={normalized.path}
          hostId={normalized.hostId}
          isPanelOpen={shown}
          lineRange={null}
          onOpenInEditor={onOpenInEditor}
        />
      )}
    </FilePreviewRenderPreviewContext.Provider>
  );
}
