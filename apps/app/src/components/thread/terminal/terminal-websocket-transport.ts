// Moved to @bb/client-core (shared with the native app); re-exported here so web imports keep resolving.
export { TerminalWebSocketTransport } from "@bb/client-core";
export type {
  TerminalSocketConnectionState,
  TerminalBrowserSocket,
  CreateTerminalBrowserSocket,
  TerminalWebSocketTransportOptions,
} from "@bb/client-core";
