export const TUNNEL_TARGET_HEADER = "x-bb-tunnel-target";
export const MACHINE_CREDENTIAL_HEADER = "x-bb-connect-machine";
export const GATE_AUTH_HEADER = "x-bb-gate-auth";
export const GATE_MACHINE_ID_HEADER = "x-bb-gate-machine-id";
export const GATE_OWNER_HEADER = "x-bb-gate-owner";
export const RELAY_HEADER = "x-bb-relay";
export const RELAY_METHOD_HEADER = "x-bb-relay-method";
export const RELAY_HAS_BODY_HEADER = "x-bb-relay-has-body";
export const RELAY_CONTENT_LENGTH_HEADER = "x-bb-relay-content-length";

export const HOP_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "expect",
  "host",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  TUNNEL_TARGET_HEADER,
  GATE_OWNER_HEADER,
  RELAY_HEADER,
  RELAY_METHOD_HEADER,
  RELAY_HAS_BODY_HEADER,
  RELAY_CONTENT_LENGTH_HEADER,
]);
