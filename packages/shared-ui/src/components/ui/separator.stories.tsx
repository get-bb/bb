import { Separator } from "./separator.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Separator",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Section divider"
        hint="vburojevic/bb-plugin-handoff:app.tsx — ahead of a 'Recent handoffs' history list"
      >
        <div className="w-72">
          <Separator className="mb-3" />
          <p className="mb-1 text-sm font-medium">Recent handoffs</p>
          <p className="text-xs text-muted-foreground">2 handoffs of this thread</p>
        </div>
      </StoryRow>
      <StoryRow label="Vertical, between two inline actions">
        <div className="flex h-5 items-center gap-2 text-sm">
          <span>Rename</span>
          <Separator orientation="vertical" />
          <span>Archive</span>
        </div>
      </StoryRow>
    </StoryCard>
  );
}
