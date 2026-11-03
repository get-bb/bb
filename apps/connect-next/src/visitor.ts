import type { IncomingHttpHeaders } from "node:http";
import {
  MCP_LOCAL_PATH,
  MCP_PUBLIC_PATH,
  RESERVED_HANDLES,
  handleAppLinkAssociationRequest,
  mcpResourceForOrigin,
  parseVisitorHost,
} from "@bb/connect-db";
import {
  GATE_PUBLIC_PATHS,
  gateAudienceForMachine,
  gateAudienceForServer,
  type GateAssertionOAuth,
  type GateResolveRequest,
} from "@bb/tunnel-contract/next";
import type { AccountApi } from "./account-api.js";
import {
  headerSafeClientName,
  isMcpLocalPath,
  isMcpProtectedResourceMetadataPath,
  mcpChallengeReply,
  mcpProtectedResourceMetadataReply,
  readBearerToken,
} from "./mcp.js";
import { machinePage, signInPage, signInRequired } from "./pages.js";
import { redirect, replyFromResponse, text, type Reply } from "./reply.js";

export const MACHINE_CREDENTIAL_HEADER = "x-bb-connect-machine";

export type ForwardAuth = "session" | "machine" | "oauth" | "public";

export interface VisitorPolicy {
  baseDomain: string;
  scheme: "http" | "https";
  accountAppUrl: string;
  sessionCookieName: string;
  desktopSessionCookieName: string;
  assetLinksFingerprints: string;
}

export interface Visit {
  method: string;
  host: string;
  url: string;
  headers: IncomingHttpHeaders;
  websocket: boolean;
}

export interface Forward {
  label: string;
  labelKind: "server" | "machine";
  lastSeenAt: number | null;
  routingKey: string;
  target: string | null;
  audience: string;
  subject: string;
  auth: ForwardAuth;
  machineId: string | null;
  oauth: GateAssertionOAuth | null;
  upstreamPath: string;
  installPath: string | null;
  cacheable: boolean;
  refreshSession: string | null;
  desktopSetCookie: string | null;
}

export type Decision =
  | { kind: "reply"; reply: Reply }
  | { kind: "forward"; forward: Forward }
  | { kind: "machine-label"; credential: string };

export const MACHINE_LABEL_PATH = "/api/connect/machine-label";

const MAX_RESOLVE_STRING = 8 * 1024;
const RESOLVABLE_LABEL = /^[a-z0-9][a-z0-9-]{0,62}$/u;

function bounded(value: string | null): string | null {
  return value === null || value === "" || value.length > MAX_RESOLVE_STRING
    ? null
    : value;
}

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

function reply(value: Reply): Decision {
  return { kind: "reply", reply: value };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function wantsHtml(headers: IncomingHttpHeaders): boolean {
  return (single(headers.accept) ?? "").includes("text/html");
}

export function isHostManagementMutation(
  method: string,
  pathname: string,
): boolean {
  if (method === "POST" && pathname === "/internal/hosts/enroll-key") {
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/hosts/join-codes") {
    return true;
  }
  if (
    method === "PATCH" &&
    /^\/api\/v1\/hosts\/[^/]+\/permission-ceiling$/u.test(pathname)
  ) {
    return true;
  }
  return (
    (method === "PATCH" || method === "DELETE") &&
    /^\/api\/v1\/hosts\/[^/]+$/u.test(pathname)
  );
}

function emptyResolve(label: string): GateResolveRequest {
  return {
    label,
    session: null,
    desktopSession: null,
    credential: null,
    machineCredential: null,
    oauth: null,
  };
}

export function withoutPort(host: string): string {
  return host.replace(/:\d+$/u, "");
}

export function hostPortSuffix(host: string): string {
  return /:\d+$/u.exec(host)?.[0] ?? "";
}

export function tunnelHost(baseDomain: string): string {
  return `tunnel.${baseDomain}`;
}

export async function decideVisit(
  visit: Visit,
  policy: VisitorPolicy,
  accounts: AccountApi,
): Promise<Decision> {
  const { method, host, headers } = visit;
  const ownOrigin = `${policy.scheme}://${host}`;
  if (!visit.url.startsWith("/"))
    return reply(text("bb connect: bad request\n", 400));
  const url = new URL(visit.url, ownOrigin);
  const { pathname, search } = url;
  if (withoutPort(host) === tunnelHost(policy.baseDomain)) {
    return reply(text("bb connect: not found\n", 404));
  }
  const parsed = parseVisitorHost(withoutPort(host), policy.baseDomain);
  if (parsed === null) return reply(text("bb connect: unknown host\n", 404));
  const { handle: label, target } = parsed;
  if (target === null) {
    const appLinks = handleAppLinkAssociationRequest(
      { method, url: url.toString() },
      { ASSETLINKS_SHA256_FINGERPRINTS: policy.assetLinksFingerprints },
    );
    if (appLinks !== null) return reply(await replyFromResponse(appLinks));
  }
  if (RESERVED_HANDLES.has(label)) {
    return reply(redirect(`${policy.accountAppUrl}${pathname}${search}`, 301));
  }
  if (target === null && pathname === MACHINE_LABEL_PATH && !visit.websocket) {
    const credential = single(headers[MACHINE_CREDENTIAL_HEADER]) ?? "";
    if (credential === "" || credential.length > MAX_RESOLVE_STRING) {
      return reply(text("bb connect: machine not authorized\n", 401));
    }
    if (method !== "POST") {
      return reply(text("bb connect: method not allowed\n", 405));
    }
    return { kind: "machine-label", credential };
  }
  if (pathname.startsWith("/__")) {
    return reply(text("bb connect: not found\n", 404));
  }
  if (!RESOLVABLE_LABEL.test(label)) {
    return reply(text(`bb connect: no server for "${label}"\n`, 404));
  }

  const ask = emptyResolve(label);
  const isMcpPublic = target === null && pathname === MCP_PUBLIC_PATH;
  const bearer = isMcpPublic
    ? readBearerToken(single(headers.authorization))
    : null;
  const isInstall = method === "GET" && GATE_PUBLIC_PATHS.has(pathname);
  const isMachinePath =
    pathname.startsWith("/internal") ||
    pathname === "/api/v1" ||
    pathname.startsWith("/api/v1/");
  const machineCredential = single(headers[MACHINE_CREDENTIAL_HEADER]) ?? null;
  const cookieHeader = single(headers.cookie);
  const session = parseCookie(cookieHeader, policy.sessionCookieName);
  const desktopSession = parseCookie(
    cookieHeader,
    policy.desktopSessionCookieName,
  );
  const usesMachineCredential = isMachinePath && machineCredential !== null;
  const token = bounded(bearer);
  if (isMcpPublic && token !== null) {
    ask.oauth = { token, resource: mcpResourceForOrigin(ownOrigin) };
  }
  if (!isMcpPublic && !isInstall && usesMachineCredential && target === null) {
    ask.machineCredential = bounded(machineCredential);
  }
  if (!isMcpPublic && !isInstall && !usesMachineCredential) {
    ask.session = bounded(session);
    ask.desktopSession = bounded(desktopSession);
  }

  const resolved = await accounts.resolve(ask);
  const owner = resolved.label;
  if (owner === null) {
    return reply(text(`bb connect: no server for "${label}"\n`, 404));
  }
  if (owner.kind === "machine" && target === null) {
    return reply(
      machinePage(
        label,
        owner.accountHandle,
        policy.accountAppUrl,
        policy.baseDomain,
      ),
    );
  }
  const base: Omit<Forward, "subject" | "auth"> = {
    label,
    labelKind: owner.kind,
    lastSeenAt: owner.lastSeenAt,
    routingKey: owner.kind === "machine" ? owner.routingKey : label,
    target,
    audience:
      owner.kind === "machine"
        ? gateAudienceForMachine(owner.machineId)
        : gateAudienceForServer(owner.serverId),
    machineId: null,
    oauth: null,
    upstreamPath: visit.url,
    installPath: null,
    cacheable: false,
    refreshSession: null,
    desktopSetCookie: null,
  };
  const forward = (
    rest: Pick<Forward, "subject" | "auth"> & Partial<Forward>,
  ): Decision => ({ kind: "forward", forward: { ...base, ...rest } });

  if (owner.kind === "server" && target === null) {
    if (isMcpLocalPath(pathname)) {
      return reply(text("bb connect: not found\n", 404));
    }
    if (isMcpProtectedResourceMetadataPath(pathname)) {
      if (owner.revoked) return reply(text("bb connect: not found\n", 404));
      if (method === "GET" || method === "HEAD") {
        return reply(
          mcpProtectedResourceMetadataReply(ownOrigin, policy.accountAppUrl),
        );
      }
    }
    if (isMcpPublic) {
      if (bearer === null) return reply(mcpChallengeReply(ownOrigin, null));
      const grant = resolved.oauth;
      if (owner.revoked || grant === null) {
        return reply(mcpChallengeReply(ownOrigin, "invalid_token"));
      }
      return forward({
        subject: owner.userId,
        auth: "oauth",
        oauth: { ...grant, clientName: headerSafeClientName(grant.clientName) },
        upstreamPath: `${MCP_LOCAL_PATH}${search}`,
      });
    }
  }

  if (isInstall) {
    if (target !== null) return reply(text("bb connect: not found\n", 404));
    return forward({ subject: "", auth: "public", installPath: pathname });
  }

  if (target !== null && pathname.startsWith("/internal")) {
    return reply(text("bb connect: not found\n", 404));
  }
  if (usesMachineCredential) {
    if (target !== null) return reply(text("bb connect: not found\n", 404));
    const machine = resolved.machine;
    if (machine === null || machine.userId !== owner.userId) {
      return reply(text("bb connect: machine not authorized\n", 403));
    }
    if (isHostManagementMutation(method, pathname)) {
      return reply(text("bb connect: machine cannot manage hosts\n", 403));
    }
    return forward({
      subject: machine.machineId,
      auth: "machine",
      machineId: machine.machineId,
    });
  }
  if (pathname.startsWith("/internal")) {
    return reply(text("bb connect: machine not authorized\n", 403));
  }

  const signIn = () =>
    reply(
      wantsHtml(headers)
        ? signInPage(label, policy.accountAppUrl, url.toString())
        : signInRequired(),
    );
  if (ask.session === null && ask.desktopSession === null) return signIn();
  const sessionUser = resolved.session?.userId ?? null;
  const desktopUser = resolved.desktopSession?.userId ?? null;
  if (sessionUser === null && desktopUser === null) return signIn();
  if (sessionUser !== owner.userId && desktopUser !== owner.userId) {
    return reply(text("bb connect: not your server\n", 403));
  }
  const origin = single(headers.origin);
  const guarded = visit.websocket || !SAFE_METHODS.has(method);
  if (guarded && origin !== undefined && origin !== ownOrigin) {
    return reply(text("bb connect: cross-origin request refused\n", 403));
  }
  const refreshSession =
    sessionUser === owner.userId && resolved.session?.needsRefresh === true
      ? ask.session
      : null;
  if (refreshSession !== null) accounts.forget(ask);
  return forward({
    subject: owner.userId,
    auth: "session",
    cacheable: method === "GET" && !visit.websocket,
    refreshSession,
    desktopSetCookie:
      desktopUser === owner.userId
        ? (resolved.desktopSession?.setCookie ?? null)
        : null,
  });
}
