import type { QueryClient } from "@tanstack/react-query";
import { hostProviderCliStatusQueryKey } from "../queries/query-keys";

interface InvalidateHostProviderCliStatusArgs {
  queryClient: QueryClient;
  hostId: string;
}

/** Re-fetch a host's provider CLI health after an install/update or a manual check. */
export function invalidateHostProviderCliStatus(
  args: InvalidateHostProviderCliStatusArgs,
): Promise<void> {
  return args.queryClient.invalidateQueries({
    queryKey: hostProviderCliStatusQueryKey(args.hostId),
  });
}
