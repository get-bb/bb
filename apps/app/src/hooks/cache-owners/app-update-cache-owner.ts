import type { SystemAppUpdateStatus } from "@bb/server-contract";
import type { QueryClientArg } from "../cache-effect-types";
import { systemAppUpdateQueryKey } from "../queries/query-keys";
import { setQueryDataOverInFlightFetch } from "./cache-effect-utils";

interface HydrateAppUpdateStatusArgs extends QueryClientArg {
  status: SystemAppUpdateStatus;
}

export function hydrateAppUpdateStatus({
  queryClient,
  status,
}: HydrateAppUpdateStatusArgs): void {
  setQueryDataOverInFlightFetch<SystemAppUpdateStatus>(
    queryClient,
    systemAppUpdateQueryKey(),
    status,
  );
}

export function invalidateAppUpdateStatus({
  queryClient,
}: QueryClientArg): void {
  void queryClient.invalidateQueries({ queryKey: systemAppUpdateQueryKey() });
}
