import type { SystemProvidersQuery } from "@bb/server-contract";
import type { WorkSessionDeps } from "../../types.js";
import { requireEnvironment } from "../lib/entity-lookup.js";
import {
  assertUsableHostId,
  requireConnectedPrimaryHostId,
} from "../hosts/primary-host.js";

type SystemHostLookupQuery = Pick<
  SystemProvidersQuery,
  "environmentId" | "hostId"
>;

export function resolveSystemLookupHostId(
  deps: WorkSessionDeps,
  query: SystemHostLookupQuery,
): string {
  if (query.environmentId) {
    const environment = requireEnvironment(deps.db, query.environmentId);
    assertUsableHostId(deps, { hostId: environment.hostId });
    return environment.hostId;
  }
  if (query.hostId) {
    assertUsableHostId(deps, { hostId: query.hostId });
    return query.hostId;
  }
  return requireConnectedPrimaryHostId(deps);
}
