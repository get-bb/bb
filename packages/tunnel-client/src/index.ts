export { headersForLoopbackRequest } from "./headers.js";
export { humanizeTransportError } from "./humanize.js";
export { ReconnectBackoff, type ReconnectBackoffOptions } from "./reconnect.js";
export {
  canonicalStreamPath,
  type CanonicalStreamPath,
  isBareBbRealtimeWs,
  TunnelSession,
  type StreamGuardInput,
  type StreamGuardResult,
  type StreamOriginResult,
  type TunnelSessionSnapshot,
  type TunnelTransport,
} from "./session.js";
export {
  CONNECT_TUNNEL_HEADER,
  GATE_AUTH_HEADER,
  SEALED_DEVICE_HEADER,
  SEALED_HTTP_PREFIX,
  SEALED_REQUIRED_ERROR_CODE,
  SEALED_REQUIRED_MESSAGE,
  SEALED_ROUTE,
  SEALED_ROUTE_PATH,
  plaintextStreamVerdict,
} from "./sealed-policy.js";
