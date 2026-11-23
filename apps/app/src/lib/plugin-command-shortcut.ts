import { pluginCommandId } from "@bb/domain";
import type { ExperimentalShortcutPresentation } from "@get-bb/plugin-sdk";
import { usePluginId } from "@/components/plugin/plugin-context";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";

export function useExperimentalCommandShortcut(
  commandId: string,
): ExperimentalShortcutPresentation | null {
  return useAppCommandShortcut(pluginCommandId(usePluginId(), commandId));
}
