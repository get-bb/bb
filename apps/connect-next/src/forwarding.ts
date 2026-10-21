import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import {
  GATE_OAUTH_CLIENT_HEADER,
  GATE_OAUTH_GRANT_HEADER,
  GATE_OAUTH_SCOPE_HEADER,
} from "@bb/connect-db";
import { GATE_ASSERTION_HEADER } from "@bb/tunnel-contract/next";
import {
  pairsFromRaw,
  setHeader,
  withoutHeaders,
  type HeaderPairs,
} from "./headers.js";
import type { Forward } from "./visitor.js";

export const GATE_AUTH_HEADER = "x-bb-gate-auth";
export const GATE_MACHINE_ID_HEADER = "x-bb-gate-machine-id";

const REQUEST_HOP_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "expect",
  "host",
  "accept-encoding",
  "fly-replay-src",
]);
const RESPONSE_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "trailer",
  "upgrade",
];
const PRIVATE_HEADER_PREFIXES = [
  "x-bb-gate-",
  "x-bb-tunnel-",
  "x-bb-relay",
  "x-bb-connect-",
  "x-bb-cloud-dev-",
  "x-bb-via-tunnel",
];
const COOKIE_DOMAIN = /;\s*domain\s*(?:=|;|$)/iu;
const COMBINED_COOKIES = /,(?=\s*[^;,=\s]+\s*=)/u;

export function isPlatformCookie(name: string): boolean {
  return (
    name.startsWith("__Secure-better-auth.") ||
    name.startsWith("better-auth.") ||
    name.startsWith("__Secure-bb-connect.") ||
    name.startsWith("bb-connect.")
  );
}

export function isPrivateHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === GATE_ASSERTION_HEADER ||
    PRIVATE_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

export function tenantCookies(header: string): string | null {
  const kept = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const separator = part.indexOf("=");
      return (
        separator > 0 && !isPlatformCookie(part.slice(0, separator).trim())
      );
    });
  return kept.length === 0 ? null : kept.join("; ");
}

export function isTenantSetCookie(cookie: string): boolean {
  const separator = cookie.indexOf("=");
  return (
    separator > 0 &&
    !isPlatformCookie(cookie.slice(0, separator).trim()) &&
    !COOKIE_DOMAIN.test(cookie) &&
    !COMBINED_COOKIES.test(cookie)
  );
}

export interface UpstreamHeaderInput {
  headers: IncomingHttpHeaders;
  forward: Forward;
  upstreamHost: string;
  visitorHost: string;
  scheme: string;
  assertion: string;
  acceptEncoding: string | null;
  websocket: boolean;
}

export function shareLoopbackOrigin(target: string): string {
  return `http://127.0.0.1:${target}`;
}

export function upstreamHeaders(
  input: UpstreamHeaderInput,
): OutgoingHttpHeaders {
  const { forward } = input;
  const connectionTokens = new Set(
    String(input.headers.connection ?? "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token !== ""),
  );
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(input.headers)) {
    if (value === undefined) continue;
    if (REQUEST_HOP_HEADERS.has(name) || connectionTokens.has(name)) continue;
    if (isPrivateHeader(name)) continue;
    headers[name] = value;
  }
  const cookie = input.headers.cookie;
  delete headers.cookie;
  if (cookie !== undefined) {
    const kept = tenantCookies(cookie);
    if (kept !== null) headers.cookie = kept;
  }
  if (forward.auth === "oauth") {
    delete headers.authorization;
    delete headers.cookie;
  }
  if (
    forward.target !== null &&
    headers.origin === `${input.scheme}://${input.visitorHost}`
  ) {
    headers.origin = shareLoopbackOrigin(forward.target);
  }
  headers.host = input.upstreamHost;
  headers["x-forwarded-host"] = input.visitorHost;
  headers["x-forwarded-proto"] = input.scheme;
  if (input.acceptEncoding !== null) {
    headers["accept-encoding"] = input.acceptEncoding;
  }
  if (input.websocket) {
    headers.connection = "Upgrade";
    headers.upgrade = "websocket";
  }
  if (forward.auth !== "public") headers[GATE_AUTH_HEADER] = forward.auth;
  if (forward.machineId !== null) {
    headers[GATE_MACHINE_ID_HEADER] = forward.machineId;
  }
  if (forward.oauth !== null) {
    headers[GATE_OAUTH_SCOPE_HEADER] = forward.oauth.scope;
    headers[GATE_OAUTH_GRANT_HEADER] = forward.oauth.grantId;
    headers[GATE_OAUTH_CLIENT_HEADER] = forward.oauth.clientName;
  }
  headers[GATE_ASSERTION_HEADER] = input.assertion;
  return headers;
}

export function visitorHeaders(
  rawHeaders: readonly string[],
  installPath: string | null,
): HeaderPairs {
  let pairs = withoutHeaders(pairsFromRaw(rawHeaders), ...RESPONSE_HOP_HEADERS);
  pairs = pairs.filter(
    ([name, value]) =>
      name.toLowerCase() !== "set-cookie" || isTenantSetCookie(value),
  );
  if (installPath === null) return pairs;
  pairs = setHeader(pairs, "x-content-type-options", "nosniff");
  pairs = setHeader(pairs, "content-security-policy", "sandbox");
  if (installPath === "/install/bb-app.tgz") {
    pairs = setHeader(pairs, "content-type", "application/octet-stream");
    return setHeader(
      pairs,
      "content-disposition",
      'attachment; filename="bb-app.tgz"',
    );
  }
  pairs = setHeader(pairs, "content-type", "text/plain; charset=utf-8");
  return withoutHeaders(pairs, "content-disposition");
}
