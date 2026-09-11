import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import {
  pluginIsLocalSource,
  pluginRemovalDescription,
  pluginRemovalLabel,
} from "@/components/tools/PluginDetail";
import { pluginToast } from "@/components/plugin/PluginNotificationDescription";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import {
  invalidatePluginCatalogSearch,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  removePlugin,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";

export function usePluginRemoval() {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<PluginListItem | null>(null);
  const mutation = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (plugin: PluginListItem) => {
      if (
        plugin.provenance === "builtin" ||
        plugin.source.startsWith("builtin:")
      ) {
        throw new Error("Included plugins cannot be uninstalled.");
      }
      return removePlugin(fetch, plugin.id);
    },
    onSuccess: (_data, plugin) => {
      pluginToast.success(
        pluginIsLocalSource(plugin)
          ? "Plugin removed from bb"
          : "Plugin uninstalled",
        plugin,
        "catalog",
      );
      setTarget(null);
      invalidatePluginCatalogSearch({ queryClient });
      return invalidatePluginList({ queryClient });
    },
    onError: (error, plugin) => {
      pluginToast.error(
        pluginIsLocalSource(plugin)
          ? "Plugin removal failed"
          : "Plugin uninstall failed",
        plugin,
        "installed",
        pluginAdminErrorMessage(error),
      );
    },
  });

  return {
    target,
    pending: mutation.isPending,
    pendingPluginId: mutation.isPending ? mutation.variables.id : null,
    open: (plugin: PluginListItem) => {
      if (
        plugin.provenance !== "builtin" &&
        !plugin.source.startsWith("builtin:")
      )
        setTarget(plugin);
    },
    close: () => {
      if (!mutation.isPending) setTarget(null);
    },
    confirm: () => {
      if (target !== null && !mutation.isPending) mutation.mutate(target);
    },
  };
}

interface PluginRemovalDialogProps {
  removal: ReturnType<typeof usePluginRemoval>;
}

export function PluginRemovalDialog({ removal }: PluginRemovalDialogProps) {
  return (
    <ConfirmDeleteDialog
      open={removal.target !== null}
      onOpenChange={(open) => {
        if (!open) removal.close();
      }}
    >
      {removal.target !== null ? (
        <ConfirmDeleteDialogContent
          title={
            pluginIsLocalSource(removal.target)
              ? "Remove plugin from bb?"
              : "Uninstall plugin?"
          }
          description={pluginRemovalDescription(removal.target)}
          confirmLabel={pluginRemovalLabel(removal.target)}
          pending={removal.pending}
          onConfirm={removal.confirm}
          onCancel={removal.close}
        />
      ) : null}
    </ConfirmDeleteDialog>
  );
}
