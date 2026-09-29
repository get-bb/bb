import { Progress } from "./progress.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Progress",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Build progress, in progress"
        hint="vburojevic/bb-plugin-xcode:app/ActivityRow.tsx — value only; that repo's indeterminate/indicatorClassName aren't in this Progress"
      >
        <Progress value={62} aria-label="Building Almanac — 62% of a typical run" className="w-64" />
      </StoryRow>
      <StoryRow label="Near complete">
        <Progress value={99} aria-label="Building Almanac — 99% of a typical run" className="w-64" />
      </StoryRow>
    </StoryCard>
  );
}
