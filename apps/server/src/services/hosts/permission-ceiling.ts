import { getEnvironment, getHost } from "@bb/db";
import { clampPermissionModeToCeiling, type PermissionMode } from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";

type PermissionCeilingDeps = Pick<AppDeps, "db">;

export interface ClampPermissionModeToHostArgs {
  hostId: string | null;
  permissionMode: PermissionMode;
  providerId?: string;
}

/**
 * No permission mode at or below the machine's limit is one the provider can
 * run in, so this pairing cannot execute at all. Its own class so read paths
 * can degrade to "no default execution options" the same way they already do
 * for a provider capability mismatch, while work requests still fail loudly.
 */
export class HostPermissionCeilingConflictError extends ApiError {}

export function isHostPermissionCeilingConflictError(
  error: unknown,
): error is HostPermissionCeilingConflictError {
  return error instanceof HostPermissionCeilingConflictError;
}

/**
 * The machine's permission ceiling. An unknown host reports "full" so a
 * missing row never silently downgrades work; the caller fails later on the
 * real "host not found" path instead.
 */
export function getHostPermissionCeiling(
  deps: PermissionCeilingDeps,
  hostId: string | null,
): PermissionMode {
  if (hostId === null) return "full";
  return getHost(deps.db, hostId)?.maxPermissionMode ?? "full";
}

/** The machine a thread's work lands on, or null before it has an environment. */
export function resolveEnvironmentHostId(
  deps: PermissionCeilingDeps,
  environmentId: string | null,
): string | null {
  if (environmentId === null) return null;
  return getEnvironment(deps.db, environmentId)?.hostId ?? null;
}

/**
 * Resolve a requested mode against the machine's ceiling. Work never fails
 * because someone asked for too much — it runs at the highest mode the machine
 * and the provider both allow — but a provider that supports nothing that low
 * cannot run on the machine at all, and that is an error.
 */
export function clampPermissionModeToHost(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  args: ClampPermissionModeToHostArgs,
): PermissionMode {
  const ceiling = getHostPermissionCeiling(deps, args.hostId);
  const supported = args.providerId
    ? deps.providerRegistry.getSupportedPermissionModes(args.providerId)
    : null;
  const clamped = clampPermissionModeToCeiling({
    ceiling,
    permissionMode: args.permissionMode,
    ...(supported ? { permissionModes: supported } : {}),
  });
  if (clamped === null) {
    throw new HostPermissionCeilingConflictError(
      400,
      "host_permission_ceiling_conflict",
      `This machine limits permission mode to ${ceiling}, and provider ${args.providerId} requires a higher mode.`,
    );
  }
  return clamped;
}
