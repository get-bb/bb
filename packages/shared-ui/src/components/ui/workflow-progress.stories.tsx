import { useState } from "react";
import {
  WorkflowPhaseStrip,
  WorkflowProgress,
  WorkflowStatusPill,
  type WorkflowProgressSnapshot,
} from "./workflow-progress.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/WorkflowProgress",
};

const SNAPSHOT: WorkflowProgressSnapshot = {
  phases: [
    { index: 1, title: "Research" },
    { index: 2, title: "Implement" },
    { index: 3, title: "Review" },
  ],
  agents: [
    {
      index: 1,
      label: "Survey call sites",
      state: "done",
      model: "claude-sonnet-5",
      attempt: 1,
      cached: false,
      lastProgressAt: Date.now() - 1000 * 60 * 8,
      phaseIndex: 1,
      metadata: ["anthropic", "sonnet-5", "medium"],
      tokens: 42000,
      toolCalls: 12,
      durationMs: 95000,
    },
    {
      index: 2,
      label: "Write implementation",
      state: "running",
      model: "claude-opus-5",
      attempt: 1,
      cached: false,
      lastProgressAt: Date.now() - 1000 * 20,
      phaseIndex: 2,
      metadata: ["anthropic", "opus-5", "high"],
      tokens: 18500,
      toolCalls: 6,
    },
    {
      index: 3,
      label: "Fix failing test",
      state: "failed",
      model: "claude-sonnet-5",
      attempt: 2,
      cached: false,
      lastProgressAt: Date.now() - 1000 * 60 * 2,
      phaseIndex: 3,
      error: "Test suite exited with code 1",
      metadata: ["anthropic", "sonnet-5", "medium"],
      durationMs: 31000,
    },
    {
      index: 4,
      label: "Other work",
      state: "queued",
      model: "claude-opus-5",
      attempt: 1,
      cached: false,
      lastProgressAt: Date.now(),
      phaseIndex: undefined,
      metadata: ["anthropic", "opus-5", "high"],
    },
  ],
};

function WorkflowRunCardDemo() {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="w-[420px] overflow-hidden rounded-lg border border-border bg-surface-recessed">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <Icon name="Workflow" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="min-w-0 truncate">Fix flaky CI job</span>
          <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
            2/4 agents
          </span>
        </span>
        <WorkflowStatusPill state="failed" />
        <Icon
          name="ChevronDown"
          className={`size-3.5 shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      <WorkflowPhaseStrip
        progress={SNAPSHOT}
        currentPhaseIndex={2}
        settled={false}
        className="px-3 pb-2"
      />
      {expanded ? (
        <div className="border-t border-border bg-popover">
          <div className="max-h-72 overflow-y-auto px-2.5 py-2">
            <WorkflowProgress
              progress={SNAPSHOT}
              settled={false}
              currentPhaseIndex={2}
              collapsiblePhases
              onAgentActivate={() => {}}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Expandable run card"
        hint="plugins/workflows/src/app.tsx — phase strip + status pill + progress list as a collapsible run card"
      >
        <WorkflowRunCardDemo />
      </StoryRow>
    </StoryCard>
  );
}
