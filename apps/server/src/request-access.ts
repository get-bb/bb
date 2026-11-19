import { isLoopbackAddress, isLoopbackHostname } from "@bb/config/loopback";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type {
  AccessCredential,
  AccessService,
} from "./services/access/access-service.js";
import { ACCESS_TOKEN_PREFIX } from "./services/access/access-service.js";
import type { MachineAuthService } from "./services/machine-auth.js";

export const TUNNEL_MARKER_HEADER_NAME = "x-bb-tunnel-marker";
const GATE_HEADER_PREFIX = "x-bb-gate-";
const REQUEST_ACCESS_CONTEXT_KEY = "bbRequestAccess";
export const UNAUTHENTICATED_MESSAGE =
  "Sign in to this bb first: open it in a browser and enter a pairing code from `bb access pair` on the server machine or Settings → Devices on a signed-in device.";
export const CREDENTIAL_REQUIRES_HTTPS_MESSAGE =
  "This sign-in was made over HTTPS and is not accepted over plain HTTP. Use the HTTPS address, or sign in again on this address.";

export type RequestAccess =
  | { kind: "owner"; via: "local" | "connect" }
  | { kind: "owner"; via: "credential"; credential: AccessCredential }
  | { kind: "machine"; via: "connect" | "host-key" }
  | { kind: "oauth" }
  | {
      kind: "anonymous";
      via: "connect" | "direct";
      problem: "credential_requires_https" | null;
    };

declare module "hono" {
  interface ContextVariableMap {
    [REQUEST_ACCESS_CONTEXT_KEY]: RequestAccess;
  }
}

type RequestReader = Pick<Context, "req">;

export interface RequestAccessDeps {
  access: AccessService;
  config: { serverPort: number };
  machineAuth: Pick<MachineAuthService, "verifyDaemonHostKey">;
}

export interface RequestAccessReader {
  get(key: typeof REQUEST_ACCESS_CONTEXT_KEY): RequestAccess | undefined;
}

export function accessCookieName(serverPort: number): string {
  return `bb_session_${serverPort}`;
}

function stripIpv4MappedPrefix(address: string): string {
  return address.toLowerCase().startsWith("::ffff:") && address.includes(".")
    ? address.slice("::ffff:".length)
    : address;
}

export function isLoopbackPeer(remoteAddress: string | undefined): boolean {
  return (
    remoteAddress === undefined ||
    isLoopbackAddress(stripIpv4MappedPrefix(remoteAddress))
  );
}

function hostnameOf(hostHeader: string): string | null {
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

function headerList(value: string | undefined): string[] {
  return value === undefined
    ? []
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

function isLoopbackForwardedAddress(entry: string): boolean {
  const unbracketed = entry.replace(/^\[([^\]]+)\](?::\d+)?$/u, "$1");
  return isLoopbackAddress(stripIpv4MappedPrefix(unbracketed));
}

function hasNonLocalProxyHint(context: RequestReader): boolean {
  const headers = context.req.raw.headers;
  if (headers.has("forwarded") || headers.has("via")) return true;
  for (const name of headers.keys()) {
    if (name.toLowerCase().startsWith("tailscale-")) return true;
  }
  const forwardedFor = headerList(context.req.header("x-forwarded-for"));
  if (!forwardedFor.every(isLoopbackForwardedAddress)) return true;
  const realIp = context.req.header("x-real-ip");
  if (realIp !== undefined && !isLoopbackForwardedAddress(realIp.trim())) {
    return true;
  }
  const forwardedHosts = headerList(context.req.header("x-forwarded-host"));
  return !forwardedHosts.every((host) => {
    const hostname = hostnameOf(host);
    return hostname !== null && isLoopbackHostname(hostname);
  });
}

export function isLocalOwnerRequest(
  context: RequestReader,
  remoteAddress: string | undefined,
): boolean {
  if (!isLoopbackPeer(remoteAddress)) return false;
  const host = context.req.header("host") ?? new URL(context.req.url).host;
  const hostname = hostnameOf(host);
  if (hostname === null || !isLoopbackHostname(hostname)) return false;
  return !hasNonLocalProxyHint(context);
}

export function isHttpsRequest(
  context: RequestReader,
  remoteAddress: string | undefined,
): boolean {
  if (!isLoopbackPeer(remoteAddress)) return false;
  const proto = headerList(context.req.header("x-forwarded-proto"))[0];
  return proto?.toLowerCase() === "https";
}

export function requestOrigin(
  context: RequestReader,
  remoteAddress: string | undefined,
): string {
  const origin = context.req.header("origin");
  if (origin !== undefined && origin !== "null") return origin;
  const forwardedHost = isLoopbackPeer(remoteAddress)
    ? headerList(context.req.header("x-forwarded-host"))[0]
    : undefined;
  const host =
    forwardedHost ??
    context.req.header("host") ??
    new URL(context.req.url).host;
  return `${isHttpsRequest(context, remoteAddress) ? "https" : "http"}://${host}`;
}

function sanitizeGateHeaders(context: Context, keepGateHeaders: boolean): void {
  const headers = context.req.raw.headers;
  headers.delete(TUNNEL_MARKER_HEADER_NAME);
  if (keepGateHeaders) return;
  const gateHeaders = [...headers.keys()].filter((name) =>
    name.toLowerCase().startsWith(GATE_HEADER_PREFIX),
  );
  for (const name of gateHeaders) headers.delete(name);
}

function connectAccess(gateAuth: string | undefined): RequestAccess {
  switch (gateAuth) {
    case "session":
      return { kind: "owner", via: "connect" };
    case "machine":
      return { kind: "machine", via: "connect" };
    case "oauth":
      return { kind: "oauth" };
    default:
      return { kind: "anonymous", via: "connect", problem: null };
  }
}

function bearerToken(context: RequestReader): string | null {
  const authorization = context.req.header("authorization");
  if (authorization === undefined) return null;
  const match = /^Bearer\s+(\S+)\s*$/iu.exec(authorization);
  return match?.[1] ?? null;
}

function credentialAccess(
  credential: AccessCredential,
  https: boolean,
): RequestAccess {
  return credential.secureOnly && !https
    ? { kind: "anonymous", via: "direct", problem: "credential_requires_https" }
    : { kind: "owner", via: "credential", credential };
}

async function directAccess(
  context: Context,
  deps: RequestAccessDeps,
  remoteAddress: string | undefined,
): Promise<RequestAccess> {
  const https = isHttpsRequest(context, remoteAddress);
  const token = bearerToken(context);
  if (token !== null && !context.req.path.startsWith("/internal/")) {
    if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
      const credential = deps.access.credentialForToken(token);
      if (credential !== null) return credentialAccess(credential, https);
    } else if ((await deps.machineAuth.verifyDaemonHostKey(token)) !== null) {
      return { kind: "machine", via: "host-key" };
    }
  }
  const cookie = getCookie(context, accessCookieName(deps.config.serverPort));
  if (cookie !== undefined) {
    const credential = deps.access.credentialForToken(cookie);
    if (credential !== null) return credentialAccess(credential, https);
  }
  if (isLocalOwnerRequest(context, remoteAddress)) {
    return { kind: "owner", via: "local" };
  }
  return { kind: "anonymous", via: "direct", problem: null };
}

export async function resolveRequestAccess(
  context: Context,
  deps: RequestAccessDeps,
  remoteAddress: string | undefined,
): Promise<RequestAccess> {
  const marker = context.req.header(TUNNEL_MARKER_HEADER_NAME);
  const viaTunnel =
    marker !== undefined && deps.access.isTunnelMarker(marker.trim());
  sanitizeGateHeaders(context, viaTunnel);
  const access = viaTunnel
    ? connectAccess(context.req.header(`${GATE_HEADER_PREFIX}auth`))
    : await directAccess(context, deps, remoteAddress);
  context.set(REQUEST_ACCESS_CONTEXT_KEY, access);
  return access;
}

export function getRequestAccess(context: RequestAccessReader): RequestAccess {
  const access = context.get(REQUEST_ACCESS_CONTEXT_KEY);
  if (access === undefined) {
    throw new Error("request access was read before it was resolved");
  }
  return access;
}

export function isMachineRequest(context: RequestAccessReader): boolean {
  return getRequestAccess(context).kind === "machine";
}

export function isAuthenticatedAccess(access: RequestAccess): boolean {
  return access.kind === "owner" || access.kind === "machine";
}

const AUTHENTICATED_PATH_PATTERN = /^\/(?:api|ws)(?:\/|$)/iu;
const PLUGIN_WIRE_PATH_PATTERN = /^\/api\/v1\/plugins\/[^/]+\/http(?:\/|$)/u;
const PUBLIC_API_REQUESTS = new Set([
  "GET /api/v1/access/session",
  "POST /api/v1/access/pairings/redeem",
]);

export function requiresAuthenticatedAccess(
  method: string,
  path: string,
): boolean {
  const collapsed = path.replace(/\/{2,}/gu, "/");
  if (!AUTHENTICATED_PATH_PATTERN.test(collapsed)) return false;
  if (PLUGIN_WIRE_PATH_PATTERN.test(collapsed)) return false;
  return !PUBLIC_API_REQUESTS.has(`${method.toUpperCase()} ${collapsed}`);
}
