import { OptionDisplay } from "./option-display.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/OptionDisplay",
};

const CONTROL_CLASS_NAME = "h-6 max-w-40 px-1.5 text-xs";

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Loading"
        hint="apps/app/.../TerminalHostSelector.tsx — shown while the host list is still loading"
      >
        <OptionDisplay label="Machine" value="Loading…" className={CONTROL_CLASS_NAME} />
      </StoryRow>
      <StoryRow label="Empty">
        <OptionDisplay label="Machine" value="No machines" className={CONTROL_CLASS_NAME} />
      </StoryRow>
      <StoryRow
        label="Single option, non-interactive"
        hint="rendered instead of an interactive picker when there's exactly one machine to choose from"
      >
        <OptionDisplay label="Machine" value="dev-box-01" className={CONTROL_CLASS_NAME} />
      </StoryRow>
    </StoryCard>
  );
}
