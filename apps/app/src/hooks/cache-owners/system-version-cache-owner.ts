import type { QueryClient } from "@tanstack/react-query";
import type { SystemVersionResponse } from "@bb/server-contract";
import { systemVersionQueryKey } from "../queries/query-keys";

interface HydrateSystemVersionCacheArgs {
  queryClient: QueryClient;
  version: SystemVersionResponse;
}

export function hydrateSystemVersionCache(
  args: HydrateSystemVersionCacheArgs,
): void {
  args.queryClient.setQueryData(systemVersionQueryKey(), args.version);
}

/**
 * Re-check the running version against the registry. The cached answer is held
 * for an hour and never refetched on focus, so without this a self-update — the
 * one event that always makes it wrong — would leave "update available" showing
 * on the running app until the tab reloads.
 */
export function invalidateSystemVersion(args: {
  queryClient: QueryClient;
}): void {
  void args.queryClient.invalidateQueries({ queryKey: systemVersionQueryKey() });
}
