import {
  usePluginSlots,
  type PluginSettingsSectionSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";
import { ResourceDetailPanel } from "@bb/shared-ui/resource-detail";

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
      {sections.map((section) => {
        const key = `${section.pluginId}/${section.id}/${section.generation}`;
        if (section.experimental_surface === "flat") {
          return (
            <div key={key} className="space-y-3">
              {section.title === undefined ? null : (
                <h3 className="text-xs font-medium text-foreground">
                  {section.title}
                </h3>
              )}
              {section.description === undefined ? null : (
                <p className="text-xs leading-snug text-subtle-foreground/75">
                  {section.description}
                </p>
              )}
              <PluginSettingsSectionMount section={section} />
            </div>
          );
        }
        return section.title === undefined ? (
          <PluginSettingsSectionPanel key={key} section={section} />
        ) : (
          <div key={key} className="space-y-3">
            <h3 className="text-xs font-medium text-foreground">
              {section.title}
            </h3>
            <PluginSettingsSectionPanel section={section} />
          </div>
        );
      })}
    </div>
  );
}

function PluginSettingsSectionPanel({
  section,
}: {
  section: PluginSettingsSectionSlot;
}) {
  return (
    <ResourceDetailPanel surface="recessed" className="px-3 py-3">
      {section.description !== undefined ? (
        <p className="mb-3 text-xs leading-snug text-subtle-foreground/75">
          {section.description}
        </p>
      ) : null}
      <PluginSettingsSectionMount section={section} />
    </ResourceDetailPanel>
  );
}

function PluginSettingsSectionMount({
  section,
}: {
  section: PluginSettingsSectionSlot;
}) {
  return (
    <PluginSlotMount
      pluginId={section.pluginId}
      slotKind="settingsSection"
      slotId={section.id}
    >
      <section.component />
    </PluginSlotMount>
  );
}
