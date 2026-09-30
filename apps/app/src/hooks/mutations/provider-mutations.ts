import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { applyProviderAvailabilityChange } from "../cache-owners/system-cache-effects";

export function useSetProviderEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Could not change provider availability." },
    mutationFn: (args: { providerId: string; enabled: boolean }) =>
      sdk.providers.setEnabled(args),
    onSuccess: (catalog) =>
      applyProviderAvailabilityChange({ queryClient, catalog }),
  });
}
