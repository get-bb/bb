import { Icon } from "./icon.js";
import { Toggle } from "./toggle.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Toggle",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Icon toggle, off">
        <Toggle aria-label="Toggle bold">
          <Icon name="Check" />
        </Toggle>
      </StoryRow>
      <StoryRow label="Icon toggle, on">
        <Toggle aria-label="Toggle bold" pressed>
          <Icon name="Check" />
        </Toggle>
      </StoryRow>
      <StoryRow label="Outline variant">
        <Toggle variant="outline" aria-label="Toggle bold">
          <Icon name="Check" />
        </Toggle>
      </StoryRow>
    </StoryCard>
  );
}
