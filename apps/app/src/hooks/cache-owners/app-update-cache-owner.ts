import type { SystemAppUpdateStatus } from "@bb/server-contract";
import type { QueryClientArg } from "../cache-effect-types";
import { systemAppUpdateQueryKey } from "../queries/query-keys";

interface HydrateAppUpdateStatusArgs extends QueryClientArg {
  status: SystemAppUpdateStatus;
}

export function hydrateAppUpdateStatus({
  queryClient,
  status,
}: HydrateAppUpdateStatusArgs): void {
  queryClient.setQueryData(systemAppUpdateQueryKey(), status);
}

export function invalidateAppUpdateStatus({
  queryClient,
}: QueryClientArg): void {
  void queryClient.invalidateQueries({ queryKey: systemAppUpdateQueryKey() });
}
