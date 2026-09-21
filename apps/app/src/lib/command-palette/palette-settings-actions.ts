import {
  getSettingsSectionRoutePath,
  type SettingsNavSection,
} from "@/components/settings/settings-sections";
import {
  getPluginSettingsEntryRoutePath,
  type PluginSettingsEntry,
} from "@/components/settings/plugin-settings-entries";
import type { PaletteAction } from "./palette-action";

interface BuildSettingsPaletteActionsArgs {
  navigate: (path: string) => void;
  pluginEntries: readonly PluginSettingsEntry[];
  sections: readonly SettingsNavSection[];
}

export function buildSettingsPaletteActions(
  args: BuildSettingsPaletteActionsArgs,
): PaletteAction[] {
  return [
    ...args.sections.map((section) => ({
      id: `settings:${section.id}`,
      bucket: "Settings" as const,
      group: "Settings",
      title: `${section.label} settings`,
      shortcut: null,
      run: () => args.navigate(getSettingsSectionRoutePath(section.id)),
    })),
    ...args.pluginEntries.map((plugin) => ({
      id: `settings:plugin:${plugin.id}`,
      bucket: "Settings" as const,
      group: "Plugins",
      title: `${plugin.label} ${plugin.hasConfiguration ? "settings" : "details"}`,
      shortcut: null,
      run: () => args.navigate(getPluginSettingsEntryRoutePath(plugin)),
    })),
  ];
}
