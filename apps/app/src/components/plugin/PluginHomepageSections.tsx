import {
  usePluginSlots,
  type PluginHomepageSectionSlot,
} from "@/lib/plugin-slots";
import { useRouteState } from "@/hooks/useRouteState";
import { getPluginHomepageSectionAnchor } from "@/lib/plugin-homepage-section";
import { PluginSlotMount } from "./PluginSlotMount";

export function PluginHomepageSections({
  setupComplete,
}: {
  setupComplete: boolean;
}) {
  const { homepageSections } = usePluginSlots();
  if (homepageSections.length === 0) return null;
  return (
    <PluginHomepageSectionList
      sections={homepageSections}
      setupComplete={setupComplete}
    />
  );
}

function PluginHomepageSectionList({
  sections,
  setupComplete,
}: {
  sections: readonly PluginHomepageSectionSlot[];
  setupComplete: boolean;
}) {
  const { projectId } = useRouteState();
  return (
    <div className="mt-6 space-y-6" data-testid="plugin-homepage-sections">
      {sections.map((section) => (
        <section
          key={`${section.pluginId}/${section.id}/${section.generation}`}
          id={getPluginHomepageSectionAnchor(section.pluginId, section.id)}
          className="space-y-3"
        >
          {section.title !== undefined ? (
            <h2 className="text-sm font-semibold text-foreground">
              {section.title}
            </h2>
          ) : null}
          <PluginSlotMount
            pluginId={section.pluginId}
            slotKind="homepageSection"
            slotId={section.id}
          >
            <section.component
              projectId={projectId ?? null}
              experimental_setupComplete={setupComplete}
            />
          </PluginSlotMount>
        </section>
      ))}
    </div>
  );
}
