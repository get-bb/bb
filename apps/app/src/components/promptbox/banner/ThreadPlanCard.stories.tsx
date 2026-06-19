import { useState } from "react";
import type { ThreadTimelinePendingPlan } from "@bb/domain";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { ThreadPlanCard } from "./ThreadPlanCard";

export default {
  title: "promptbox/banner/Plan Card",
};

function Stage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

const activePlan: ThreadTimelinePendingPlan = {
  sourceSeq: 24,
  updatedAt: 0,
  explanation: "Validate the provider event shape before changing the UI.",
  steps: [
    {
      id: "plan:1",
      text: "Confirm Codex plan events are structured plan snapshots",
      status: "completed",
    },
    {
      id: "plan:2",
      text: "Split plan snapshots from task snapshots",
      status: "active",
    },
    {
      id: "plan:3",
      text: "Render structured tasks only in the task card",
      status: "pending",
    },
  ],
};

const failedStepPlan: ThreadTimelinePendingPlan = {
  sourceSeq: 31,
  updatedAt: 0,
  explanation: null,
  steps: [
    {
      id: "plan:failed:1",
      text: "Read current timeline projection",
      status: "completed",
    },
    {
      id: "plan:failed:2",
      text: "Parse freeform plan prose into tasks",
      status: "failed",
    },
    {
      id: "plan:failed:3",
      text: "Use only structured provider snapshots",
      status: "active",
    },
  ],
};

function ToggleablePlanCard({
  pendingPlan,
  initiallyExpanded = false,
}: {
  pendingPlan: ThreadTimelinePendingPlan;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <ThreadPlanCard
      pendingPlan={pendingPlan}
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
          5.5 High
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
        hint="collapsed card shows structured plan progress above the composer"
      >
        <Stage>
          <div className="flex flex-col gap-2">
            <ToggleablePlanCard pendingPlan={activePlan} />
            <FauxComposer />
          </div>
        </Stage>
      </StoryRow>
      <StoryRow label="expanded" hint="steps keep provider plan statuses">
        <Stage>
          <ToggleablePlanCard pendingPlan={activePlan} initiallyExpanded />
        </Stage>
      </StoryRow>
      <StoryRow label="failed step" hint="failed plan steps stay visible">
        <Stage>
          <ToggleablePlanCard pendingPlan={failedStepPlan} initiallyExpanded />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}
