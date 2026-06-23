import type { ThreadContextWindowUsage } from "@bb/server-contract";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { ThreadContextWindowIndicator } from "./ThreadContextWindowIndicator";

export default {
  title: "thread/timeline/Context window indicator",
};

const WINDOW = 200_000;

function usage(
  usedTokens: number,
  estimated = false,
): ThreadContextWindowUsage {
  return { usedTokens, modelContextWindow: WINDOW, estimated };
}

// Tone thresholds (shared by the ring stroke and the menu bar/percentage):
//   < 75%  → muted, 75–89% → warning, ≥ 90% → destructive.
const low = usage(36_000); // 18% — muted
const moderate = usage(110_000); // 55% — muted
const approachingLimit = usage(166_000); // 83% — warning
const critical = usage(192_000); // 96% — destructive
const estimated = usage(150_000, true); // 75% — warning, "Estimated" label

// The ring trigger across fill levels. Hover any ring to open the usage menu
// (see the `UsageMenu` stories for the menu rendered open).
export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Low (18%)" hint="muted ring — hover for the usage menu">
        <ThreadContextWindowIndicator usage={low} />
      </StoryRow>
      <StoryRow label="Moderate (55%)" hint="muted ring">
        <ThreadContextWindowIndicator usage={moderate} />
      </StoryRow>
      <StoryRow label="Approaching limit (83%)" hint="warning tone">
        <ThreadContextWindowIndicator usage={approachingLimit} />
      </StoryRow>
      <StoryRow label="Critical (96%)" hint="destructive tone">
        <ThreadContextWindowIndicator usage={critical} />
      </StoryRow>
      <StoryRow
        label="Estimated (75%)"
        hint='menu label reads "Estimated context"'
      >
        <ThreadContextWindowIndicator usage={estimated} />
      </StoryRow>
    </StoryCard>
  );
}

// The usage menu opened (normally hover-triggered): a labeled header, a tone-
// colored usage bar, and the token / remaining line. Bottom-aligned with room
// above because the popover anchors to the top of the trigger.
function MenuStage({ usage: u }: { usage: ThreadContextWindowUsage }) {
  return (
    <div className="flex min-h-[220px] items-end justify-center p-10">
      <ThreadContextWindowIndicator usage={u} defaultOpen />
    </div>
  );
}

export function UsageMenu() {
  return <MenuStage usage={approachingLimit} />;
}

export function UsageMenuCritical() {
  return <MenuStage usage={critical} />;
}

export function UsageMenuEstimated() {
  return <MenuStage usage={estimated} />;
}
