import {
  areFixedPanelTabsEquivalent,
  type FixedPanelTab,
  type FixedPanelTabsState,
} from "@bb/client-core";
import type { ThreadTab, ThreadTabsResponse } from "@bb/server-contract";

/**
 * Pure half of the thread-tabs sync (port of apps/app/src/lib/thread-tabs-sync.ts
 * with the mobile-specific tab set): which tabs travel through
 * `GET/PUT /threads/:id/tabs`, how the server list merges into the local
 * panel state, and a per-thread write queue that persists the local strip
 * against the server's revision and resolves 409 conflicts.
 *
 * The server contract is broader than the mobile panel model: `side-chat`
 * tabs are legacy rows the web drops too, `plugin-page-fixed` views are
 * local to a nav page, and `new-tab` is the web's transient launcher (mobile
 * renders its own fixed Files / Terminal entries instead). None of those
 * cross the wire from this client.
 */

export type SyncedThreadTab = Exclude<
  FixedPanelTab,
  { kind: "plugin-page-fixed" | "new-tab" }
>;

export function toSyncedThreadTabs(
  tabs: readonly (FixedPanelTab | ThreadTab)[],
): readonly SyncedThreadTab[] {
  return tabs.filter(
    (tab): tab is SyncedThreadTab =>
      tab.kind !== "side-chat" &&
      tab.kind !== "plugin-page-fixed" &&
      tab.kind !== "new-tab",
  );
}

export function areThreadTabListsEquivalent(
  left: readonly (FixedPanelTab | ThreadTab)[],
  right: readonly (FixedPanelTab | ThreadTab)[],
): boolean {
  const leftTabs = toSyncedThreadTabs(left);
  const rightTabs = toSyncedThreadTabs(right);
  return (
    leftTabs.length === rightTabs.length &&
    leftTabs.every((tab, index) => {
      const other = rightTabs[index];
      return other !== undefined && areFixedPanelTabsEquivalent(tab, other);
    })
  );
}

/**
 * Server tabs win: the local strip becomes the server's list and the local
 * active tab survives only when it is still in it (device-local selection
 * never travels). Returns the same state when nothing changed so callers can
 * skip the storage write.
 */
export function reconcileTabsStateWithServerTabs(
  current: FixedPanelTabsState,
  serverTabs: readonly ThreadTab[],
): FixedPanelTabsState {
  if (areThreadTabListsEquivalent(current.secondary.tabs, serverTabs)) {
    return current;
  }
  const tabs = toSyncedThreadTabs(serverTabs);
  const activeTabId = tabs.some(
    (tab) => tab.id === current.secondary.activeTabId,
  )
    ? current.secondary.activeTabId
    : null;
  return {
    ...current,
    secondary: {
      ...current.secondary,
      activeTabId,
      tabs,
    },
  };
}

// ---------------------------------------------------------------------------
// Write queue

export interface ThreadTabsWriteArgs {
  expectedRevision: number;
  tabs: readonly SyncedThreadTab[];
  threadId: string;
}

export interface ThreadTabsSyncTransport {
  /** The last server answer this client holds (query cache), if any. */
  getCached(threadId: string): ThreadTabsResponse | undefined;
  /** `GET /threads/:id/tabs`; the implementation also refreshes its cache. */
  fetch(threadId: string): Promise<ThreadTabsResponse>;
  /** `PUT /threads/:id/tabs`; resolves with the new revision, rejects on 409. */
  write(args: ThreadTabsWriteArgs): Promise<ThreadTabsResponse>;
  /** The rejection `write` produces for a revision mismatch (409). */
  isConflict(error: unknown): boolean;
}

export type ThreadTabsSyncOutcome =
  | { kind: "unchanged" }
  | { kind: "written"; response: ThreadTabsResponse }
  /** Two writes lost the race in a row: the server's strip stands. */
  | { kind: "conflict"; server: ThreadTabsResponse };

export interface ThreadTabsSyncerOptions {
  transport: ThreadTabsSyncTransport;
  /**
   * A write settled, one way or another. The hook uses it to adopt the
   * server's list into the local state after a lost conflict.
   */
  onOutcome?: (threadId: string, outcome: ThreadTabsSyncOutcome) => void;
}

export interface ThreadTabsSyncer {
  /**
   * Persist `tabs` as the thread's strip. Writes for one thread run one at a
   * time, each against the freshest revision this client knows; the returned
   * promise settles with the outcome and rejects only on a non-conflict
   * failure (network, 5xx).
   */
  persist(
    threadId: string,
    tabs: readonly FixedPanelTab[],
  ): Promise<ThreadTabsSyncOutcome>;
  /**
   * First sight of a thread whose server strip is still empty (revision 0)
   * while this device already holds tabs for it: seed the server from the
   * local list, once per thread per process. Resolves `false` when the
   * migration was already attempted or the server moved on.
   */
  migrate(threadId: string, tabs: readonly FixedPanelTab[]): Promise<boolean>;
  /** A write (or migration) is queued or in flight for the thread. */
  hasPendingWrite(threadId: string): boolean;
}

export function createThreadTabsSyncer({
  transport,
  onOutcome,
}: ThreadTabsSyncerOptions): ThreadTabsSyncer {
  const queues = new Map<string, Promise<unknown>>();
  const pendingCounts = new Map<string, number>();
  const attemptedMigrations = new Set<string>();

  function adjustPending(threadId: string, delta: 1 | -1): void {
    const next = (pendingCounts.get(threadId) ?? 0) + delta;
    if (next <= 0) pendingCounts.delete(threadId);
    else pendingCounts.set(threadId, next);
  }

  function enqueue<T>(
    threadId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = queues.get(threadId) ?? Promise.resolve();
    adjustPending(threadId, 1);
    const run = previous.catch(() => undefined).then(operation);
    queues.set(threadId, run);
    void run
      .catch(() => undefined)
      .finally(() => {
        adjustPending(threadId, -1);
        if (queues.get(threadId) === run) queues.delete(threadId);
      });
    return run;
  }

  async function readCurrent(threadId: string): Promise<ThreadTabsResponse> {
    return transport.getCached(threadId) ?? (await transport.fetch(threadId));
  }

  async function persistNow(
    threadId: string,
    tabs: readonly FixedPanelTab[],
  ): Promise<ThreadTabsSyncOutcome> {
    const desired = toSyncedThreadTabs(tabs);
    let current = await readCurrent(threadId);
    if (areThreadTabListsEquivalent(current.tabs, desired)) {
      return { kind: "unchanged" };
    }
    try {
      const response = await transport.write({
        expectedRevision: current.revision,
        tabs: desired,
        threadId,
      });
      return { kind: "written", response };
    } catch (error) {
      if (!transport.isConflict(error)) throw error;
    }
    // Another client wrote in between: rebase on its revision and try once
    // more. A second conflict means the strip is contended; the server wins.
    current = await transport.fetch(threadId);
    if (areThreadTabListsEquivalent(current.tabs, desired)) {
      return { kind: "written", response: current };
    }
    try {
      const response = await transport.write({
        expectedRevision: current.revision,
        tabs: desired,
        threadId,
      });
      return { kind: "written", response };
    } catch (error) {
      if (!transport.isConflict(error)) throw error;
      const server = await transport.fetch(threadId);
      return { kind: "conflict", server };
    }
  }

  function report(threadId: string, outcome: ThreadTabsSyncOutcome): void {
    onOutcome?.(threadId, outcome);
  }

  return {
    persist(threadId, tabs) {
      return enqueue(threadId, async () => {
        const outcome = await persistNow(threadId, tabs);
        report(threadId, outcome);
        return outcome;
      });
    },
    migrate(threadId, tabs) {
      if (attemptedMigrations.has(threadId)) return Promise.resolve(false);
      attemptedMigrations.add(threadId);
      return enqueue(threadId, async () => {
        const current = await readCurrent(threadId);
        if (current.revision !== 0) return false;
        const desired = toSyncedThreadTabs(tabs);
        if (desired.length === 0) return false;
        try {
          const response = await transport.write({
            expectedRevision: 0,
            tabs: desired,
            threadId,
          });
          report(threadId, { kind: "written", response });
          return true;
        } catch (error) {
          if (!transport.isConflict(error)) throw error;
          // Someone else seeded the strip first; their list stands.
          report(threadId, {
            kind: "conflict",
            server: await transport.fetch(threadId),
          });
          return false;
        }
      });
    },
    hasPendingWrite(threadId) {
      return (pendingCounts.get(threadId) ?? 0) > 0;
    },
  };
}
