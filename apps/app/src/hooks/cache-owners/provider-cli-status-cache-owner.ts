import type { QueryClient } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { hostProviderCliStatusQueryKey } from "../queries/query-keys";

interface HostProviderCliStatusCacheArgs {
  queryClient: QueryClient;
  hostId: string;
}

export function invalidateHostProviderCliStatus(
  args: HostProviderCliStatusCacheArgs,
): Promise<void> {
  return args.queryClient.invalidateQueries({
    queryKey: hostProviderCliStatusQueryKey(args.hostId),
  });
}

export async function refreshHostProviderCliStatus(
  args: HostProviderCliStatusCacheArgs,
): Promise<void> {
  const queryKey = hostProviderCliStatusQueryKey(args.hostId);
  await args.queryClient.cancelQueries({ queryKey, exact: true });
  await args.queryClient.prefetchQuery({
    queryKey,
    queryFn: ({ signal }) =>
      sdk.hosts.providerCliStatus({
        hostId: args.hostId,
        refresh: true,
        signal,
      }),
    staleTime: 0,
  });
}
