import type { Host, WorkflowProgressSnapshot } from "@bb/domain";
import type { TimelineRow, WorkflowRunResponse } from "@bb/server-contract";
import {
  WorkflowAgentTimelineBody,
  type WorkflowAgentTimelineState,
} from "./WorkflowAgentTimeline";
import { WorkflowRunPage } from "./WorkflowRunPage";

export default {
  title: "views/Workflow Run",
};

// Full-page stories: the stage supplies the padding and bounded height the
// app layout normally provides around PageShell's bleed margins.
function PageStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[720px] w-full flex-col overflow-hidden p-5">
      {children}
    </div>
  );
}

const connectedHost: Host = {
  id: "host_story",
  name: "dev-laptop",
  type: "persistent",
  status: "connected",
  lastSeenAt: 1780540130000,
  createdAt: 1780000000000,
  updatedAt: 1780540130000,
};

const offlineHost: Host = {
  ...connectedHost,
  status: "disconnected",
};

// ---------------------------------------------------------------------------
// Snapshots follow the fixture-mini capture shape used by the workflow row
// stories (two phases, haiku agents, public model ids only).
// ---------------------------------------------------------------------------

const liveSnapshot: WorkflowProgressSnapshot = {
  phases: [
    { index: 1, title: "Scan" },
    { index: 2, title: "Summarize" },
  ],
  agents: [
    {
      index: 1,
      label: "alpha",
      state: "done",
      model: "claude-haiku-4-5-20251001",
      attempt: 1,
      cached: false,
      lastProgressAt: 1780540129098,
      phaseIndex: 1,
      phaseTitle: "Scan",
      queuedAt: 1780540127739,
      startedAt: 1780540127740,
      tokens: 8886,
      toolCalls: 2,
      durationMs: 1358,
    },
    {
      index: 2,
      label: "bravo",
      state: "running",
      model: "claude-haiku-4-5-20251001",
      attempt: 1,
      cached: false,
      lastProgressAt: 1780540129378,
      phaseIndex: 1,
      phaseTitle: "Scan",
      queuedAt: 1780540127739,
      startedAt: 1780540127740,
      lastToolName: "rg",
      tokens: 8887,
    },
    {
      index: 3,
      label: "combine",
      state: "queued",
      model: "claude-haiku-4-5-20251001",
      attempt: 1,
      cached: false,
      lastProgressAt: 1780540129488,
      phaseIndex: 2,
      phaseTitle: "Summarize",
      queuedAt: 1780540129488,
    },
  ],
};

const settledSnapshot: WorkflowProgressSnapshot = {
  phases: liveSnapshot.phases,
  agents: liveSnapshot.agents.map((agent) => ({
    ...agent,
    state: "done" as const,
    startedAt: agent.startedAt ?? agent.queuedAt,
    tokens: agent.tokens ?? 8901,
    toolCalls: agent.toolCalls ?? 1,
    durationMs: agent.durationMs ?? 1700,
  })),
};

const runBase: WorkflowRunResponse = {
  id: "wfr_storyrun01",
  projectId: "proj_story",
  hostId: connectedHost.id,
  workspacePath: "/Users/dev/checkouts/acme",
  anchorThreadId: "thr_storyanchor",
  workflowName: "deep-research",
  sourceTier: "project",
  scriptHash: "3f9c2a71b4d8e605",
  argsJson: '{"topic":"workspace pruning strategies"}',
  seed: 424242,
  keyVersion: "bb1",
  providerId: "claude-code",
  model: "claude-haiku-4-5-20251001",
  effort: "medium",
  sandbox: "read-only",
  concurrency: 8,
  maxAgents: 30,
  maxFanout: 10,
  budgetOutputTokens: null,
  status: "running",
  failureReason: null,
  progressSnapshot: liveSnapshot,
  usage: {
    inputTokens: 184230,
    outputTokens: 23499,
    toolUses: 41,
    durationMs: 192_000,
  },
  resultJson: null,
  retention: "live",
  createdAt: 1780540127000,
  startedAt: 1780540127700,
  settledAt: null,
  updatedAt: 1780540129500,
};

const completedRun: WorkflowRunResponse = {
  ...runBase,
  status: "completed",
  progressSnapshot: settledSnapshot,
  resultJson:
    '{"summary":"Three prune strategies compared","winner":"mark-and-sweep"}',
  usage: {
    inputTokens: 412930,
    outputTokens: 50211,
    toolUses: 96,
    durationMs: 3_843_000,
  },
  settledAt: 1780543970000,
  updatedAt: 1780543970000,
};

const interruptedRun: WorkflowRunResponse = {
  ...runBase,
  status: "interrupted",
  updatedAt: 1780540200000,
};

// ---------------------------------------------------------------------------
// Drill-in timeline fixture: the rows the per-agent event log projects into.
// ---------------------------------------------------------------------------

const drillInRows: TimelineRow[] = [
  {
    id: "wfa_storyrun01_1:assistant-text:12",
    threadId: "wfa_storyrun01_1",
    turnId: "turn-story-1",
    sourceSeqStart: 12,
    sourceSeqEnd: 12,
    startedAt: 1780540127900,
    createdAt: 1780540128000,
    kind: "conversation",
    role: "assistant",
    text: "Scanning the workspace for prune candidates before summarizing.",
    attachments: null,
    turnRequest: null,
  },
  {
    id: "wfa_storyrun01_1:command:call_story1",
    threadId: "wfa_storyrun01_1",
    turnId: "turn-story-1",
    sourceSeqStart: 13,
    sourceSeqEnd: 14,
    startedAt: 1780540128100,
    createdAt: 1780540128600,
    kind: "work",
    workKind: "command",
    status: "completed",
    callId: "call_story1",
    command: "rg --files --glob '!node_modules' | head -20",
    cwd: "/Users/dev/checkouts/acme",
    source: null,
    output: "README.md\npackage.json\nsrc/index.ts\nsrc/prune.ts\n",
    exitCode: 0,
    completedAt: 1780540128600,
    approvalStatus: null,
    activityIntents: [],
  },
];

function storyAgentTimeline(
  stateByIndex: Record<number, WorkflowAgentTimelineState>,
) {
  return ({ agentIndex }: { agentIndex: number }) => {
    const state = stateByIndex[agentIndex] ?? { kind: "missing" as const };
    return <WorkflowAgentTimelineBody state={state} />;
  };
}

const noopActions = {
  isCancelPending: false,
  isResumePending: false,
  onCancel: () => {},
  onCloseAgent: () => {},
  onResume: () => {},
  onSelectAgent: () => {},
};

export function Live() {
  return (
    <PageStage>
      <WorkflowRunPage
        {...noopActions}
        host={connectedHost}
        renderAgentTimeline={storyAgentTimeline({})}
        run={runBase}
        selectedAgentIndex={null}
        worktreeBranches={[]}
      />
    </PageStage>
  );
}

export function LiveWithAgentChat() {
  return (
    <PageStage>
      <WorkflowRunPage
        {...noopActions}
        host={connectedHost}
        renderAgentTimeline={storyAgentTimeline({
          1: { kind: "ready", isLive: false, rows: drillInRows },
        })}
        run={runBase}
        selectedAgentIndex={1}
        worktreeBranches={[]}
      />
    </PageStage>
  );
}

export function AgentChatLoading() {
  return (
    <PageStage>
      <WorkflowRunPage
        {...noopActions}
        host={connectedHost}
        renderAgentTimeline={storyAgentTimeline({
          2: { kind: "loading" },
        })}
        run={runBase}
        selectedAgentIndex={2}
        worktreeBranches={[]}
      />
    </PageStage>
  );
}

export function PausedWithResume() {
  return (
    <PageStage>
      <WorkflowRunPage
        {...noopActions}
        host={connectedHost}
        renderAgentTimeline={storyAgentTimeline({
          1: { kind: "ready", isLive: false, rows: drillInRows },
        })}
        run={interruptedRun}
        selectedAgentIndex={null}
        worktreeBranches={[]}
      />
    </PageStage>
  );
}

export function Completed() {
  return (
    <PageStage>
      <WorkflowRunPage
        {...noopActions}
        host={connectedHost}
        renderAgentTimeline={storyAgentTimeline({
          1: { kind: "ready", isLive: false, rows: drillInRows },
        })}
        run={completedRun}
        selectedAgentIndex={null}
        worktreeBranches={["bb-workflow/wfr_storyrun01/alpha"]}
      />
    </PageStage>
  );
}

export function HostOffline() {
  return (
    <PageStage>
      <WorkflowRunPage
        {...noopActions}
        host={offlineHost}
        renderAgentTimeline={storyAgentTimeline({
          1: { kind: "unavailable" },
        })}
        run={runBase}
        selectedAgentIndex={1}
        worktreeBranches={[]}
      />
    </PageStage>
  );
}
