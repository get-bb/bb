import { isLoopbackAddress } from "@bb/config/loopback";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type {
  AccessCredential,
  AccessService,
} from "./services/access/access-service.js";
import {
  ACCESS_TOKEN_PREFIX,
  DEVICE_ACCESS_TOKEN_PREFIX,
  type DeviceTokenCheck,
} from "./services/access/access-service.js";
import { LOCAL_ACCESS_TOKEN_PREFIX } from "@bb/config/local-access-token";
import { PLUGIN_RPC_CALLER_HEADER } from "./services/plugins/plugin-rpc-caller.js";
import type { MachineAuthService } from "./services/machine-auth.js";

export const TUNNEL_MARKER_HEADER_NAME = "x-bb-tunnel-marker";
const GATE_HEADER_PREFIX = "x-bb-gate-";
const REQUEST_ACCESS_CONTEXT_KEY = "bbRequestAccess";
export const UNAUTHENTICATED_MESSAGE =
  "Sign in to this bb first: get a pairing code from `bb access pair` on the server machine or Settings → Devices on a signed-in device, then enter it on bb's sign-in screen (reload any open bb page) or run `bb access login --code <code>`. On the server machine the bb CLI signs in with <data dir>/local-access-token; set BB_DATA_DIR if bb uses another data directory.";
export const CREDENTIAL_REQUIRES_HTTPS_MESSAGE =
  "This sign-in was made over HTTPS and is not accepted over plain HTTP. Use the HTTPS address, or sign in again on this address.";

export type RequestAccess =
  | { kind: "owner"; via: "local" | "in-process" | "plugin" | "connect" }
  | { kind: "owner"; via: "credential"; credential: AccessCredential }
  | { kind: "machine"; via: "connect" | "host-key" }
  | { kind: "oauth" }
  | {
      kind: "anonymous";
      via: "connect" | "direct";
      problem: AccessProblem | null;
    };

export type AccessProblem =
  | "credential_requires_https"
  | "access_token_expired"
  | "invalid_dpop_proof";

export function accessProblemMessage(problem: AccessProblem): string {
  switch (problem) {
    case "credential_requires_https":
      return CREDENTIAL_REQUIRES_HTTPS_MESSAGE;
    case "access_token_expired":
      return "This device's access token expired. Renew it at /api/v1/access/token with a DPoP proof from the same key.";
    case "invalid_dpop_proof":
      return "This request's DPoP proof is missing, invalid, replayed, or from another key. A device-bound token is never accepted without its proof.";
  }
}

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
  isPluginCallerToken: (token: string) => boolean;
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

function headerList(value: string | undefined): string[] {
  return value === undefined
    ? []
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
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

function authorizationToken(
  context: RequestReader,
): { scheme: "bearer" | "dpop"; token: string } | null {
  const authorization = context.req.header("authorization");
  if (authorization === undefined) return null;
  const match = /^(Bearer|DPoP)\s+(\S+)\s*$/iu.exec(authorization);
  if (match === null) return null;
  return {
    scheme: match[1]!.toLowerCase() === "dpop" ? "dpop" : "bearer",
    token: match[2]!,
  };
}

function credentialAccess(
  credential: AccessCredential,
  https: boolean,
): RequestAccess {
  return credential.secureOnly && !https
    ? { kind: "anonymous", via: "direct", problem: "credential_requires_https" }
    : { kind: "owner", via: "credential", credential };
}

function rejected(problem: AccessProblem | null): RequestAccess {
  return { kind: "anonymous", via: "direct", problem };
}

export function requestUrlForDpop(
  context: RequestReader,
  remoteAddress: string | undefined,
): string {
  const forwardedHost = isLoopbackPeer(remoteAddress)
    ? headerList(context.req.header("x-forwarded-host"))[0]
    : undefined;
  const host =
    forwardedHost ??
    context.req.header("host") ??
    new URL(context.req.url).host;
  const protocol = isHttpsRequest(context, remoteAddress) ? "https" : "http";
  return `${protocol}://${host}${context.req.path}`;
}

function deviceCheckAccess(
  check: DeviceTokenCheck,
  https: boolean,
): RequestAccess {
  switch (check.outcome) {
    case "valid":
      return credentialAccess(check.credential, https);
    case "expired":
      return rejected("access_token_expired");
    case "invalid-proof":
      return rejected("invalid_dpop_proof");
    case "invalid":
      return rejected(null);
  }
}

const WEBSOCKET_PATH_PATTERN = /^\/ws(?:\/|$)/u;

async function directAccess(
  context: Context,
  deps: RequestAccessDeps,
  remoteAddress: string | undefined,
): Promise<RequestAccess> {
  if (remoteAddress === undefined) return { kind: "owner", via: "in-process" };
  const https = isHttpsRequest(context, remoteAddress);
  const pluginCaller = context.req.header(PLUGIN_RPC_CALLER_HEADER);
  if (pluginCaller !== undefined && deps.isPluginCallerToken(pluginCaller)) {
    return { kind: "owner", via: "plugin" };
  }
  const authorization = authorizationToken(context);
  if (authorization !== null) {
    const { scheme, token } = authorization;
    if (scheme === "dpop") {
      return deviceCheckAccess(
        deps.access.checkDeviceToken(token, {
          method: context.req.method,
          url: requestUrlForDpop(context, remoteAddress),
          proof: context.req.header("dpop"),
        }),
        https,
      );
    }
    if (token.startsWith(LOCAL_ACCESS_TOKEN_PREFIX)) {
      return deps.access.isLocalToken(token)
        ? { kind: "owner", via: "local" }
        : rejected(null);
    }
    if (token.startsWith(DEVICE_ACCESS_TOKEN_PREFIX)) {
      return rejected("invalid_dpop_proof");
    }
    if (
      !context.req.path.startsWith("/internal/") &&
      !token.startsWith(ACCESS_TOKEN_PREFIX) &&
      (await deps.machineAuth.verifyDaemonHostKey(token)) !== null
    ) {
      return { kind: "machine", via: "host-key" };
    }
  }
  const ticket = WEBSOCKET_PATH_PATTERN.test(context.req.path)
    ? context.req.query("wsTicket")
    : undefined;
  if (ticket !== undefined) {
    return deviceCheckAccess(
      deps.access.checkWebSocketTicket(ticket, {
        method: context.req.method,
        url: requestUrlForDpop(context, remoteAddress),
        proof: context.req.query("dpop"),
      }),
      https,
    );
  }
  const cookie = getCookie(context, accessCookieName(deps.config.serverPort));
  if (cookie !== undefined) {
    const credential = deps.access.credentialForToken(cookie);
    if (credential !== null) return credentialAccess(credential, https);
  }
  return rejected(null);
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
  "POST /api/v1/access/token",
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
