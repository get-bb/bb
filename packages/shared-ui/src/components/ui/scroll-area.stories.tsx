import { ScrollArea } from "./scroll-area.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/ScrollArea",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Fixed-height scrollable list">
        <ScrollArea className="h-40 w-64 rounded-md border border-border p-3">
          <ul className="space-y-2 text-sm">
            {Array.from({ length: 20 }, (_, index) => (
              <li key={index}>Row {index + 1}</li>
            ))}
          </ul>
        </ScrollArea>
      </StoryRow>
    </StoryCard>
  );
}
