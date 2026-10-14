import type { StreamGuardInput, StreamGuardResult } from "./session.js";

export const SEALED_DEVICE_HEADER = "x-bb-sealed-device";
export const CONNECT_TUNNEL_HEADER = "x-bb-connect-tunnel";
export const GATE_AUTH_HEADER = "x-bb-gate-auth";
export const SEALED_REQUIRED_ERROR_CODE = "sealed_required";
export const SEALED_REQUIRED_MESSAGE =
  "this bb requires end-to-end encryption for remote access; open it with a bb client that supports sealed connections";

export const SEALED_HTTP_PREFIX = "/api/v1/plugins/connect/http";
export const SEALED_ROUTE_PATH = "/sealed";
export const SEALED_ROUTE = `${SEALED_HTTP_PREFIX}${SEALED_ROUTE_PATH}`;
const PLAINTEXT_ALLOWED_EXACT = new Set(["/health", "/install.sh"]);

function withinTree(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}
const PLUGIN_UI_ASSET_PATTERN =
  /^\/api\/v1\/(?:plugins\/[^/]+\/assets\/|plugin-app-assets\/)/u;
const DATA_PATH_PATTERN = /^\/(?:api\/|ws(?:\/|\?|$)|internal\/)/u;

const SEALED_INFO_ROUTE = `${SEALED_ROUTE}/info`;
const DAEMON_OPEN_PATHS = new Set(["/internal/ws", "/internal/hosts/enroll"]);
const INTERNAL_DENIED_PATHS = ["/internal/hosts/enroll-key"];
const INTERNAL_DENIED_TREES = ["/internal/server-move"];

function internalVerdict(
  path: string,
  headers: StreamGuardInput["headers"],
): boolean {
  if (DAEMON_OPEN_PATHS.has(path)) return true;
  if (INTERNAL_DENIED_PATHS.includes(path)) return false;
  if (INTERNAL_DENIED_TREES.some((tree) => withinTree(path, tree))) {
    return false;
  }
  return hasHeader(headers, "authorization");
}

function hasHeader(
  headers: StreamGuardInput["headers"],
  name: string,
): boolean {
  return headers.some(([header]) => header.toLowerCase() === name);
}

export function plaintextStreamVerdict(
  stream: StreamGuardInput,
  required: boolean,
): StreamGuardResult {
  if (!required || stream.target !== undefined) return { allow: true };
  const path = stream.path.split("?", 1)[0] ?? stream.path;
  const method = stream.method.toUpperCase();
  const readOnly = method === "GET" || method === "HEAD";
  if (path === SEALED_ROUTE && method === "GET") return { allow: true };
  if (path === SEALED_INFO_ROUTE && readOnly && stream.kind === "http") {
    return { allow: true };
  }
  if (withinTree(path, "/internal")) {
    if (internalVerdict(path, stream.headers)) return { allow: true };
  } else if (PLAINTEXT_ALLOWED_EXACT.has(path) && readOnly) {
    return { allow: true };
  } else if (withinTree(path, "/install") && readOnly) {
    return { allow: true };
  } else if (
    stream.kind === "http" &&
    readOnly &&
    PLUGIN_UI_ASSET_PATTERN.test(path)
  ) {
    return { allow: true };
  } else if (
    stream.kind === "http" &&
    readOnly &&
    !DATA_PATH_PATTERN.test(path) &&
    !withinTree(path, SEALED_ROUTE)
  ) {
    return { allow: true };
  }
  return {
    allow: false,
    status: 403,
    code: SEALED_REQUIRED_ERROR_CODE,
    message: SEALED_REQUIRED_MESSAGE,
  };
}
