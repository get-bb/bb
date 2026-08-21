export interface BuildTerminalWebSocketPathArgs {
  terminalId: string;
}

/** Server path of the terminal attach socket, relative to the app origin. */
export function buildTerminalWebSocketPath({
  terminalId,
}: BuildTerminalWebSocketPathArgs): string {
  return `/ws/terminals/${encodeURIComponent(terminalId)}`;
}
