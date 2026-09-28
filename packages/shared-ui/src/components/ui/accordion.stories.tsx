import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Accordion",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Single, collapsible">
        <Accordion type="single" collapsible className="w-80">
          <AccordionItem value="item-1">
            <AccordionTrigger>What triggers a rebuild?</AccordionTrigger>
            <AccordionContent>
              Any change under packages/shared-ui/src or apps/app/src/components/ui — the Turbo task's
              inputs list covers both.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>Where do stories live?</AccordionTrigger>
            <AccordionContent>
              Co-located with each component's own source file, as `&lt;name&gt;.stories.tsx`.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </StoryRow>
    </StoryCard>
  );
}
