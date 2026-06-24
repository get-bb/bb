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

// The popover anchors to the top of the ring, so bottom-align the trigger and
// leave headroom above for the open menu.
function OpenMenuRow({
  label,
  hint,
  usage: u,
}: {
  label: string;
  hint: string;
  usage: ThreadContextWindowUsage;
}) {
  return (
    <StoryRow label={label} hint={hint}>
      <div className="flex min-h-[200px] items-end justify-center p-10">
        <ThreadContextWindowIndicator usage={u} defaultOpen />
      </div>
    </StoryRow>
  );
}

// Everything in one place: the ring trigger across fill levels (hover any to
// open its menu), then the usage menu rendered open at each tone.
export function Overview() {
  return (
    <>
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
      <StoryCard>
        <OpenMenuRow
          label="Usage menu — approaching (83%)"
          hint="warning tone — labeled header, usage bar, tokens / % left"
          usage={approachingLimit}
        />
        <OpenMenuRow
          label="Usage menu — critical (96%)"
          hint="destructive tone"
          usage={critical}
        />
        <OpenMenuRow
          label="Usage menu — estimated (75%)"
          hint='header reads "Estimated context"'
          usage={estimated}
        />
      </StoryCard>
    </>
  );
}
