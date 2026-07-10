export interface CreateActiveServerStateArgs {
  defaultServerId: string;
}

export interface ActiveServerState {
  clearWindow(windowId: number): void;
  getActiveServerId(windowId: number): string;
  getMostRecentServerId(): string;
  setActiveServerId(windowId: number, serverId: string): void;
}

/**
 * Per-window active server bookkeeping. New windows inherit the most recently
 * activated server id (not merely the focused window's id).
 */
export function createActiveServerState(
  args: CreateActiveServerStateArgs,
): ActiveServerState {
  const windowServerIds = new Map<number, string>();
  let mostRecentServerId = args.defaultServerId;

  return {
    clearWindow(windowId) {
      windowServerIds.delete(windowId);
    },
    getActiveServerId(windowId) {
      return windowServerIds.get(windowId) ?? mostRecentServerId;
    },
    getMostRecentServerId() {
      return mostRecentServerId;
    },
    setActiveServerId(windowId, serverId) {
      windowServerIds.set(windowId, serverId);
      mostRecentServerId = serverId;
    },
  };
}
