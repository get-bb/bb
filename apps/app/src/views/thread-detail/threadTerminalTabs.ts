import type { TerminalSession } from "@bb/server-contract";
import {
  createTerminalFixedPanelTab,
  type SecondaryFileFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";

interface BuildTerminalSyncedSecondaryFileTabsArgs {
  orderedTabs: readonly SecondaryFileFixedPanelTab[];
  terminalSessions: readonly TerminalSession[];
}

interface FindActiveTerminalIdInSecondaryFileTabsArgs {
  activeTabId: string | null;
  tabs: readonly SecondaryFileFixedPanelTab[];
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
