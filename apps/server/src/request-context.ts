import { getConnInfo } from "@hono/node-server/conninfo";
import {
  APP_SURFACE_API,
  APP_SURFACE_HEADER_NAME,
  parseRequestAppSurface,
  type RequestAppSurface,
} from "@bb/config/app-surface";
import type { Context } from "hono";
import type { ThreadCreateOrigin } from "@bb/domain";

export const TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY = "bbTrustedRemoteAddress";
const GATE_AUTH_HEADER_NAME = "x-bb-gate-auth";
const GATE_MACHINE_ID_HEADER_NAME = "x-bb-gate-machine-id";
type GateAuthKind = "machine" | "session";

export interface GateAuthHeaderReader {
  req: { header(name: string): string | undefined };
}

interface TrustedRemoteAddressReader {
  get(key: typeof TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY): string | undefined;
}

declare module "hono" {
  interface ContextVariableMap {
    [TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY]: string | undefined;
  }
}

const tunnelIngressRequests = new WeakSet<object>();

export function markTunnelIngressRequest(incoming: object): void {
  tunnelIngressRequests.add(incoming);
}

function isTunnelIngressContext(context: Context): boolean {
  const env: unknown = context.env;
  if (typeof env !== "object" || env === null || !("incoming" in env)) {
    return false;
  }
  const incoming = env.incoming;
  return (
    typeof incoming === "object" &&
    incoming !== null &&
    tunnelIngressRequests.has(incoming)
  );
}

export function captureTrustedRemoteAddress(context: Context): void {
  if (isTunnelIngressContext(context)) {
    context.set(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY, undefined);
    return;
  }
  try {
    context.set(
      TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY,
      getConnInfo(context).remote.address,
    );
  } catch {
    context.set(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY, undefined);
  }
}

export function getTrustedRemoteAddress(
  context: TrustedRemoteAddressReader,
): string | undefined {
  return context.get(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY);
}

export function getGateAuthKind(
  context: GateAuthHeaderReader,
): GateAuthKind | null {
  const value = context.req.header(GATE_AUTH_HEADER_NAME);
  return value === "machine" || value === "session" ? value : null;
}

export function getGateMachineId(context: GateAuthHeaderReader): string | null {
  const value = context.req.header(GATE_MACHINE_ID_HEADER_NAME)?.trim();
  return value ? value : null;
}

export function resolveRequestAppSurface(
  context: GateAuthHeaderReader,
): RequestAppSurface {
  return (
    parseRequestAppSurface(context.req.header(APP_SURFACE_HEADER_NAME)) ??
    APP_SURFACE_API
  );
}

export function resolveRequestThreadOrigin(
  context: GateAuthHeaderReader,
  origin: ThreadCreateOrigin | undefined,
): ThreadCreateOrigin {
  return (
    origin ?? (resolveRequestAppSurface(context) === "api" ? "sdk" : "app")
  );
}

export function resolveRequestAccessRoute(
  context: Context,
): "connect" | "direct" | "unknown" {
  if (isTunnelIngressContext(context)) return "connect";
  const remoteAddress = getTrustedRemoteAddress(context);
  if (
    remoteAddress === undefined ||
    remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1" ||
    remoteAddress === "::ffff:127.0.0.1"
  )
    return "unknown";
  return "direct";
}

export function isAuthenticatedConnectRequest(context: Context): boolean {
  return isTunnelIngressContext(context) && getGateAuthKind(context) !== null;
}
