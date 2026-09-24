import { useQueryClient } from "@tanstack/react-query";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { appToast } from "@/components/ui/app-toast";
import {
  applyPluginSafeMode,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  setPluginSafeMode,
  usePluginSafeMode,
} from "@/hooks/queries/plugin-settings-queries";

export function usePluginSafeModeCommands(): void {
  const queryClient = useQueryClient();
  const safeMode = usePluginSafeMode().data;

  function run(enabled: boolean): boolean {
    void setPluginSafeMode(fetch, enabled)
      .then(
        (active) => {
          applyPluginSafeMode({ queryClient, enabled: active });
          appToast.success(
            active ? "Plugin safe mode is on" : "Plugin safe mode is off",
            {
              description: active
                ? "Only built-in plugins are running."
                : "Your enabled plugins are running again.",
            },
          );
        },
        (error: unknown) => {
          appToast.error(
            enabled
              ? "Failed to turn on plugin safe mode"
              : "Failed to turn off plugin safe mode",
            {
              description:
                error instanceof Error ? error.message : String(error),
            },
          );
        },
      )
      .finally(() => invalidatePluginList({ queryClient }));
    return true;
  }

  useAppCommandHandler(
    "plugins.enterSafeMode",
    () => run(true),
    0,
    safeMode === false,
  );
  useAppCommandHandler(
    "plugins.exitSafeMode",
    () => run(false),
    0,
    safeMode === true,
  );
}
