// The persisted-panel schema, tab constructors, and normalization live in
// @bb/client-core (shared with the native app). This module re-exports them and
// keeps the two web-only pieces: browser tabs (nanoid ids for the desktop
// browser) and localStorage pruning.
import { nanoid } from "nanoid";
import {
  buildFixedPanelTabId,
  isFixedPanelTabsStateStorageKey,
  shouldPruneStoredFixedPanelTabsState,
  type BrowserFixedPanelTab,
} from "@bb/client-core";
import { getLocalStorage } from "./browser-storage";

export {
  FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
  FIXED_PANEL_TABS_IDLE_EXPIRY_MS,
  buildFixedPanelTabId,
  createThreadInfoFixedPanelTab,
  createGitDiffFixedPanelTab,
  createPluginPageFixedPanelTab,
  createPluginPanelFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  createHostFilePreviewFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  createNewTabFixedPanelTab,
  ensureOpenFixedPanelHasActiveTab,
  createTerminalFixedPanelTab,
  createEmptyFixedPanelTabsState,
  EMPTY_FIXED_PANEL_TABS_STATE,
  getFixedPanelTabsStateStorageKey,
  isFixedPanelTabsStateStorageKey,
  parseFixedPanelTabsState,
  serializeFixedPanelTabsState,
  areFixedPanelTabsEquivalent,
} from "@bb/client-core";
export type {
  PluginPageFixedPanelTab,
  FixedPanelViewTab,
  PluginPanelFixedPanelTab,
  WorkspaceFilePreviewFixedPanelTab,
  HostFilePreviewFixedPanelTab,
  ThreadStorageFilePreviewFixedPanelTab,
  BrowserFixedPanelTab,
  NewTabFixedPanelTab,
  TerminalFixedPanelTab,
  SecondaryFixedPanelTab,
  SecondaryFileFixedPanelTab,
  FixedPanelTab,
  FixedPanelTabsState,
} from "@bb/client-core";

interface CreateBrowserFixedPanelTabArgs {
  environmentId: string | null;
  url: string;
}

interface PruneFixedPanelTabsStorageArgs {
  now: number;
}

/**
 * Browser tabs get a fresh unique id per instance — the URL is mutable (it
 * changes on every navigation), so it cannot serve as a stable identity the way
 * a file path does.
 */
export function createBrowserFixedPanelTab({
  environmentId,
  url,
}: CreateBrowserFixedPanelTabArgs): BrowserFixedPanelTab {
  const browserInstanceId = nanoid();
  return {
    environmentId,
    id: buildFixedPanelTabId({
      environmentId,
      kind: "browser",
      path: browserInstanceId,
    }),
    kind: "browser",
    title: null,
    url,
  };
}

export function pruneFixedPanelTabsStorage({
  now,
}: PruneFixedPanelTabsStorageArgs): void {
  const localStorage = getLocalStorage();
  if (!localStorage) {
    return;
  }

  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && isFixedPanelTabsStateStorageKey(key)) {
      keys.push(key);
    }
  }

  for (const key of keys) {
    if (shouldPruneStoredFixedPanelTabsState(localStorage.getItem(key), now)) {
      localStorage.removeItem(key);
    }
  }
}
