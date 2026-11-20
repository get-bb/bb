import {
  usePluginSlotKind,
  type PluginHomepageSectionSlot,
} from "@/lib/plugin-slots";
import { getPluginHomepageSectionAnchor } from "@/lib/plugin-homepage-section";
import { PluginSlotMount } from "./PluginSlotMount";

export function PluginHomepageSections({
  projectId,
}: {
  projectId: string | null;
}) {
  const homepageSections = usePluginSlotKind("homepageSections");
  if (homepageSections.length === 0) return null;
  return (
    <PluginHomepageSectionList
      projectId={projectId}
      sections={homepageSections}
    />
  );
}

function PluginHomepageSectionList({
  projectId,
  sections,
}: {
  projectId: string | null;
  sections: readonly PluginHomepageSectionSlot[];
}) {
  return (
    <div className="mt-6 space-y-6" data-testid="plugin-homepage-sections">
      {sections.map((section) => (
        <section
          key={`${section.pluginId}/${section.id}/${section.generation}`}
          id={getPluginHomepageSectionAnchor(section.pluginId, section.id)}
          className="space-y-3"
        >
          <h2 className="text-sm font-semibold text-foreground">
            {section.title}
          </h2>
          <PluginSlotMount
            pluginId={section.pluginId}
            slotKind="homepageSection"
            slotId={section.id}
          >
            <section.component projectId={projectId} />
          </PluginSlotMount>
        </section>
      ))}
    </div>
  );
}
