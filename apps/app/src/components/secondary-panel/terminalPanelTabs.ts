import { closeSecondaryPanelTabInState } from "@bb/client-core";
import type { TerminalSession } from "@bb/server-contract";
import {
  createTerminalFixedPanelTab,
  type FixedPanelTabsState,
  type FixedPanelTab,
  type SecondaryFileFixedPanelTab,
  type SecondaryFixedPanelTab,
  type TerminalFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { isVisibleTerminalSession } from "@/lib/terminal-session-visibility";

interface TerminalTabSources {
  startingTerminalIds: ReadonlySet<string>;
  terminalSessions: readonly TerminalSession[];
}

interface BuildTerminalSyncedSecondaryFileTabsArgs extends TerminalTabSources {
  orderedTabs: readonly SecondaryFileFixedPanelTab[];
}

interface SyncTerminalTabsInFixedPanelStateArgs extends TerminalTabSources {
  state: FixedPanelTabsState;
}

interface SyncTerminalTabsWithSessionsArgs<
  T extends SecondaryFixedPanelTab,
> extends TerminalTabSources {
  tabs: readonly T[];
}

interface PruneTerminalTabsForSessionsArgs extends TerminalTabSources {
  tabs: readonly FixedPanelTab[];
}

function getTerminalSessionTabIds({
  startingTerminalIds,
  terminalSessions,
}: TerminalTabSources): ReadonlySet<string> {
  const ids = new Set(startingTerminalIds);
  for (const session of terminalSessions) {
    if (isVisibleTerminalSession(session)) ids.add(session.id);
  }
  return ids;
}

export function pruneTerminalTabsForSessions({
  startingTerminalIds,
  tabs,
  terminalSessions,
}: PruneTerminalTabsForSessionsArgs): readonly FixedPanelTab[] {
  const terminalSessionIds = getTerminalSessionTabIds({
    startingTerminalIds,
    terminalSessions,
  });
  const nextTabs = tabs.filter(
    (tab) => tab.kind !== "terminal" || terminalSessionIds.has(tab.terminalId),
  );
  return nextTabs.length === tabs.length ? tabs : nextTabs;
}

export function pruneTerminalTabsInFixedPanelState({
  startingTerminalIds,
  state,
  terminalSessions,
}: SyncTerminalTabsInFixedPanelStateArgs): FixedPanelTabsState {
  const tabs = pruneTerminalTabsForSessions({
    startingTerminalIds,
    tabs: state.secondary.tabs,
    terminalSessions,
  });
  if (tabs === state.secondary.tabs) return state;
  const retainedIds = new Set(tabs.map((tab) => tab.id));
  let next = state;
  for (const tab of state.secondary.tabs) {
    if (!retainedIds.has(tab.id)) {
      next = closeSecondaryPanelTabInState(next, tab.id);
    }
  }
  return next;
}

function syncTerminalTabsWithSessions<T extends SecondaryFixedPanelTab>({
  startingTerminalIds,
  tabs,
  terminalSessions,
}: SyncTerminalTabsWithSessionsArgs<T>): {
  tabs: Array<T | TerminalFixedPanelTab>;
  changed: boolean;
} {
  const terminalSessionIds = getTerminalSessionTabIds({
    startingTerminalIds,
    terminalSessions,
  });
  const seenTerminalIds = new Set<string>();
  const syncedTabs: Array<T | TerminalFixedPanelTab> = [];
  let changed = false;

  for (const tab of tabs) {
    if (tab.kind === "terminal") {
      if (
        !terminalSessionIds.has(tab.terminalId) ||
        seenTerminalIds.has(tab.terminalId)
      ) {
        changed = true;
        continue;
      }
      seenTerminalIds.add(tab.terminalId);
    }
    syncedTabs.push(tab);
  }

  for (const session of terminalSessions) {
    if (!isVisibleTerminalSession(session)) {
      continue;
    }
    if (seenTerminalIds.has(session.id)) {
      continue;
    }
    seenTerminalIds.add(session.id);
    syncedTabs.push(createTerminalFixedPanelTab({ terminalId: session.id }));
    changed = true;
  }

  return { tabs: syncedTabs, changed };
}

export function buildTerminalSyncedSecondaryFileTabs({
  orderedTabs,
  startingTerminalIds,
  terminalSessions,
}: BuildTerminalSyncedSecondaryFileTabsArgs): readonly SecondaryFileFixedPanelTab[] {
  return syncTerminalTabsWithSessions({
    startingTerminalIds,
    tabs: orderedTabs,
    terminalSessions,
  }).tabs;
}

export function syncTerminalTabsInFixedPanelState({
  startingTerminalIds,
  state,
  terminalSessions,
}: SyncTerminalTabsInFixedPanelStateArgs): FixedPanelTabsState {
  state = pruneTerminalTabsInFixedPanelState({
    startingTerminalIds,
    state,
    terminalSessions,
  });
  const { tabs, changed } = syncTerminalTabsWithSessions({
    startingTerminalIds,
    tabs: state.secondary.tabs,
    terminalSessions,
  });

  const activeTabId =
    state.secondary.activeTabId !== null &&
    tabs.some((tab) => tab.id === state.secondary.activeTabId)
      ? state.secondary.activeTabId
      : null;

  if (!changed && activeTabId === state.secondary.activeTabId) {
    return state;
  }

  return {
    ...state,
    secondary: {
      ...state.secondary,
      activeTabId,
      tabs,
    },
  };
}
