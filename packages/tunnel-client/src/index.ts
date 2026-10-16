export { headersForLoopbackRequest } from "./headers.js";
export { humanizeTransportError } from "./humanize.js";
export { ReconnectBackoff, type ReconnectBackoffOptions } from "./reconnect.js";
export {
  isBareBbRealtimeWs,
  TunnelSession,
  type StreamOriginResult,
  type TunnelSessionSnapshot,
} from "./session.js";

export type {
  BuiltinConnectRequestContext,
  ReaderContextConnection,
} from "@bb/tunnel-contract";
