import { getEnvironment, getHost, getThread } from "@bb/db";
import { clampPermissionModeToCeiling, type PermissionMode } from "@bb/domain";
import {
  buildAcpProviderInfo,
  getBuiltInAgentProviderInfo,
  isAcpProviderId,
  isAgentProviderId,
} from "@bb/agent-providers";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";

type PermissionCeilingDeps = Pick<AppDeps, "db">;

export interface ClampPermissionModeToHostArgs {
  hostId: string | null;
  permissionMode: PermissionMode;
  providerId?: string;
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
export function resolveThreadHostId(
  deps: PermissionCeilingDeps,
  threadId: string,
): string | null {
  const thread = getThread(deps.db, threadId);
  if (!thread?.environmentId) return null;
  return getEnvironment(deps.db, thread.environmentId)?.hostId ?? null;
}

function supportedPermissionModes(
  providerId: string | undefined,
): readonly PermissionMode[] | undefined {
  if (!providerId) return undefined;
  const provider = isAgentProviderId(providerId)
    ? getBuiltInAgentProviderInfo(providerId)
    : isAcpProviderId(providerId)
      ? buildAcpProviderInfo({
          id: providerId,
          displayName: providerId,
          logoUrl: null,
        })
      : null;
  return provider?.capabilities.supportedPermissionModes;
}

/**
 * Resolve a requested mode against the machine's ceiling. Work never fails
 * because someone asked for too much — it runs at the highest mode the machine
 * and the provider both allow — but a provider that supports nothing that low
 * cannot run on the machine at all, and that is an error.
 */
export function clampPermissionModeToHost(
  deps: PermissionCeilingDeps,
  args: ClampPermissionModeToHostArgs,
): PermissionMode {
  const ceiling = getHostPermissionCeiling(deps, args.hostId);
  const supported = supportedPermissionModes(args.providerId);
  const clamped = clampPermissionModeToCeiling({
    ceiling,
    permissionMode: args.permissionMode,
    ...(supported ? { supportedPermissionModes: supported } : {}),
  });
  if (clamped === null) {
    throw new ApiError(
      400,
      "host_permission_ceiling_conflict",
      `This machine limits permission mode to ${ceiling}, and provider ${args.providerId} requires a higher mode.`,
    );
  }
  return clamped;
}
