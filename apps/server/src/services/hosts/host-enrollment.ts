import { createHostId, getHost } from "@bb/db";
import type { AppDeps } from "../../types.js";
import { assertMatchingExistingHostType } from "./host-type-guard.js";

type HostEnrollmentDeps = Pick<AppDeps, "db" | "machineAuth">;

export interface IssuePersistentHostEnrollKeyArgs {
  hostId?: string;
}

/**
 * Mints an enroll key without creating a host row: the row is created at
 * enroll time (`/internal/hosts/enroll` upserts it with the daemon-reported
 * name). Minting is user-visible in the add-machine flow and may never be
 * redeemed, so a mint must not leave phantom "pending" machines behind.
 */
export async function issuePersistentHostEnrollKey(
  deps: HostEnrollmentDeps,
  args: IssuePersistentHostEnrollKeyArgs,
) {
  const hostId = args.hostId ?? createHostId();
  assertMatchingExistingHostType({
    existingHost: getHost(deps.db, hostId),
    requestedHostType: "persistent",
  });

  const enrollKey = await deps.machineAuth.issueHostEnrollKey({
    hostId,
    hostType: "persistent",
  });

  return { enrollKey, hostId };
}
