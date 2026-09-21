import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  SectionSidebarLabel,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import {
  getPluginSettingsEntryRoutePath,
  type PluginSettingsEntry,
} from "./plugin-settings-entries";

export function SettingsPluginsSection({
  activePluginId,
  pluginEntries,
}: {
  activePluginId: string | null;
  pluginEntries: readonly PluginSettingsEntry[];
}) {
  return (
    <>
      <div className="mt-4">
        <SectionSidebarLabel>Plugins</SectionSidebarLabel>
      </div>
      <div className="mt-1 space-y-0.5">
        {pluginEntries.map((entry) => (
          <SectionSidebarRow
            key={entry.id}
            active={activePluginId === entry.id}
            label={entry.label}
            to={getPluginSettingsEntryRoutePath(entry)}
          >
            <PluginIcon
              pluginId={entry.id}
              icon={entry.icon}
              className="size-4 shrink-0"
            />
          </SectionSidebarRow>
        ))}
      </div>
    </>
  );
}
