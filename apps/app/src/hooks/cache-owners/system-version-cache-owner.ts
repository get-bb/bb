import type { QueryClient } from "@tanstack/react-query";
import type { SystemVersionResponse } from "@bb/server-contract";
import { systemVersionQueryKey } from "../queries/query-keys";

export interface HydrateSystemVersionCacheArgs {
  queryClient: QueryClient;
  version: SystemVersionResponse;
}

export function hydrateSystemVersionCache(
  args: HydrateSystemVersionCacheArgs,
): void {
  args.queryClient.setQueryData(systemVersionQueryKey(), args.version);
}
