export type ServerPanel = "none" | "setup" | "repair";

/** A completed pairing always wins over stale local setup-panel state. */
export function visibleServerPanel(
  connected: boolean,
  requestedPanel: ServerPanel,
): ServerPanel {
  return connected && requestedPanel === "setup" ? "none" : requestedPanel;
}

/** Poll quickly during pairing, but never stop observing a paired server. */
export function dashboardRefreshIntervalMs(
  servers: ReadonlyArray<{ connected: boolean; lastSeenAt: number | null }>,
  pendingServerId: string | null,
): number {
  const pairing =
    pendingServerId !== null ||
    servers.some((server) => !server.connected || server.lastSeenAt === null);
  return pairing ? 3_000 : 10_000;
}
