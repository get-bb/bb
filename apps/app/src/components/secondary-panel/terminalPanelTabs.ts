import type { TerminalSession } from "@bb/server-contract";
import {
  createTerminalFixedPanelTab,
  type FixedPanelTabsState,
  type FixedPanelTab,
  type SecondaryFileFixedPanelTab,
  type SecondaryFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { shouldShowRetainedTerminalSession } from "@/lib/terminal-session-visibility";

interface BuildTerminalSyncedSecondaryFileTabsArgs {
  orderedTabs: readonly SecondaryFileFixedPanelTab[];
  retainedTerminalId: string | null;
  terminalSessions: readonly TerminalSession[];
}

interface FindActiveTerminalIdInSecondaryFileTabsArgs {
  activeTabId: string | null;
  tabs: readonly SecondaryFileFixedPanelTab[];
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

export function buildTerminalSyncedSecondaryFileTabs({
  orderedTabs,
  retainedTerminalId,
  terminalSessions,
}: BuildTerminalSyncedSecondaryFileTabsArgs): readonly SecondaryFileFixedPanelTab[] {
  const terminalSessionIds = getTerminalSessionTabIds({
    retainedTerminalId,
    terminalSessions,
  });
  const seenTerminalIds = new Set<string>();
  const syncedTabs: SecondaryFileFixedPanelTab[] = [];

  for (const tab of orderedTabs) {
    if (tab.kind !== "terminal") {
      syncedTabs.push(tab);
      continue;
    }
    if (
      !terminalSessionIds.has(tab.terminalId) ||
      seenTerminalIds.has(tab.terminalId)
    ) {
      continue;
    }
    seenTerminalIds.add(tab.terminalId);
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
  }

  return syncedTabs;
}

export function findActiveTerminalIdInSecondaryFileTabs({
  activeTabId,
  tabs,
}: FindActiveTerminalIdInSecondaryFileTabsArgs): string | null {
  if (activeTabId === null) {
    return null;
  }

  for (const tab of tabs) {
    if (tab.id === activeTabId && tab.kind === "terminal") {
      return tab.terminalId;
    }
  }

  return null;
}

export function syncTerminalTabsInFixedPanelState({
  retainedTerminalId,
  state,
  terminalSessions,
}: SyncTerminalTabsInFixedPanelStateArgs): FixedPanelTabsState {
  const terminalSessionIds = getTerminalSessionTabIds({
    retainedTerminalId,
    terminalSessions,
  });
  const seenTerminalIds = new Set<string>();
  const tabs: SecondaryFixedPanelTab[] = [];
  let changed = false;

  for (const tab of state.secondary.tabs) {
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
    tabs.push(tab);
  }

  for (const session of terminalSessions) {
    if (!shouldShowRetainedTerminalSession({ retainedTerminalId, session })) {
      continue;
    }
    if (seenTerminalIds.has(session.id)) {
      continue;
    }
    seenTerminalIds.add(session.id);
    tabs.push(createTerminalFixedPanelTab({ terminalId: session.id }));
    changed = true;
  }

  const activeTabId =
    state.secondary.activeTabId !== null &&
    tabs.some((tab) => tab.id === state.secondary.activeTabId)
      ? state.secondary.activeTabId
      : null;
  if (activeTabId !== state.secondary.activeTabId) {
    changed = true;
  }

  if (!changed) {
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
