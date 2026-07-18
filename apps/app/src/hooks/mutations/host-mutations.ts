import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { invalidateHostListQueries } from "../cache-owners/mutation-cache-effects";

interface RenameHostRequest {
  hostId: string;
  name: string;
}

/** Renames a machine. Errors render inline in the rename dialog. */
export function useRenameHost() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      showErrorToast: false,
    },
    mutationFn: ({ hostId, name }: RenameHostRequest) =>
      sdk.hosts.update({ hostId, name }),
    onSuccess: () => {
      invalidateHostListQueries({ queryClient });
    },
  });
}

/**
 * Removes (revokes + tombstones) a machine. Errors render inline in the
 * confirmation dialog — the server refuses to remove the primary host — so
 * the global error toast is suppressed.
 */
export function useRemoveHost() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      showErrorToast: false,
    },
    mutationFn: async (hostId: string) => {
      await sdk.hosts.delete({ hostId });
    },
    onSuccess: () => {
      invalidateHostListQueries({ queryClient });
    },
  });
}

/** Requests that an older daemon bypass its current self-update backoff. */
export function useRetryHostUpdate() {
  return useMutation({
    mutationFn: (hostId: string) => sdk.hosts.retryUpdate({ hostId }),
  });
}
