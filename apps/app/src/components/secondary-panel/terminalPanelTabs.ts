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
import { shouldShowRetainedTerminalSession } from "@/lib/terminal-session-visibility";

interface BuildTerminalSyncedSecondaryFileTabsArgs {
  orderedTabs: readonly SecondaryFileFixedPanelTab[];
  retainedTerminalId: string | null;
  terminalSessions: readonly TerminalSession[];
}

interface SyncTerminalTabsInFixedPanelStateArgs {
  retainedTerminalId: string | null;
  state: FixedPanelTabsState;
  terminalSessions: readonly TerminalSession[];
}

interface GetRetainedTerminalTabIdArgs {
  activeTab: SecondaryFixedPanelTab | null;
  isPanelOpen: boolean;
}

interface SyncTerminalTabsWithSessionsArgs<T extends SecondaryFixedPanelTab> {
  retainedTerminalId: string | null;
  tabs: readonly T[];
  terminalSessions: readonly TerminalSession[];
}

interface PruneTerminalTabsForSessionsArgs {
  retainedTerminalId: string | null;
  tabs: readonly FixedPanelTab[];
  terminalSessions: readonly TerminalSession[];
}

function getTerminalSessionTabIds({
  retainedTerminalId,
  terminalSessions,
}: {
  retainedTerminalId: string | null;
  terminalSessions: readonly TerminalSession[];
}): ReadonlySet<string> {
  return new Set(
    terminalSessions
      .filter((session) =>
        shouldShowRetainedTerminalSession({ retainedTerminalId, session }),
      )
      .map((session) => session.id),
  );
}

export function getRetainedTerminalTabId({
  activeTab,
  isPanelOpen,
}: GetRetainedTerminalTabIdArgs): string | null {
  return isPanelOpen && activeTab?.kind === "terminal"
    ? activeTab.terminalId
    : null;
}

export function pruneTerminalTabsForSessions({
  retainedTerminalId,
  tabs,
  terminalSessions,
}: PruneTerminalTabsForSessionsArgs): readonly FixedPanelTab[] {
  const terminalSessionIds = getTerminalSessionTabIds({
    retainedTerminalId,
    terminalSessions,
  });
  const nextTabs = tabs.filter(
    (tab) => tab.kind !== "terminal" || terminalSessionIds.has(tab.terminalId),
  );
  return nextTabs.length === tabs.length ? tabs : nextTabs;
}

export function pruneTerminalTabsInFixedPanelState({
  state,
  retainedTerminalId,
  terminalSessions,
}: SyncTerminalTabsInFixedPanelStateArgs): FixedPanelTabsState {
  const tabs = pruneTerminalTabsForSessions({
    tabs: state.secondary.tabs,
    retainedTerminalId,
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
  retainedTerminalId,
  tabs,
  terminalSessions,
}: SyncTerminalTabsWithSessionsArgs<T>): {
  tabs: Array<T | TerminalFixedPanelTab>;
  changed: boolean;
} {
  const terminalSessionIds = getTerminalSessionTabIds({
    retainedTerminalId,
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
    if (!shouldShowRetainedTerminalSession({ retainedTerminalId, session })) {
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
  retainedTerminalId,
  terminalSessions,
}: BuildTerminalSyncedSecondaryFileTabsArgs): readonly SecondaryFileFixedPanelTab[] {
  return syncTerminalTabsWithSessions({
    retainedTerminalId,
    tabs: orderedTabs,
    terminalSessions,
  }).tabs;
}

export function syncTerminalTabsInFixedPanelState({
  retainedTerminalId,
  state,
  terminalSessions,
}: SyncTerminalTabsInFixedPanelStateArgs): FixedPanelTabsState {
  state = pruneTerminalTabsInFixedPanelState({
    state,
    retainedTerminalId,
    terminalSessions,
  });
  const { tabs, changed } = syncTerminalTabsWithSessions({
    retainedTerminalId,
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
