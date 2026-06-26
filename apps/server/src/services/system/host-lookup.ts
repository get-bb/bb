import type { SystemExecutionOptionsQuery } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import {
  requireEnvironment,
  requireNonDestroyedHostWithStatus,
} from "../lib/entity-lookup.js";
import {
  assertPrimaryHostId,
  requireConnectedPrimaryHostId,
} from "../hosts/primary-host.js";

export type SystemHostLookupQuery = Pick<
  SystemExecutionOptionsQuery,
  "environmentId" | "hostId"
>;

export function resolveSystemLookupHostId(
  deps: AppDeps,
  query: SystemHostLookupQuery,
): string {
  if (query.environmentId) {
    const environment = requireEnvironment(deps.db, query.environmentId);
    requireNonDestroyedHostWithStatus(deps, environment.hostId);
    assertPrimaryHostId(deps, { hostId: environment.hostId });
    return environment.hostId;
  }
  if (query.hostId) {
    requireNonDestroyedHostWithStatus(deps, query.hostId);
    assertPrimaryHostId(deps, { hostId: query.hostId });
    return query.hostId;
  }
  return requireConnectedPrimaryHostId(deps);
}
