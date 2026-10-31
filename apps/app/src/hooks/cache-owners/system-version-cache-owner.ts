import type { QueryClient } from "@tanstack/react-query";
import type { SystemVersionResponse } from "@bb/server-contract";
import { systemVersionQueryKey } from "../queries/query-keys";
import { setQueryDataOverInFlightFetch } from "./cache-effect-utils";

interface HydrateSystemVersionCacheArgs {
  queryClient: QueryClient;
  version: SystemVersionResponse;
}

export function hydrateSystemVersionCache(
  args: HydrateSystemVersionCacheArgs,
): void {
  setQueryDataOverInFlightFetch<SystemVersionResponse>(
    args.queryClient,
    systemVersionQueryKey(),
    args.version,
  );
}

export function invalidateSystemVersion(args: {
  queryClient: QueryClient;
}): void {
  void args.queryClient.invalidateQueries({
    queryKey: systemVersionQueryKey(),
  });
}
