import type { ReactNode } from "react";
import type { PluginPanelActionEntry } from "@/components/plugin/PluginPanelActions";
import {
  NewTabActions,
  NewTabFileSearch,
  type NewTabFileSearchProps,
  type OpenBrowserHandler,
  type StartTerminalHandler,
} from "./NewTabFileSearch";

type NewTabPageFileSearchProps = Omit<NewTabFileSearchProps, "idleActions">;

export interface NewTabPageProps extends NewTabPageFileSearchProps {
  onOpenBrowser?: OpenBrowserHandler;
  onStartTerminal?: StartTerminalHandler;
  pluginActions?: readonly PluginPanelActionEntry[];
  startTerminalDisabled?: boolean;
  startTerminalTrailing?: ReactNode;
}

/**
 * Browser-style "New Tab" landing page for the secondary panel. The tab body
 * keeps file search primary while secondary commands live in-page, avoiding
 * overlays that can be occluded by native browser/webview surfaces.
 */
export function NewTabPage({
  autoFocus,
  currentThreadId,
  environmentId,
  hostId,
  initialQuery,
  onAutoFocusHandled,
  onOpenBrowser,
  onSelect,
  onStartTerminal,
  pluginActions,
  projectId,
  recentItemsThreadId,
  showFileSearch,
  startTerminalDisabled,
  startTerminalTrailing,
}: NewTabPageProps) {
  return (
    <div className="flex min-h-full flex-col gap-3 bg-sidebar px-4 pb-3 pt-1">
      <NewTabFileSearch
        projectId={projectId}
        environmentId={environmentId}
        hostId={hostId}
        currentThreadId={currentThreadId}
        autoFocus={autoFocus}
        idleActions={
          <NewTabActions
            onOpenBrowser={onOpenBrowser}
            onStartTerminal={onStartTerminal}
            pluginActions={pluginActions}
            startTerminalDisabled={startTerminalDisabled}
            startTerminalTrailing={startTerminalTrailing}
          />
        }
        initialQuery={initialQuery}
        onAutoFocusHandled={onAutoFocusHandled}
        onSelect={onSelect}
        recentItemsThreadId={recentItemsThreadId}
        showFileSearch={showFileSearch}
      />
    </div>
  );
}
