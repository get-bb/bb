import { useQueryClient } from "@tanstack/react-query";
import { appToast } from "@/components/ui/app-toast";
import { applyPluginUpdateJob } from "@/hooks/cache-owners/plugin-cache-owner";
import { startPluginUpdate } from "@/hooks/queries/plugin-update-job-queries";
import type { UpdateInventoryPlugins } from "@/hooks/useUpdateInventory";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";

export function useStartPluginUpdates(
  plugins: UpdateInventoryPlugins | null,
): (pluginIds: readonly string[]) => void {
  const queryClient = useQueryClient();
  return (pluginIds) => {
    for (const pluginId of pluginIds) {
      const item = plugins?.items.find(
        (candidate) => candidate.plugin.id === pluginId,
      );
      const name =
        item === undefined ? pluginId : (item.plugin.name ?? item.plugin.id);
      void startPluginUpdate(pluginId).then(
        (job) => applyPluginUpdateJob({ queryClient, job }),
        (error: unknown) => {
          appToast.error("Plugin update failed", {
            description: `${name} — ${pluginAdminErrorMessage(error)}`,
          });
        },
      );
    }
  };
}
