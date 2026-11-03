import {
  usePluginSlots,
  type PluginSettingsSectionSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

export function PluginSettingsSections({
  pluginId,
  onSetupStarted,
}: {
  pluginId: string;
  onSetupStarted?: () => void;
}) {
  const { settingsSections } = usePluginSlots();
  const sections = settingsSections.filter(
    (section) =>
      section.pluginId === pluginId && section.experimental_page === undefined,
  );
  if (sections.length === 0) return null;
  return (
    <PluginSettingsSectionList
      sections={sections}
      onSetupStarted={onSetupStarted}
    />
  );
}

export function PluginMobileSettingsSections({
  pluginId,
}: {
  pluginId: string | null;
}) {
  const { settingsSections } = usePluginSlots();
  const sections = settingsSections.filter(
    (section) =>
      section.experimental_page === "mobile" && section.pluginId === pluginId,
  );
  if (sections.length === 0) return null;
  return <PluginSettingsSectionList sections={sections} />;
}

function PluginSettingsSectionList({
  sections,
  onSetupStarted,
}: {
  sections: readonly PluginSettingsSectionSlot[];
  onSetupStarted?: (() => void) | undefined;
}) {
  return (
    <div className="space-y-6" data-testid="plugin-settings-sections">
      {sections.map((section) => {
        const key = `${section.pluginId}/${section.id}/${section.generation}`;
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
            <PluginSlotMount
              pluginId={section.pluginId}
              slotKind="settingsSection"
              slotId={section.id}
            >
              <section.component
                {...(onSetupStarted === undefined
                  ? {}
                  : { internal_DO_NOT_USE_onSetupStarted: onSetupStarted })}
              />
            </PluginSlotMount>
          </div>
        );
      })}
    </div>
  );
}
