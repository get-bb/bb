import type { TerminalSession } from "@bb/server-contract";
import {
  createTerminalFixedPanelTab,
  type FixedPanelTabsState,
  type SecondaryFileFixedPanelTab,
  type SecondaryFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";

interface BuildTerminalSyncedSecondaryFileTabsArgs {
  orderedTabs: readonly SecondaryFileFixedPanelTab[];
  terminalSessions: readonly TerminalSession[];
}

interface FindActiveTerminalIdInSecondaryFileTabsArgs {
  activeTabId: string | null;
  tabs: readonly SecondaryFileFixedPanelTab[];
}

interface SyncTerminalTabsInFixedPanelStateArgs {
  state: FixedPanelTabsState;
  terminalSessions: readonly TerminalSession[];
}

export function buildTerminalSyncedSecondaryFileTabs({
  orderedTabs,
  terminalSessions,
}: BuildTerminalSyncedSecondaryFileTabsArgs): readonly SecondaryFileFixedPanelTab[] {
  const terminalSessionIds = new Set(
    terminalSessions.map((session) => session.id),
  );
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
  state,
  terminalSessions,
}: SyncTerminalTabsInFixedPanelStateArgs): FixedPanelTabsState {
  const terminalSessionIds = new Set(
    terminalSessions.map((session) => session.id),
  );
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
