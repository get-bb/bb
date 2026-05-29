import { useCallback } from "react";
import {
  useCloseFixedSecondaryPanel,
  useSetFixedSecondaryPanelTab,
  useToggleFixedSecondaryPanel,
} from "@/lib/fixed-panel-tabs";
import type {
  FixedPanelTab,
  FixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";
import type { ThreadSecondaryPanel } from "@/lib/thread-secondary-panel";

type ThreadSecondaryPanelThreadId = string | null | undefined;
type ActiveFixedPanelTab = FixedPanelTab | null;
type ActiveThreadSecondaryPanel = ThreadSecondaryPanel | null;

type NullableSecondaryPanelSetter = (panel: ActiveThreadSecondaryPanel) => void;

interface GetActiveFixedSecondaryTabArgs {
  fixedPanelTabsState: FixedPanelTabsState;
}

interface GetSelectedThreadSecondaryPanelArgs {
  activeFixedSecondaryTab: ActiveFixedPanelTab;
}

interface GetActiveThreadSecondaryPanelArgs {
  fixedPanelTabsState: FixedPanelTabsState;
  selectedSecondaryPanel: ActiveThreadSecondaryPanel;
}

export function getActiveFixedSecondaryTab({
  fixedPanelTabsState,
}: GetActiveFixedSecondaryTabArgs): ActiveFixedPanelTab {
  const activeTabId = fixedPanelTabsState.secondary.activeTabId;
  if (activeTabId === null) {
    return null;
  }
  return (
    fixedPanelTabsState.secondary.tabs.find((tab) => tab.id === activeTabId) ??
    null
  );
}

function getSecondaryPanelForFixedTab(
  tab: ActiveFixedPanelTab,
): ActiveThreadSecondaryPanel {
  if (tab === null) {
    return null;
  }
  switch (tab.kind) {
    case "thread-info":
      return "thread-info";
    case "git-diff":
      return "git-diff";
    case "workspace-file-preview":
    case "host-file-preview":
    case "thread-storage-file-preview":
    case "app":
    case "browser":
    case "new-tab":
      return "thread-info";
    case "terminal":
      return null;
  }
}

export function getSelectedThreadSecondaryPanel({
  activeFixedSecondaryTab,
}: GetSelectedThreadSecondaryPanelArgs): ActiveThreadSecondaryPanel {
  return getSecondaryPanelForFixedTab(activeFixedSecondaryTab);
}

export function getActiveThreadSecondaryPanel({
  fixedPanelTabsState,
  selectedSecondaryPanel,
}: GetActiveThreadSecondaryPanelArgs): ActiveThreadSecondaryPanel {
  return fixedPanelTabsState.secondary.isOpen ? selectedSecondaryPanel : null;
}

export function useSetThreadSecondaryPanelSelection(
  threadId: ThreadSecondaryPanelThreadId,
): NullableSecondaryPanelSetter {
  const closeFixedSecondaryPanel = useCloseFixedSecondaryPanel(threadId);
  const setFixedSecondaryPanelTab = useSetFixedSecondaryPanelTab(threadId);

  return useCallback<NullableSecondaryPanelSetter>(
    (panel) => {
      if (panel === null) {
        closeFixedSecondaryPanel();
        return;
      }
      setFixedSecondaryPanelTab(panel);
    },
    [closeFixedSecondaryPanel, setFixedSecondaryPanelTab],
  );
}

export function useToggleThreadSecondaryPanelSelection(
  threadId: ThreadSecondaryPanelThreadId,
): () => void {
  return useToggleFixedSecondaryPanel(threadId);
}
