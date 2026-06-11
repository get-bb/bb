import type { HostDaemonWorkflowListing } from "@bb/host-daemon-contract";
import type { WorkflowRunResponse } from "@bb/server-contract";
import { ProjectWorkflowsPage } from "./ProjectWorkflowsPage";

export default {
  title: "views/Project Workflows",
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

const STORY_NOW = 1780540130000;

const workflows: HostDaemonWorkflowListing[] = [
  {
    name: "deep-research",
    description:
      "Fan out research agents across independent sources, then synthesize a cited report.",
    whenToUse:
      "Broad questions that benefit from many independent perspectives compared adversarially.",
    defaultProvider: "claude-code",
    defaultModel: "claude-haiku-4-5-20251001",
    defaultSandbox: "read-only",
    tier: "project",
  },
  {
    name: "code-review",
    description:
      "Parallel reviewers sweep a diff for correctness bugs; a judge merges findings.",
    defaultSandbox: "read-only",
    tier: "builtin",
  },
  {
    name: "release-notes",
    description: "Summarize merged changes since the last tag into notes.",
    whenToUse: "Cutting a release.",
    tier: "user",
  },
];

const runBase: WorkflowRunResponse = {
  id: "wfr_storyrun01",
  projectId: "proj_story",
  hostId: "host_story",
  workspacePath: "/Users/dev/checkouts/acme",
  anchorThreadId: null,
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
  progressSnapshot: null,
  usage: {
    inputTokens: 184230,
    outputTokens: 23499,
    toolUses: 41,
    durationMs: 192_000,
  },
  resultJson: null,
  retention: "live",
  createdAt: STORY_NOW - 3 * 60_000,
  startedAt: STORY_NOW - 3 * 60_000 + 700,
  settledAt: null,
  updatedAt: STORY_NOW,
};

const runs: WorkflowRunResponse[] = [
  runBase,
  {
    ...runBase,
    id: "wfr_storyrun02",
    workflowName: "code-review",
    sourceTier: "builtin",
    status: "interrupted",
    createdAt: STORY_NOW - 2 * 3_600_000,
    updatedAt: STORY_NOW - 90 * 60_000,
  },
  {
    ...runBase,
    id: "wfr_storyrun03",
    status: "completed",
    resultJson: '{"summary":"Three prune strategies compared"}',
    createdAt: STORY_NOW - 26 * 3_600_000,
    settledAt: STORY_NOW - 25 * 3_600_000,
    updatedAt: STORY_NOW - 25 * 3_600_000,
  },
  {
    ...runBase,
    id: "wfr_storyrun04",
    workflowName: "release-notes",
    sourceTier: "user",
    status: "failed",
    failureReason: "command_expired",
    createdAt: STORY_NOW - 3 * 86_400_000,
    settledAt: STORY_NOW - 3 * 86_400_000 + 60_000,
    updatedAt: STORY_NOW - 3 * 86_400_000 + 60_000,
  },
];

const noop = () => {};

export function Overview() {
  return (
    <PageStage>
      <ProjectWorkflowsPage
        definitions={{ kind: "ready", workflows }}
        now={STORY_NOW}
        onRunWorkflow={noop}
        runs={{ kind: "ready", runs }}
      />
    </PageStage>
  );
}

export function HostOffline() {
  return (
    <PageStage>
      <ProjectWorkflowsPage
        definitions={{
          kind: "unavailable",
          message:
            "Source host is offline — workflow definitions are unavailable.",
        }}
        now={STORY_NOW}
        onRunWorkflow={noop}
        runs={{ kind: "ready", runs }}
      />
    </PageStage>
  );
}

export function EmptyProject() {
  return (
    <PageStage>
      <ProjectWorkflowsPage
        definitions={{ kind: "ready", workflows: [] }}
        now={STORY_NOW}
        onRunWorkflow={noop}
        runs={{ kind: "ready", runs: [] }}
      />
    </PageStage>
  );
}

export function Loading() {
  return (
    <PageStage>
      <ProjectWorkflowsPage
        definitions={{ kind: "loading" }}
        now={STORY_NOW}
        onRunWorkflow={noop}
        runs={{ kind: "loading" }}
      />
    </PageStage>
  );
}
