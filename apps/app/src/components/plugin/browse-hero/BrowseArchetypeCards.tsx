import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { ShowcaseExampleCard } from "@/components/showcase-hero/ShowcaseArchetypeCards";
import {
  BROWSE_ARCHETYPES,
  UTILITY_EXAMPLES,
  archetypePrompt,
  utilityPrompt,
} from "./browse-hero-archetypes";

/**
 * The examples shown while the composer is open: the same two tiers, one card
 * shape, one source. Use-case ideas keep their accent chips; the capability
 * tier goes neutral under its own label so the two audiences stay legible
 * without a second layout.
 *
 * Every card seeds the inline composer through `onCreate`; nothing here
 * navigates away from the page.
 */
export function BrowseArchetypeCards({
  onCreate,
  className,
}: {
  /** Receives the full composer prompt for the chosen example. */
  onCreate: (prompt: string) => void;
  className?: string;
}) {
  return (
    // Tooltip context is provided per-surface in this app (see PluginDetail);
    // the utility tier's cards carry their full seeded prompt as tooltips.
    <TooltipProvider delayDuration={250}>
      <section className={className}>
        <h3 className="text-xs font-medium text-subtle-foreground">
          Start from an example
        </h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {BROWSE_ARCHETYPES.map((archetype) => (
            <ShowcaseExampleCard
              key={archetype.id}
              icon={archetype.icon}
              title={archetype.title}
              description={archetype.hook}
              accentToken={archetype.accentToken}
              onClick={() => onCreate(archetypePrompt(archetype))}
            />
          ))}
        </div>
        <h4 className="mt-5 text-2xs font-medium text-subtle-foreground">
          Explore plugin capabilities
        </h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {UTILITY_EXAMPLES.map((example) => (
            <ShowcaseExampleCard
              key={example.id}
              icon={example.icon}
              title={example.label}
              description={example.brief}
              tooltip={utilityPrompt(example)}
              onClick={() => onCreate(utilityPrompt(example))}
            />
          ))}
        </div>
      </section>
    </TooltipProvider>
  );
}
