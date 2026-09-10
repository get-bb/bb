import { getProjectSourceByHost } from "@bb/db";
import { isLocalPathProjectSource } from "@bb/domain";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import type { WorkSessionDeps } from "../../types.js";
import {
  getNonDestroyedHostWithStatus,
  listPublicHostsWithStatus,
  requirePublicProject,
} from "../lib/entity-lookup.js";
import type { PluginEnvironmentProviderRecord } from "../plugins/plugin-environment-provider-registry.js";
import {
  environmentProviderMatchesContext,
  resolveGitCheckoutAvailability,
  resolvePluginEnvironmentProviderAvailability,
} from "./provider-availability.js";

type Availability = NonNullable<SystemEnvironmentProvider["availability"]>;

const MACHINE_AVAILABILITY_TTL_MS = 10 * 60_000;

interface MachineAvailabilityEntry {
  availability: Availability | null;
  checkedAt: number;
  pending: Promise<void> | null;
}

let entriesByProvider = new WeakMap<
  PluginEnvironmentProviderRecord["provider"],
  Map<string, MachineAvailabilityEntry>
>();

export function invalidateEnvironmentProviderMachineAvailability(): void {
  entriesByProvider = new WeakMap();
}

export function environmentProviderMachineAvailability(
  deps: WorkSessionDeps,
  record: PluginEnvironmentProviderRecord,
  query: { projectId: string; hostId?: string },
): Record<string, Availability | null> {
  const hosts =
    query.hostId === undefined
      ? listPublicHostsWithStatus(deps)
      : [getNonDestroyedHostWithStatus(deps, query.hostId)];
  const result: Record<string, Availability | null> = {};
  for (const host of hosts) {
    if (host === null || host.type !== "persistent") continue;
    if (
      !environmentProviderMatchesContext(deps, record, {
        projectId: query.projectId,
        hostId: host.id,
      })
    ) {
      continue;
    }
    result[host.id] = peekMachineAvailability(deps, record, {
      projectId: query.projectId,
      hostId: host.id,
      connected: host.status === "connected",
    });
  }
  return result;
}

function peekMachineAvailability(
  deps: WorkSessionDeps,
  record: PluginEnvironmentProviderRecord,
  args: { projectId: string; hostId: string; connected: boolean },
): Availability | null {
  const sessionId = args.connected
    ? deps.hub.getDaemonSessionIdForHost(args.hostId)
    : null;
  const entries = entriesFor(record);
  const key = JSON.stringify([args.projectId, args.hostId]);
  const entry = entries.get(key);
  if (sessionId === null || sessionId === undefined) {
    return entry?.availability ?? null;
  }
  const fresh =
    entry !== undefined &&
    entry.availability !== null &&
    Date.now() - entry.checkedAt < MACHINE_AVAILABILITY_TTL_MS;
  if (fresh || (entry !== undefined && entry.pending !== null)) {
    return entry.availability;
  }
  const next: MachineAvailabilityEntry = {
    availability: entry?.availability ?? null,
    checkedAt: entry?.checkedAt ?? 0,
    pending: null,
  };
  next.pending = probeMachineAvailability(deps, record, args)
    .then((availability) => {
      const changed =
        JSON.stringify(next.availability) !== JSON.stringify(availability);
      next.availability = availability;
      next.checkedAt = Date.now();
      if (changed) {
        deps.hub.notifySystem(["environment-availability-changed"]);
      }
    })
    .catch((error: unknown) => {
      deps.logger.warn(
        `Environment provider "${record.provider.id}" machine availability probe failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    })
    .finally(() => {
      next.pending = null;
    });
  entries.set(key, next);
  return next.availability;
}

function entriesFor(
  record: PluginEnvironmentProviderRecord,
): Map<string, MachineAvailabilityEntry> {
  let entries = entriesByProvider.get(record.provider);
  if (entries === undefined) {
    entries = new Map();
    entriesByProvider.set(record.provider, entries);
  }
  return entries;
}

async function probeMachineAvailability(
  deps: WorkSessionDeps,
  record: PluginEnvironmentProviderRecord,
  args: { projectId: string; hostId: string },
): Promise<Availability> {
  const project = requirePublicProject(deps.db, args.projectId);
  const host = getNonDestroyedHostWithStatus(deps, args.hostId);
  if (host === null) {
    return { status: "unavailable", message: "This machine no longer exists." };
  }
  const source = getProjectSourceByHost(deps.db, project.id, host.id);
  const projectCheckout =
    source !== null && isLocalPathProjectSource(source)
      ? { path: source.path }
      : null;
  if (record.provider.requires.gitCheckout && projectCheckout !== null) {
    const checkout = await resolveGitCheckoutAvailability(deps, {
      hostId: host.id,
      path: projectCheckout.path,
    });
    if (checkout.status !== "available") return checkout;
  }
  const resolution = await resolvePluginEnvironmentProviderAvailability(
    record,
    {
      project,
      host,
      projectCheckout,
      gitRemote: project.gitRemoteUrl,
    },
  );
  if (!resolution.ok) {
    return { status: "unavailable", message: resolution.message };
  }
  return resolution.availability;
}
