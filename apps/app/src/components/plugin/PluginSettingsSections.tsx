import {
  usePluginSlots,
  type PluginSettingsSectionSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

/**
 * Plugin `settingsSection` slot mounts, rendered on that plugin's
 * Settings -> Plugins detail page below the host-rendered declarative form.
 * Each section is contained in its own per-plugin error boundary.
 */
export function PluginSettingsSections({ pluginId }: { pluginId: string }) {
  const { settingsSections } = usePluginSlots();
  const sections = settingsSections.filter(
    (section) => section.pluginId === pluginId,
  );
  if (sections.length === 0) return null;
  return <PluginSettingsSectionList sections={sections} />;
}

function PluginSettingsSectionList({
  sections,
}: {
  sections: readonly PluginSettingsSectionSlot[];
}) {
  return (
    <div className="space-y-6" data-testid="plugin-settings-sections">
      {sections.map((section) => (
        <section
          key={`${section.pluginId}/${section.id}/${section.generation}`}
          className="space-y-3"
        >
          {section.title !== undefined ? (
            // Built-in SettingsSection header idiom (title + optional
            // description) above the card, so a plugin section reads native.
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {section.title}
              </h2>
              {section.description !== undefined ? (
                <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                  {section.description}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="rounded-lg border border-border bg-card px-4 py-3.5">
            <PluginSlotMount
              pluginId={section.pluginId}
              slotKind="settingsSection"
              slotId={section.id}
            >
              <section.component />
            </PluginSlotMount>
          </div>
        </section>
      ))}
    </div>
  );
}
