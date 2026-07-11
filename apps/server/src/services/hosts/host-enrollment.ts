import { createHostId, getHost, upsertHost } from "@bb/db";
import type { AppDeps } from "../../types.js";
import { assertMatchingExistingHostType } from "./host-type-guard.js";

type HostEnrollmentDeps = Pick<AppDeps, "db" | "hub" | "machineAuth">;

export interface IssuePersistentHostEnrollKeyArgs {
  hostId?: string;
  hostName?: string;
}

function resolvePendingHostName(hostId: string): string {
  return `pending-${hostId.slice(-8)}`;
}

export async function issuePersistentHostEnrollKey(
  deps: HostEnrollmentDeps,
  args: IssuePersistentHostEnrollKeyArgs,
) {
  const hostId = args.hostId ?? createHostId();
  const existing = getHost(deps.db, hostId);
  assertMatchingExistingHostType({
    existingHost: existing,
    requestedHostType: "persistent",
  });

  upsertHost(deps.db, deps.hub, {
    id: hostId,
    name: args.hostName ?? existing?.name ?? resolvePendingHostName(hostId),
    type: "persistent",
  });

  const enrollKey = await deps.machineAuth.issueHostEnrollKey({
    hostId,
    hostType: "persistent",
  });

  return { enrollKey, hostId };
}
