import { getConnInfo } from "@hono/node-server/conninfo";
import {
  APP_SURFACE_HEADER_NAME,
  parseAppSurface,
  type AppSurface,
} from "@bb/config/app-surface";
import type {
  PolicyAction,
  PolicyDecision,
  PolicyResource,
  Principal,
  PrincipalTransport,
} from "@bb/domain";
import type { Context, MiddlewareHandler, Next } from "hono";
import type { PrincipalPolicy } from "./auth/principal-policy.js";

export const TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY = "bbTrustedRemoteAddress";
const PRINCIPAL_CONTEXT_KEY = "bbPrincipal";
const PRINCIPAL_POLICY_CONTEXT_KEY = "bbPrincipalPolicy";
export const GATE_AUTH_HEADER_NAME = "x-bb-gate-auth";
export const GATE_MACHINE_ID_HEADER_NAME = "x-bb-gate-machine-id";
export type GateAuthKind = "machine" | "session";

export interface GateAuthHeaderReader {
  req: { header(name: string): string | undefined };
}

export interface TrustedRemoteAddressReader {
  get(key: typeof TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY): string | undefined;
}

interface PrincipalContextReader {
  get(key: typeof PRINCIPAL_CONTEXT_KEY): Principal | undefined;
}

interface PrincipalAuthorizationContext {
  get(key: typeof PRINCIPAL_CONTEXT_KEY): Principal | undefined;
  get(key: typeof PRINCIPAL_POLICY_CONTEXT_KEY): PrincipalPolicy | undefined;
}

interface PrincipalContextWriter {
  get(key: typeof PRINCIPAL_CONTEXT_KEY): Principal | undefined;
  set(key: typeof PRINCIPAL_CONTEXT_KEY, value: Principal): void;
}

declare module "hono" {
  interface ContextVariableMap {
    [TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY]: string | undefined;
    [PRINCIPAL_CONTEXT_KEY]: Principal | undefined;
    [PRINCIPAL_POLICY_CONTEXT_KEY]: PrincipalPolicy | undefined;
  }
}

export function captureTrustedRemoteAddress(context: Context): void {
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
  context: Context,
  fallback: AppSurface,
): AppSurface {
  return (
    parseAppSurface(context.req.header(APP_SURFACE_HEADER_NAME)) ?? fallback
  );
}

function freezePrincipal(principal: Principal): Principal {
  if (
    principal === null ||
    typeof principal !== "object" ||
    typeof principal.id !== "string" ||
    principal.id.trim().length === 0 ||
    typeof principal.displayName !== "string" ||
    !["human", "agent", "machine", "system"].includes(principal.kind)
  ) {
    throw new Error("Principal policy returned an invalid Principal");
  }
  return Object.freeze({
    id: principal.id,
    kind: principal.kind,
    displayName: principal.displayName,
  });
}

/**
 * Attach exactly one immutable Principal to the request. Refuses to replace an
 * identity that is already present.
 */
function attachPrincipal(
  context: PrincipalContextWriter,
  principal: Principal,
): void {
  if (context.get(PRINCIPAL_CONTEXT_KEY) !== undefined) {
    throw new Error("Principal already attached to request");
  }
  context.set(PRINCIPAL_CONTEXT_KEY, freezePrincipal(principal));
}

/**
 * Fail-closed Principal accessor for handlers. Throws when middleware did not
 * resolve an identity.
 */
export function requirePrincipal(context: PrincipalContextReader): Principal {
  const principal = context.get(PRINCIPAL_CONTEXT_KEY);
  if (principal === undefined) {
    throw new Error("Principal is not attached to request");
  }
  return principal;
}

/**
 * Authorize an action against the request Principal. Missing identity fails
 * closed as unauthenticated without consulting an adapter.
 */
export async function authorize(
  context: PrincipalAuthorizationContext,
  action: PolicyAction,
  resource: PolicyResource,
): Promise<PolicyDecision> {
  const principal = context.get(PRINCIPAL_CONTEXT_KEY);
  const policy = context.get(PRINCIPAL_POLICY_CONTEXT_KEY);
  if (principal === undefined || policy === undefined) {
    return { allowed: false, reason: "unauthenticated" };
  }
  return policy.authorize(principal, action, resource);
}

function unauthorizedPrincipalResponse(): Response {
  return new Response(
    JSON.stringify({ code: "unauthorized", message: "Unauthorized" }),
    {
      status: 401,
      headers: { "content-type": "application/json" },
    },
  );
}

/**
 * Resolve and attach a Principal from the injected policy before handlers or
 * WebSocket upgrade callbacks run. Adapter rejection/throw fails closed with
 * 401 and does not attach an identity.
 */
export function createResolvePrincipalMiddleware(
  policy: PrincipalPolicy,
  transport: PrincipalTransport,
): MiddlewareHandler {
  return async (context: Context, next: Next) => {
    if (context.get(PRINCIPAL_CONTEXT_KEY) !== undefined) {
      return unauthorizedPrincipalResponse();
    }
    try {
      const principal = await policy.principal({
        method: context.req.method,
        path: context.req.path,
        transport,
        getHeader: (name) => context.req.header(name),
      });
      attachPrincipal(context, principal);
      context.set(PRINCIPAL_POLICY_CONTEXT_KEY, policy);
    } catch {
      return unauthorizedPrincipalResponse();
    }
    return next();
  };
}
