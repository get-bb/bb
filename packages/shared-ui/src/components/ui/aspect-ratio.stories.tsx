import { AspectRatio } from "./aspect-ratio.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/AspectRatio",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="16:9, placeholder content">
        <AspectRatio ratio={16 / 9} className="w-64 overflow-hidden rounded-md bg-muted">
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            16:9
          </div>
        </AspectRatio>
      </StoryRow>
    </StoryCard>
  );
}
