import {
  usePluginSlots,
  type PluginHomepageSectionSlot,
} from "@/lib/plugin-slots";
import { useRouteState } from "@/hooks/useRouteState";
import { PluginSlotMount } from "./PluginSlotMount";

/**
 * Plugin `homepageSection` slot mounts (plugin design §5.2), rendered under
 * the compose content on the root compose surface. Renders nothing while no
 * plugin contributes a section; each section is contained in its own
 * per-plugin error boundary. The route-derived props live in an inner
 * component so hosts without a Router (isolated tests/stories) can render
 * the empty state.
 */
export function PluginHomepageSections() {
  const { homepageSections } = usePluginSlots();
  if (homepageSections.length === 0) return null;
  return <PluginHomepageSectionList sections={homepageSections} />;
}

function PluginHomepageSectionList({
  sections,
}: {
  sections: readonly PluginHomepageSectionSlot[];
}) {
  const { projectId } = useRouteState();
  return (
    <div className="mt-6 space-y-6" data-testid="plugin-homepage-sections">
      {sections.map((section) => (
        <section
          // Generation in the key: a P3.4 reload remounts the slot (fresh
          // error-boundary state) instead of reusing a latched crash.
          key={`${section.pluginId}/${section.id}/${section.generation}`}
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
            <section.component projectId={projectId ?? null} />
          </PluginSlotMount>
        </section>
      ))}
    </div>
  );
}
