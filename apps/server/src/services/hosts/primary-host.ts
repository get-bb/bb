import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getExperiments, listPublicHosts, type DbConnection } from "@bb/db";
import { HOST_ID_FILE_NAME } from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import {
  requireConnectedHostSession,
  requireNonDestroyedHostWithStatus,
} from "../lib/entity-lookup.js";

type PrimaryHostDeps = Pick<AppDeps, "config" | "db" | "hub">;

export interface ReadPrimaryHostIdArgs {
  dataDir: string;
}

export interface AssertUsableHostIdArgs {
  hostId: string;
}

function unsupportedHostError(): ApiError {
  return new ApiError(
    400,
    "unsupported_host",
    "Host cannot run threads",
  );
}

function primaryHostUnavailableError(): ApiError {
  return new ApiError(
    502,
    "host_unavailable",
    "Local host daemon is not initialized",
  );
}

function multiMachineDisabledError(): ApiError {
  return new ApiError(
    403,
    "multi_machine_disabled",
    'Targeting another host is disabled — enable the "Multi-machine" experiment in Settings → Experiments.',
  );
}

export function readPrimaryHostIdFromDataDir(
  args: ReadPrimaryHostIdArgs,
): string | null {
  try {
    const value = readFileSync(
      join(args.dataDir, HOST_ID_FILE_NAME),
      "utf8",
    ).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function resolveSinglePublicHostId(db: DbConnection): string | null {
  const hosts = listPublicHosts(db);
  if (hosts.length !== 1) {
    return null;
  }
  const host = hosts[0];
  return host?.id ?? null;
}

function resolveSingleConnectedPublicHostId(
  deps: PrimaryHostDeps,
): string | null {
  const hosts = listPublicHosts(deps.db).filter((host) =>
    deps.hub.hasDaemonForHost(host.id),
  );
  if (hosts.length !== 1) {
    return null;
  }
  const host = hosts[0];
  return host?.id ?? null;
}

export function resolvePrimaryHostId(deps: PrimaryHostDeps): string | null {
  return (
    readPrimaryHostIdFromDataDir({ dataDir: deps.config.dataDir }) ??
    resolveSingleConnectedPublicHostId(deps) ??
    resolveSinglePublicHostId(deps.db)
  );
}

export function requirePrimaryHostId(deps: PrimaryHostDeps): string {
  const hostId = resolvePrimaryHostId(deps);
  if (!hostId) {
    throw primaryHostUnavailableError();
  }
  return hostId;
}

/**
 * Validate that `hostId` is a real, non-destroyed public host that may be
 * targeted for execution. Accepts ANY public host (not just the primary), while
 * rejecting unknown/destroyed/non-public host ids. Default host resolution
 * (`resolvePrimaryHostId`) is unchanged, so callers that don't take an explicit
 * host keep defaulting to the local primary — single-host behavior is
 * preserved. Liveness is enforced downstream at dispatch (`callHostOnlineRpc` →
 * `ensureHostSessionReadyForWork`), so validation here does not require a live
 * session (matching the previous primary-only assertion).
 *
 * Targeting a host other than the primary requires the "Multi-machine"
 * experiment; the primary host is always usable so single-host setups are
 * unaffected by the toggle.
 */
export function assertUsableHostId(
  deps: PrimaryHostDeps,
  args: AssertUsableHostIdArgs,
): void {
  // 404 for unknown/destroyed hosts; a clearer signal than "unsupported".
  requireNonDestroyedHostWithStatus(deps, args.hostId);
  // 400 if the host exists but is not a public host users can target.
  const isPublicHost = listPublicHosts(deps.db).some(
    (host) => host.id === args.hostId,
  );
  if (!isPublicHost) {
    throw unsupportedHostError();
  }
  if (
    args.hostId !== resolvePrimaryHostId(deps) &&
    !getExperiments(deps.db).multiMachine
  ) {
    throw multiMachineDisabledError();
  }
}

export function requireConnectedPrimaryHostId(deps: PrimaryHostDeps): string {
  const hostId = requirePrimaryHostId(deps);
  requireNonDestroyedHostWithStatus(deps, hostId);
  requireConnectedHostSession(deps, hostId);
  return hostId;
}
