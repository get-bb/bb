import { useState } from "react";
import type { WorkflowProgressSnapshot } from "@bb/domain";
import { ThreadWorkflowCard } from "./ThreadWorkflowCard";
import { workflowRow } from "@/test/fixtures/thread-timeline-rows";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "promptbox/banner/ThreadWorkflowCard",
};

function Stage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

// Mirrors the mockup: a six-agent Investigate phase (all done) plus a
// single-agent Synthesize phase still running.
const investigationSnapshot: WorkflowProgressSnapshot = {
  phases: [
    { index: 1, title: "Investigate" },
    { index: 2, title: "Synthesize" },
  ],
  agents: [
    ["data-model", 79_000, 37, 199_000],
    ["server-exec", 98_300, 34, 224_000],
    ["contract-sdk-cli", 93_800, 47, 256_000],
    ["app-ui", 79_000, 47, 265_000],
    ["goals-runtime", 121_800, 45, 254_000],
    ["templates-security", 90_300, 51, 226_000],
  ].map(([label, tokens, toolCalls, durationMs], i) => ({
    index: i + 1,
    label: label as string,
    state: "done" as const,
    model: "opus",
    attempt: 1,
    cached: false,
    lastProgressAt: 1780540129098,
    phaseIndex: 1,
    phaseTitle: "Investigate",
    queuedAt: 1780540127739,
    startedAt: 1780540127740,
    tokens: tokens as number,
    toolCalls: toolCalls as number,
    durationMs: durationMs as number,
  })),
};
investigationSnapshot.agents.push({
  index: 7,
  label: "synthesize-plan",
  state: "running",
  model: "opus",
  attempt: 1,
  cached: false,
  lastProgressAt: 1780540129378,
  phaseIndex: 2,
  phaseTitle: "Synthesize",
  queuedAt: 1780540127739,
  startedAt: 1780540127740,
  tokens: 71_200,
  toolCalls: 0,
});

const runningWorkflow = workflowRow({
  id: "thr_fixture:workflow:investigation:running",
  status: "pending",
  taskStatus: "running",
  workflowName: "bb-automations-investigation",
  description: "Investigate the automations subsystem",
  // ~5m26s ago, so the live duration reads like the mockup.
  startedAt: Date.now() - 326_000,
  workflow: investigationSnapshot,
  usage: { totalTokens: 633_400, toolUses: 261, durationMs: 326_000 },
});

function FauxComposer() {
  return (
    <div className="rounded-lg border border-border bg-popover p-3">
      <div className="pb-3 text-sm text-subtle-foreground">
        Reply to the agent…
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
          opus
        </span>
      </div>
    </div>
  );
}

function ToggleableCard() {
  const [expanded, setExpanded] = useState(true);
  return (
    <ThreadWorkflowCard
      workflow={runningWorkflow}
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
        hint="floats above the composer while the workflow runs (click to toggle)"
      >
        <Stage>
          <div className="flex flex-col gap-2">
            <ToggleableCard />
            <FauxComposer />
          </div>
        </Stage>
      </StoryRow>
      <StoryRow label="collapsed" hint="single-line glance: name, agent count, live time">
        <Stage>
          <ThreadWorkflowCard
            workflow={runningWorkflow}
            isExpanded={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
          />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}
