import { useState } from "react";
import type { ThreadTimelinePendingTodos } from "@bb/domain";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { ThreadPlanCard } from "./ThreadPlanCard";

export default {
  title: "promptbox/banner/ThreadPlanCard",
};

function Stage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

const activePlan: ThreadTimelinePendingTodos = {
  sourceSeq: 12,
  updatedAt: Date.now() - 71_000,
  items: [
    {
      id: "plan:done",
      text: "Inspect the existing prompt-stack cards and timeline plan data",
      status: "completed",
    },
    {
      id: "plan:active",
      text: "Render active plans as a compact card above the composer",
      status: "in_progress",
    },
    {
      id: "plan:pending-1",
      text: "Keep git, parent, and child-thread context in the existing banner",
      status: "pending",
    },
    {
      id: "plan:pending-2",
      text: "Add tests and stories for the new card states",
      status: "pending",
    },
  ],
};

const longPlan: ThreadTimelinePendingTodos = {
  ...activePlan,
  items: [
    ...activePlan.items,
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `plan:extra-${index}`,
      text: `Follow-up implementation step ${index + 1} with enough copy to verify wrapping inside the plan card`,
      status: "pending" as const,
    })),
  ],
};

function FauxComposer() {
  return (
    <div className="rounded-lg border border-border bg-popover p-3">
      <div className="pb-3 text-sm text-subtle-foreground">
        Ask for a follow-up...
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
          5.5 High
        </span>
      </div>
    </div>
  );
}

function ToggleablePlan() {
  const [expanded, setExpanded] = useState(true);
  return (
    <ThreadPlanCard
      plan={activePlan}
      isExpanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
    />
  );
}

export function Overview() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <StoryCard>
      <StoryRow
        label="prompt stack"
        hint="active plan floats above the composer; click to collapse"
      >
        <Stage>
          <div className="flex flex-col gap-2">
            <ToggleablePlan />
            <FauxComposer />
          </div>
        </Stage>
      </StoryRow>
      <StoryRow label="collapsed" hint="single-line active plan glance">
        <Stage>
          <ThreadPlanCard
            plan={activePlan}
            isExpanded={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
          />
        </Stage>
      </StoryRow>
      <StoryRow label="long plan" hint="expanded body scrolls after several rows">
        <Stage>
          <ThreadPlanCard
            plan={longPlan}
            isExpanded={true}
            onToggle={() => {}}
          />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}
