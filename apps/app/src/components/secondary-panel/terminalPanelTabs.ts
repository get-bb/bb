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
import type { PendingTerminalIds } from "@/components/thread/terminal/pending-terminals";

interface TerminalTabSources {
  pendingTerminalIds: PendingTerminalIds;
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
  pendingTerminalIds,
  terminalSessions,
}: TerminalTabSources): ReadonlySet<string> {
  const ids = new Set(pendingTerminalIds.starting);
  for (const session of terminalSessions) {
    if (isVisibleTerminalSession(session)) ids.add(session.id);
  }
  for (const terminalId of pendingTerminalIds.closing) ids.delete(terminalId);
  return ids;
}

export function pruneTerminalTabsForSessions({
  pendingTerminalIds,
  tabs,
  terminalSessions,
}: PruneTerminalTabsForSessionsArgs): readonly FixedPanelTab[] {
  const terminalSessionIds = getTerminalSessionTabIds({
    pendingTerminalIds,
    terminalSessions,
  });
  const nextTabs = tabs.filter(
    (tab) => tab.kind !== "terminal" || terminalSessionIds.has(tab.terminalId),
  );
  return nextTabs.length === tabs.length ? tabs : nextTabs;
}

export function pruneTerminalTabsInFixedPanelState({
  pendingTerminalIds,
  state,
  terminalSessions,
}: SyncTerminalTabsInFixedPanelStateArgs): FixedPanelTabsState {
  const tabs = pruneTerminalTabsForSessions({
    pendingTerminalIds,
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
  pendingTerminalIds,
  tabs,
  terminalSessions,
}: SyncTerminalTabsWithSessionsArgs<T>): {
  tabs: Array<T | TerminalFixedPanelTab>;
  changed: boolean;
} {
  const terminalSessionIds = getTerminalSessionTabIds({
    pendingTerminalIds,
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
    if (!terminalSessionIds.has(session.id)) {
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
  pendingTerminalIds,
  terminalSessions,
}: BuildTerminalSyncedSecondaryFileTabsArgs): readonly SecondaryFileFixedPanelTab[] {
  return syncTerminalTabsWithSessions({
    pendingTerminalIds,
    tabs: orderedTabs,
    terminalSessions,
  }).tabs;
}

export function syncTerminalTabsInFixedPanelState({
  pendingTerminalIds,
  state,
  terminalSessions,
}: SyncTerminalTabsInFixedPanelStateArgs): FixedPanelTabsState {
  state = pruneTerminalTabsInFixedPanelState({
    pendingTerminalIds,
    state,
    terminalSessions,
  });
  const { tabs, changed } = syncTerminalTabsWithSessions({
    pendingTerminalIds,
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
