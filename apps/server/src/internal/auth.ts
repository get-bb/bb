import { hostTypeSchema, type HostType, type Principal } from "@bb/domain";
import { z } from "zod";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";

/** Fixed display name for host-daemon machine Principals — never caller-controlled. */
export const MACHINE_PRINCIPAL_DISPLAY_NAME = "Host daemon";

export interface AuthenticatedDaemon {
  readonly hostId: string;
  readonly hostType: HostType;
  readonly keyId: string;
  readonly principal: Principal;
}

const machinePrincipalSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("machine"),
    displayName: z.literal(MACHINE_PRINCIPAL_DISPLAY_NAME),
  })
  .strict();

const authenticatedDaemonSchema = z
  .object({
    hostId: z.string().min(1),
    hostType: hostTypeSchema,
    keyId: z.string().min(1),
    principal: machinePrincipalSchema,
  })
  .strict()
  .refine((value) => value.principal.id === value.hostId, {
    message: "machine Principal id must equal hostId",
  });

// Module-private brand: only objects minted by verifyAuthenticatedDaemon may be
// attached. Structural clones and forged Principals cannot enter the WeakSet.
const issuedAuthenticatedDaemons = new WeakSet<object>();

// Module-private authority store. Callers can set arbitrary Hono variables, but
// they cannot discover or replace this WeakMap entry.
const attachedAuthenticatedDaemons = new WeakMap<object, AuthenticatedDaemon>();

function freezeMachinePrincipal(hostId: string): Principal {
  return Object.freeze({
    id: hostId,
    kind: "machine",
    displayName: MACHINE_PRINCIPAL_DISPLAY_NAME,
  });
}

function mintAuthenticatedDaemon(args: {
  hostId: string;
  hostType: HostType;
  keyId: string;
}): AuthenticatedDaemon {
  const candidate = {
    hostId: args.hostId,
    hostType: args.hostType,
    keyId: args.keyId,
    principal: freezeMachinePrincipal(args.hostId),
  };
  const parsed = authenticatedDaemonSchema.parse(candidate);
  const daemon: AuthenticatedDaemon = Object.freeze({
    hostId: parsed.hostId,
    hostType: parsed.hostType,
    keyId: parsed.keyId,
    principal: Object.freeze({
      id: parsed.principal.id,
      kind: parsed.principal.kind,
      displayName: parsed.principal.displayName,
    }),
  });
  issuedAuthenticatedDaemons.add(daemon);
  return daemon;
}

function isIssuedAuthenticatedDaemon(
  value: unknown,
): value is AuthenticatedDaemon {
  return (
    typeof value === "object" &&
    value !== null &&
    issuedAuthenticatedDaemons.has(value)
  );
}

export function requireBearerToken(
  authorizationHeader: string | undefined,
): string {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new ApiError(401, "unauthorized", "Unauthorized");
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (token.length === 0) {
    throw new ApiError(401, "unauthorized", "Unauthorized");
  }

  return token;
}

export type DaemonHostKeyVerifier = {
  machineAuth: Pick<AppDeps["machineAuth"], "verifyDaemonHostKey">;
};

export async function verifyAuthenticatedDaemon(
  deps: DaemonHostKeyVerifier,
  authorizationHeader: string | undefined,
): Promise<AuthenticatedDaemon> {
  const token = requireBearerToken(authorizationHeader);
  const verified = await deps.machineAuth.verifyDaemonHostKey(token);
  if (!verified) {
    throw new ApiError(401, "unauthorized", "Unauthorized");
  }

  return mintAuthenticatedDaemon({
    hostId: verified.metadata.hostId,
    hostType: verified.metadata.hostType,
    keyId: verified.keyId,
  });
}

/**
 * Attach exactly one verified authenticated-daemon identity to a request
 * context. Refuses forged objects and duplicate/replacement attaches.
 */
export function setAuthenticatedDaemon(
  context: object,
  daemon: AuthenticatedDaemon,
): void {
  if (!isIssuedAuthenticatedDaemon(daemon)) {
    throw new Error(
      "Authenticated daemon was not issued by verifyAuthenticatedDaemon",
    );
  }
  if (attachedAuthenticatedDaemons.has(context)) {
    throw new Error("Authenticated daemon already attached to request");
  }
  attachedAuthenticatedDaemons.set(context, daemon);
}

/**
 * Fail-closed accessor for the privately attached authenticated daemon. Ignores
 * caller-set Hono variables.
 */
export function getAuthenticatedDaemon(context: object): AuthenticatedDaemon {
  const daemon = attachedAuthenticatedDaemons.get(context);
  if (!isIssuedAuthenticatedDaemon(daemon)) {
    throw new ApiError(
      500,
      "internal_error",
      "Daemon authentication context missing",
    );
  }
  return daemon;
}

export function assertAuthenticatedHostMatches(
  daemon: AuthenticatedDaemon,
  args: { hostId: string; hostType: HostType },
): void {
  if (daemon.hostId !== args.hostId || daemon.hostType !== args.hostType) {
    throw new ApiError(
      403,
      "invalid_request",
      "Authenticated host does not match request",
    );
  }
}
