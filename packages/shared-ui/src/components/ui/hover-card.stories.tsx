import { useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card.js";
import { Button } from "./button.js";
import { Badge } from "./badge.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/HoverCard",
};

function ThemeHoverCardDemo() {
  const [open, setOpen] = useState(false);
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        <Button variant="outline" size="sm" onClick={() => setOpen((current) => !current)}>
          Hover card
        </Button>
      </HoverCardTrigger>
      <HoverCardContent align="start" sideOffset={6} className="w-60 space-y-2 p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Endless theme family</span>
          <Badge variant="secondary">Running</Badge>
        </div>
        <p className="font-mono text-xs text-muted-foreground">bb/endless-theme</p>
        <p className="text-xs text-muted-foreground">
          Sidebar reads true black with the orange seam; blue selection at .20.
        </p>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="h-7 flex-1 px-2 text-xs">
            Copy branch
          </Button>
          <Button size="sm" className="h-7 flex-1 px-2 text-xs">
            Open in split
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Branch preview card"
        hint="plugins/theme-preview/app.tsx — its own overlay-gallery demo; ported with shared-ui Badge/Icon, not the plugin's local helpers"
      >
        <ThemeHoverCardDemo />
      </StoryRow>
    </StoryCard>
  );
}
