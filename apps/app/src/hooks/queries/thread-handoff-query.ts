import { useQuery } from "@tanstack/react-query";
import type { ThreadHandoffStatus } from "@bb/server-contract";
import { BbHttpError, sdk } from "@/lib/sdk";
import { threadHandoffQueryKey } from "./query-keys";

const HANDOFF_STATUS_POLL_INTERVAL_MS = 1000;

export function useThreadHandoffStatus(
  replacementThreadId: string,
  options?: { enabled?: boolean },
) {
  const enabled = (options?.enabled ?? true) && replacementThreadId.length > 0;

  return useQuery<ThreadHandoffStatus | null>({
    queryKey: threadHandoffQueryKey(replacementThreadId),
    queryFn: async ({ signal }) => {
      try {
        return await sdk.threads.handoffStatus({
          replacementThreadId,
          signal,
        });
      } catch (error) {
        if (error instanceof BbHttpError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    enabled,
    refetchInterval: (query) =>
      query.state.data?.state === "provisioning"
        ? HANDOFF_STATUS_POLL_INTERVAL_MS
        : false,
  });
}
