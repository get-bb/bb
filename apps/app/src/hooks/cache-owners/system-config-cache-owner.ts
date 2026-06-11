import type { QueryClient } from "@tanstack/react-query";
import type { SystemConfigResponse } from "@bb/server-contract";
import { systemConfigQueryKey } from "../queries/query-keys";

export interface HydrateSystemConfigCacheArgs {
  config: SystemConfigResponse;
  queryClient: QueryClient;
}

export function hydrateSystemConfigCache(
  args: HydrateSystemConfigCacheArgs,
): void {
  args.queryClient.setQueryData(systemConfigQueryKey(), args.config);
}
