import { useMutation, useQueryClient } from "@tanstack/react-query";
import { appToast } from "@/components/ui/app-toast";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { useSetPluginEnabled } from "./useSetPluginEnabled";

export function usePluginEnabledMutation(
  plugin: PluginListItem,
  onSettled?: () => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  const setEnabled = useSetPluginEnabled();
  const toggle = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (enabled: boolean) => setEnabled(plugin.id, enabled),
    onError: (error, enabled) => {
      appToast.error(
        `${enabled ? "Enabling" : "Disabling"} ${plugin.id} failed`,
        {
          description: error instanceof Error ? error.message : String(error),
        },
      );
    },
    onSettled: async () => {
      await invalidatePluginList({ queryClient });
      await onSettled?.();
    },
  });
  return {
    toggle,
    enabled: toggle.isPending ? toggle.variables : plugin.enabled,
  };
}
