import { useMemo } from "react";
import {
  applyAppKeybindingOverrides,
  pluginCommandId,
  type AppDefaultKeybindings,
  type AppKeybindingOverrides,
} from "@bb/domain";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useBuiltinPluginIds, usePluginSlotKind } from "@/lib/plugin-slots";
import { browserPlatform } from "@/lib/app-keybindings";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { resolvePluginCommandDefaults } from "@/lib/plugin-command-keybindings";

const EMPTY_DEFAULTS: AppDefaultKeybindings = [];
const EMPTY_OVERRIDES: AppKeybindingOverrides = [];

export function usePluginCommandBindings() {
  const { data } = useSystemConfig();
  const commandPaletteActions = usePluginSlotKind("commandPaletteActions");
  const builtinPluginIds = useBuiltinPluginIds();
  const builtInDefaults = data?.defaultKeybindings ?? EMPTY_DEFAULTS;
  const overrides = data?.keybindingOverrides ?? EMPTY_OVERRIDES;
  const isDesktop = getBbDesktopInfo() !== null;
  const platform = browserPlatform();
  return useMemo(() => {
    const pluginDefaults: AppDefaultKeybindings = commandPaletteActions.map(
      (command) => ({
        command: pluginCommandId(command.pluginId, command.id),
        desktopOnly: false,
        shortcut: command.defaultShortcut,
        when:
          command.target === "composer"
            ? {
                all: ["mainSurface", "promptAvailable"],
                none: ["modalOpen", "terminalFocus", "browserFocus"],
              }
            : command.experimental_keyScope === "pluginPage"
              ? {
                  all: ["mainSurface", "pluginPage"],
                  none: ["modalOpen", "editableFocus"],
                }
              : { all: ["mainSurface"], none: ["modalOpen"] },
      }),
    );
    const bundledCommands = new Set(
      commandPaletteActions
        .filter((command) => builtinPluginIds.has(command.pluginId))
        .map((command) => pluginCommandId(command.pluginId, command.id)),
    );
    const resolved = resolvePluginCommandDefaults(
      [...builtInDefaults, ...pluginDefaults],
      overrides,
      isDesktop,
      platform,
      bundledCommands,
    );
    const pluginIds = new Set(pluginDefaults.map((binding) => binding.command));
    return {
      ...resolved,
      commands: commandPaletteActions,
      keybindings: [
        ...(data?.keybindings ?? []),
        ...applyAppKeybindingOverrides(
          resolved.defaults.filter((binding) => pluginIds.has(binding.command)),
          overrides,
        ),
      ],
    };
  }, [
    builtInDefaults,
    builtinPluginIds,
    commandPaletteActions,
    data?.keybindings,
    isDesktop,
    overrides,
    platform,
  ]);
}
