import type { TerminalSession } from "@bb/server-contract";
import {
  areTerminalFixedPanelTabTargetsEqual,
  createTerminalFixedPanelTab,
  type FixedPanelTabsState,
  type FixedPanelTab,
  type SecondaryFileFixedPanelTab,
  type SecondaryFixedPanelTab,
  type TerminalFixedPanelTab,
  type TerminalFixedPanelTabTarget,
} from "@/lib/fixed-panel-tabs-state";
import { shouldShowRetainedTerminalSession } from "@/lib/terminal-session-visibility";

interface BuildTerminalSyncedSecondaryFileTabsArgs {
  orderedTabs: readonly SecondaryFileFixedPanelTab[];
  retainedTerminalId: string | null;
  terminalSessions: readonly TerminalSession[];
  terminalTarget?: TerminalFixedPanelTabTarget | null;
}

interface FindActiveTerminalIdInSecondaryFileTabsArgs {
  activeTabId: string | null;
  tabs: readonly SecondaryFileFixedPanelTab[];
}

interface SyncTerminalTabsInFixedPanelStateArgs {
  retainedTerminalId: string | null;
  state: FixedPanelTabsState;
  terminalSessions: readonly TerminalSession[];
  terminalTarget?: TerminalFixedPanelTabTarget | null;
}

interface GetRetainedTerminalTabIdArgs {
  activeTab: SecondaryFixedPanelTab | null;
  isPanelOpen: boolean;
}

interface PruneTerminalTabsForSessionsArgs {
  retainedTerminalId: string | null;
  tabs: readonly FixedPanelTab[];
  terminalSessions: readonly TerminalSession[];
  terminalTarget?: TerminalFixedPanelTabTarget | null;
}

function targetForTerminalSession(
  session: TerminalSession,
): TerminalFixedPanelTabTarget {
  if (session.threadId !== null) {
    return {
      kind: "thread",
      threadId: session.threadId,
    };
  }
  if (session.environmentId !== null) {
    return {
      kind: "environment",
      environmentId: session.environmentId,
    };
  }
  return {
    kind: "host_path",
    cwd: session.initialCwd,
    hostId: session.hostId,
  };
}

function terminalTabBelongsToLoadedTarget({
  tab,
  terminalTarget,
}: {
  tab: TerminalFixedPanelTab;
  terminalTarget: TerminalFixedPanelTabTarget | null | undefined;
}): boolean {
  return (
    tab.target === null ||
    terminalTarget === null ||
    terminalTarget === undefined ||
    areTerminalFixedPanelTabTargetsEqual(tab.target, terminalTarget)
  );
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
  terminalTarget,
}: PruneTerminalTabsForSessionsArgs): readonly FixedPanelTab[] {
  const terminalSessionIds = getTerminalSessionTabIds({
    retainedTerminalId,
    terminalSessions,
  });
  const nextTabs = tabs.filter(
    (tab) =>
      tab.kind !== "terminal" ||
      !terminalTabBelongsToLoadedTarget({ tab, terminalTarget }) ||
      terminalSessionIds.has(tab.terminalId),
  );
  return nextTabs.length === tabs.length ? tabs : nextTabs;
}

export function buildTerminalSyncedSecondaryFileTabs({
  orderedTabs,
  retainedTerminalId,
  terminalSessions,
  terminalTarget,
}: BuildTerminalSyncedSecondaryFileTabsArgs): readonly SecondaryFileFixedPanelTab[] {
  const terminalSessionIds = getTerminalSessionTabIds({
    retainedTerminalId,
    terminalSessions,
  });
  const terminalSessionsById = new Map(
    terminalSessions.map((session) => [session.id, session]),
  );
  const seenTerminalIds = new Set<string>();
  const syncedTabs: SecondaryFileFixedPanelTab[] = [];

  for (const tab of orderedTabs) {
    if (tab.kind !== "terminal") {
      syncedTabs.push(tab);
      continue;
    }
    if (!terminalTabBelongsToLoadedTarget({ tab, terminalTarget })) {
      seenTerminalIds.add(tab.terminalId);
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
    const session = terminalSessionsById.get(tab.terminalId);
    const sessionTarget = session ? targetForTerminalSession(session) : null;
    syncedTabs.push(
      sessionTarget !== null &&
        !areTerminalFixedPanelTabTargetsEqual(tab.target, sessionTarget)
        ? { ...tab, target: sessionTarget }
        : tab,
    );
  }

  for (const session of terminalSessions) {
    if (!shouldShowRetainedTerminalSession({ retainedTerminalId, session })) {
      continue;
    }
    if (seenTerminalIds.has(session.id)) {
      continue;
    }
    seenTerminalIds.add(session.id);
    syncedTabs.push(
      createTerminalFixedPanelTab({
        terminalId: session.id,
        target: targetForTerminalSession(session),
      }),
    );
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
  terminalTarget,
}: SyncTerminalTabsInFixedPanelStateArgs): FixedPanelTabsState {
  const terminalSessionIds = getTerminalSessionTabIds({
    retainedTerminalId,
    terminalSessions,
  });
  const terminalSessionsById = new Map(
    terminalSessions.map((session) => [session.id, session]),
  );
  const seenTerminalIds = new Set<string>();
  const tabs: SecondaryFixedPanelTab[] = [];
  let changed = false;

  for (const tab of state.secondary.tabs) {
    if (tab.kind === "terminal") {
      if (!terminalTabBelongsToLoadedTarget({ tab, terminalTarget })) {
        if (!seenTerminalIds.has(tab.terminalId)) {
          seenTerminalIds.add(tab.terminalId);
          tabs.push(tab);
        } else {
          changed = true;
        }
        continue;
      }
      if (
        !terminalSessionIds.has(tab.terminalId) ||
        seenTerminalIds.has(tab.terminalId)
      ) {
        changed = true;
        continue;
      }
      seenTerminalIds.add(tab.terminalId);
      const session = terminalSessionsById.get(tab.terminalId);
      if (session) {
        const sessionTarget = targetForTerminalSession(session);
        if (!areTerminalFixedPanelTabTargetsEqual(tab.target, sessionTarget)) {
          tabs.push({ ...tab, target: sessionTarget });
          changed = true;
          continue;
        }
      }
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
    tabs.push(
      createTerminalFixedPanelTab({
        terminalId: session.id,
        target: targetForTerminalSession(session),
      }),
    );
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
