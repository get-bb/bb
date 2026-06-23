import { useState } from "react";
import type { ThreadTimelineGoal } from "@bb/domain";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { ThreadGoalCard } from "./ThreadGoalCard";

export default {
  title: "promptbox/banner/Goal Card",
};

type StageSize = "desktop" | "mobile";

function Stage({
  children,
  size,
}: {
  children: React.ReactNode;
  size: StageSize;
}) {
  return (
    <div
      data-promptbox-shell=""
      className={
        size === "desktop" ? "min-w-0 flex-1" : "w-[20rem] shrink-0"
      }
    >
      {children}
    </div>
  );
}

function ResponsiveStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 overflow-x-auto">
      <Stage size="desktop">{children}</Stage>
      <Stage size="mobile">{children}</Stage>
    </div>
  );
}

const activeGoal: ThreadTimelineGoal = {
  sourceSeq: 42,
  updatedAt: Date.now() - 12_000,
  objective:
    "Ship the prompt context banner cleanup: keep active state segments first, compact metadata into icon-only controls, and preserve quick actions for single-segment states.",
  status: "active",
  tokenBudget: 80_000,
  tokensUsed: 27_450,
  timeUsedSeconds: 1_238,
};

const unboundedGoal: ThreadTimelineGoal = {
  ...activeGoal,
  sourceSeq: 43,
  objective:
    "Audit the composer stack and identify the smallest set of follow-up UI fixes needed before merging.",
  tokenBudget: null,
  tokensUsed: 9_820,
  timeUsedSeconds: 412,
};

function ToggleableGoalCard({
  goal,
  initiallyExpanded = false,
}: {
  goal: ThreadTimelineGoal;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <ThreadGoalCard
      goal={goal}
      isExpanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
    />
  );
}

function FauxComposer() {
  return (
    <div className="rounded-lg border border-border bg-popover p-3">
      <div className="pb-3 text-sm text-subtle-foreground">
        Reply to the agent...
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
          gpt-5.5
        </span>
      </div>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="prompt stack"
        hint="goal card above the composer; click to expand"
      >
        <ResponsiveStage>
          <div className="flex flex-col gap-2">
            <ToggleableGoalCard goal={activeGoal} />
            <FauxComposer />
          </div>
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="expanded"
        hint="full objective with token budget and elapsed time"
      >
        <ResponsiveStage>
          <ToggleableGoalCard goal={activeGoal} initiallyExpanded />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow label="no token budget" hint="unbounded goal usage summary">
        <ResponsiveStage>
          <ToggleableGoalCard goal={unboundedGoal} initiallyExpanded />
        </ResponsiveStage>
      </StoryRow>
    </StoryCard>
  );
}
