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
import type {
  InternalPrincipalAuthority,
  InternalPrincipalSession,
} from "./auth/internal-principal-authority.js";
import type { PrincipalPolicy } from "./auth/principal-policy.js";

export const TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY = "bbTrustedRemoteAddress";
export const GATE_AUTH_HEADER_NAME = "x-bb-gate-auth";
export const GATE_MACHINE_ID_HEADER_NAME = "x-bb-gate-machine-id";
export type GateAuthKind = "machine" | "session";

export interface GateAuthHeaderReader {
  req: { header(name: string): string | undefined };
}

export interface TrustedRemoteAddressReader {
  get(key: typeof TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY): string | undefined;
}

interface PrincipalAuthSession {
  authorize(
    action: PolicyAction,
    resource: PolicyResource,
  ): Promise<PolicyDecision>;
}

function freezePrincipalAuthSession(
  authorize: PrincipalAuthSession["authorize"],
): PrincipalAuthSession {
  return Object.freeze({ authorize });
}

interface AttachedPrincipalSession {
  readonly principal: Principal;
  readonly authorization: PrincipalAuthSession;
}

// Module-private object identity is the authority boundary. A handler can set
// arbitrary Hono context variables, but it cannot discover or replace this
// WeakMap entry with a caller-manufactured Principal/session.
const attachedPrincipalSessions = new WeakMap<
  object,
  AttachedPrincipalSession
>();

declare module "hono" {
  interface ContextVariableMap {
    [TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY]: string | undefined;
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
 * Attach exactly one immutable Principal and its authorize session. Refuses to
 * replace an identity or session that is already present.
 */
function attachResolvedPrincipal(
  context: object,
  principal: Principal,
  session: PrincipalAuthSession,
): void {
  if (attachedPrincipalSessions.has(context)) {
    throw new Error("Principal already attached to request");
  }
  attachedPrincipalSessions.set(
    context,
    Object.freeze({
      principal: freezePrincipal(principal),
      authorization: session,
    }),
  );
}

/**
 * Fail-closed Principal accessor for handlers. Throws when middleware did not
 * resolve an identity.
 */
export function requirePrincipal(context: object): Principal {
  const attached = attachedPrincipalSessions.get(context);
  if (attached === undefined) {
    throw new Error("Principal is not attached to request");
  }
  return attached.principal;
}

/**
 * Fail-closed immutable Principal + authorize session for handlers and the
 * internal execution-scope middleware. Backed only by the module-private
 * attachment; never accepts a Principal argument or Hono variables.
 */
export function requirePrincipalSession(
  context: object,
): InternalPrincipalSession {
  const attached = attachedPrincipalSessions.get(context);
  if (attached === undefined) {
    throw new Error("Principal is not attached to request");
  }
  return Object.freeze({
    principal: attached.principal,
    authorize: attached.authorization.authorize,
  });
}

/**
 * Authorize an action via the request-scoped session closure. Missing session
 * fails closed as unauthenticated without consulting an adapter or accepting a
 * Principal argument.
 */
export async function authorize(
  context: object,
  action: PolicyAction,
  resource: PolicyResource,
): Promise<PolicyDecision> {
  const attached = attachedPrincipalSessions.get(context);
  if (attached === undefined) {
    return { allowed: false, reason: "unauthenticated" };
  }
  return attached.authorization.authorize(action, resource);
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
 * Read the origin-form request target (path + optional query) from the Node
 * adapter's raw incoming URL when present. Fall back for direct Hono tests to
 * pathname + search from the Fetch URL. Hono/Node types stay private here.
 */
function readPrincipalRequestTarget(context: Context): string {
  const env = context.env as
    | {
        server?: { incoming?: { url?: string } };
        incoming?: { url?: string };
      }
    | null
    | undefined;
  const incomingUrl = env?.server?.incoming?.url ?? env?.incoming?.url;
  if (typeof incomingUrl === "string" && incomingUrl.length > 0) {
    return incomingUrl;
  }
  const url = new URL(context.req.url);
  return `${url.pathname}${url.search}`;
}

/**
 * Resolve and attach a Principal session from the injected policy before
 * handlers or WebSocket upgrade callbacks run. Adapter rejection/throw or an
 * invalid resolved session fails closed with 401 and does not attach an
 * identity.
 */
export function createResolvePrincipalMiddleware(
  policy: PrincipalPolicy,
  transport: PrincipalTransport,
): MiddlewareHandler {
  return async (context: Context, next: Next) => {
    if (attachedPrincipalSessions.has(context)) {
      return unauthorizedPrincipalResponse();
    }
    try {
      const resolved = await policy.resolve({
        method: context.req.method,
        target: readPrincipalRequestTarget(context),
        transport,
        getHeader: (name) => context.req.header(name),
      });
      if (
        resolved === null ||
        typeof resolved !== "object" ||
        typeof resolved.authorize !== "function"
      ) {
        return unauthorizedPrincipalResponse();
      }
      const resolvedAuthorize = resolved.authorize.bind(resolved);
      attachResolvedPrincipal(
        context,
        resolved.principal,
        freezePrincipalAuthSession(resolvedAuthorize),
      );
    } catch {
      return unauthorizedPrincipalResponse();
    }
    return next();
  };
}

/**
 * Propagate the request-attached Principal session through
 * InternalPrincipalAuthority.runWithSession for the remainder of the
 * `/api/v1/*` lifetime. Missing attachment fails closed as unauthorized.
 */
export function createInternalPrincipalExecutionScopeMiddleware(
  authority: Pick<InternalPrincipalAuthority, "runWithSession">,
): MiddlewareHandler {
  return async (context: Context, next: Next) => {
    let session: InternalPrincipalSession;
    try {
      session = requirePrincipalSession(context);
    } catch {
      return unauthorizedPrincipalResponse();
    }
    return authority.runWithSession(session, () => next());
  };
}
