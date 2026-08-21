import type { Host } from "@bb/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  hostQueryKey,
  hostsQueryKey,
  allSystemExecutionOptionsQueryKeyPrefix,
  allProjectDefaultExecutionOptionsQueryKeyPrefix,
} from "@/lib/query/query-keys";
import {
  updateHostPermissionCeiling,
  type UpdateHostPermissionCeilingRequest,
} from "./permission-ceiling";

interface RenameHostRequest {
  hostId: string;
  name: string;
}

/** Rename a machine; errors render inline in the caller's sheet. */
export function useRenameHost() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: ({ hostId, name }: RenameHostRequest) =>
      sdk.hosts.update({ hostId, name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hostsQueryKey() });
    },
  });
}

/**
 * Remove (revoke + tombstone) a machine (`DELETE /hosts/:id`). The server
 * refuses the primary host; errors render inline in the confirmation.
 */
export function useRemoveHost() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: async (hostId: string) => {
      await sdk.hosts.delete({ hostId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hostsQueryKey() });
    },
  });
}

/** Ask an older daemon to bypass its self-update backoff (`POST /hosts/:id/retry-update`). */
export function useRetryHostUpdate() {
  const { sdk } = useProfileClient();
  return useMutation({
    meta: { errorMessage: "Failed to request the update retry." },
    mutationFn: (hostId: string) => sdk.hosts.retryUpdate({ hostId }),
  });
}

/** Set a machine's permission ceiling; the host list refetches on success. */
export function useUpdateHostPermissionCeiling() {
  const client = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to change the permission limit." },
    mutationFn: (request: UpdateHostPermissionCeilingRequest) =>
      updateHostPermissionCeiling(client, request),
    onSuccess: (host) => {
      queryClient.setQueryData<Host[]>(hostsQueryKey(), (hosts) =>
        hosts?.map((entry) => (entry.id === host.id ? host : entry)),
      );
      queryClient.setQueryData(hostQueryKey(host.id), host);
      void queryClient.invalidateQueries({ queryKey: hostsQueryKey() });
      // The ceiling caps every picker routed through this machine.
      void queryClient.invalidateQueries({
        queryKey: allSystemExecutionOptionsQueryKeyPrefix(),
      });
      void queryClient.invalidateQueries({
        queryKey: allProjectDefaultExecutionOptionsQueryKeyPrefix(),
      });
    },
  });
}
