import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import {
  systemProviderCatalogQueryKey,
  allSystemProvidersQueryKeyPrefix,
  allSystemExecutionOptionsQueryKeyPrefix,
  systemConfigQueryKey,
} from "../queries/query-keys";
import { invalidatePluginList } from "../cache-owners/plugin-cache-owner";

export function useSetProviderEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Could not change provider availability." },
    mutationFn: (args: { providerId: string; enabled: boolean }) =>
      sdk.providers.setEnabled(args),
    onSuccess: async (catalog) => {
      queryClient.setQueryData(systemProviderCatalogQueryKey(), catalog);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: allSystemProvidersQueryKeyPrefix(),
        }),
        queryClient.invalidateQueries({
          queryKey: allSystemExecutionOptionsQueryKeyPrefix(),
        }),
        queryClient.invalidateQueries({ queryKey: systemConfigQueryKey() }),
        invalidatePluginList({ queryClient }),
      ]);
    },
  });
}
