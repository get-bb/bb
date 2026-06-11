import type {
  WorkflowAgentSnapshot,
  WorkflowProgressSnapshot,
} from "@bb/domain";
import { WorkflowAgentTree } from "./WorkflowAgentTree";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "workflow/WorkflowAgentTree",
};

function TreeStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[560px] rounded-md border border-border bg-background py-1">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Snapshots mirror the folded workflow_progress state of a bb workflow run
// (same shape the inline timeline row renders — one canonical tree for both).
// Model ids are public release ids only.
// ---------------------------------------------------------------------------

const BASE_AGENT = {
  model: "claude-haiku-4-5-20251001",
  attempt: 1,
  cached: false,
} as const;

const twoPhaseSnapshot: WorkflowProgressSnapshot = {
  phases: [
    { index: 1, title: "Scan" },
    { index: 2, title: "Summarize" },
  ],
  agents: [
    {
      ...BASE_AGENT,
      index: 1,
      label: "alpha",
      state: "done",
      lastProgressAt: 1780540129098,
      phaseIndex: 1,
      phaseTitle: "Scan",
      agentType: "researcher",
      tokens: 8886,
      toolCalls: 3,
      durationMs: 61358,
    },
    {
      ...BASE_AGENT,
      index: 2,
      label: "bravo",
      state: "running",
      lastProgressAt: 1780540129378,
      phaseIndex: 1,
      phaseTitle: "Scan",
      tokens: 8887,
      toolCalls: 1,
    },
    {
      ...BASE_AGENT,
      index: 3,
      label: "combine",
      state: "queued",
      lastProgressAt: 1780540129488,
      phaseIndex: 2,
      phaseTitle: "Summarize",
      queuedAt: 1780540129488,
    },
  ],
};

// A resumed run: the journaled prefix replayed for free (`cached`), one agent
// failed after retries, the rest re-ran.
const resumedSnapshot: WorkflowProgressSnapshot = {
  phases: twoPhaseSnapshot.phases,
  agents: [
    {
      ...twoPhaseSnapshot.agents[0]!,
      state: "done",
      cached: true,
      durationMs: 12,
    },
    {
      ...twoPhaseSnapshot.agents[1]!,
      state: "failed",
      attempt: 3,
      error: "agent abandoned: user requested retry on all 3 attempts",
      durationMs: 95480,
    },
    {
      ...twoPhaseSnapshot.agents[2]!,
      state: "done",
      tokens: 9120,
      toolCalls: 0,
      durationMs: 1834,
    },
  ],
};

function fanOutAgent(index: number): WorkflowAgentSnapshot {
  const state =
    index <= 12
      ? ("done" as const)
      : index <= 22
        ? ("running" as const)
        : index === 23
          ? ("failed" as const)
          : ("queued" as const);
  return {
    ...BASE_AGENT,
    index,
    label: `shard-${index.toString().padStart(2, "0")}`,
    state,
    lastProgressAt: 1780540130000 + index,
    phaseIndex: 1,
    phaseTitle: "Fan-out",
    ...(state === "done"
      ? { tokens: 8000 + index * 13, toolCalls: index % 4, durationMs: 40_000 + index * 700 }
      : {}),
    ...(state === "running" ? { tokens: 2400 + index * 7 } : {}),
    ...(state === "failed"
      ? { attempt: 2, error: "tool timeout after 120s" }
      : {}),
  };
}

// 30-agent fan-out: the M5 exit-criterion shape (capacity-queued tail, mixed
// states) — the tree must stay readable and cheap to re-render.
const fanOutSnapshot: WorkflowProgressSnapshot = {
  phases: [
    { index: 1, title: "Fan-out" },
    { index: 2, title: "Reduce" },
  ],
  agents: Array.from({ length: 30 }, (_, i) => fanOutAgent(i + 1)),
};

export function Overview() {
  return (
    <StoryCard labelWidth="150px">
      <StoryRow
        label="running"
        hint="live run: done/running/queued agents grouped by phase"
      >
        <TreeStage>
          <WorkflowAgentTree runState="running" snapshot={twoPhaseSnapshot} />
        </TreeStage>
      </StoryRow>
      <StoryRow
        label="paused"
        hint="interrupted-but-resumable: running agents pause, queued stay queued"
      >
        <TreeStage>
          <WorkflowAgentTree runState="paused" snapshot={twoPhaseSnapshot} />
        </TreeStage>
      </StoryRow>
      <StoryRow
        label="settled"
        hint="terminal run with leftover non-settled agents: rendered stopped"
      >
        <TreeStage>
          <WorkflowAgentTree runState="settled" snapshot={twoPhaseSnapshot} />
        </TreeStage>
      </StoryRow>
      <StoryRow
        label="resumed / cached"
        hint="journal-replayed prefix marked cached; failed agent carries its error"
      >
        <TreeStage>
          <WorkflowAgentTree runState="settled" snapshot={resumedSnapshot} />
        </TreeStage>
      </StoryRow>
    </StoryCard>
  );
}

export function ThirtyAgentFanOut() {
  return (
    <StoryCard labelWidth="150px">
      <StoryRow
        label="30-agent fan-out"
        hint="wide parallel phase with capacity-queued tail and one failure"
      >
        <TreeStage>
          <WorkflowAgentTree runState="running" snapshot={fanOutSnapshot} />
        </TreeStage>
      </StoryRow>
    </StoryCard>
  );
}
