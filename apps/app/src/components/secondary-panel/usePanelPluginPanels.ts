import { useCallback } from "react";
import {
  createPanelActionOpenPanel,
  type OpenPluginPanelHandler,
} from "@/components/plugin/PluginPanelActions";
import {
  usePublishThreadPanelOpener,
  type PluginThreadPanelOpenHandler,
} from "@/components/plugin/plugin-thread-panel-navigation";

interface PanelPluginAction {
  pluginId: string;
  id: string;
  title: string;
}

interface UsePanelPluginPanelsArgs {
  actions: readonly PanelPluginAction[];
  isFocused: boolean;
  openPluginPanel: OpenPluginPanelHandler;
  reveal: () => void;
  slot: "threadPanelAction" | "experimental_newThreadPanelAction";
}

export function usePanelPluginPanels({
  actions,
  isFocused,
  openPluginPanel,
  reveal,
  slot,
}: UsePanelPluginPanelsArgs): PluginThreadPanelOpenHandler {
  const openThreadPanel = useCallback<PluginThreadPanelOpenHandler>(
    ({ pluginId, actionId, title, params, replaceTabId }) => {
      const action = actions.find(
        (candidate) =>
          candidate.pluginId === pluginId && candidate.id === actionId,
      );
      if (action === undefined) return false;
      const accepted = createPanelActionOpenPanel({
        action,
        slot,
        openPluginPanel,
        replaceTabId,
      })({ title, params });
      if (accepted && replaceTabId === undefined) reveal();
      return accepted;
    },
    [actions, openPluginPanel, reveal, slot],
  );
  usePublishThreadPanelOpener(openThreadPanel, isFocused);
  return openThreadPanel;
}
