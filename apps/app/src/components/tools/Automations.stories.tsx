import { useState, type CSSProperties, type ReactNode } from "react";
import { AutomationDetailView } from "bb-plugin-automations/detail-view";
import {
  AutomationOverviewView,
  type AutomationCollectionMode,
} from "bb-plugin-automations/overview-view";
import type {
  AutomationResponse,
  AutomationRunResponse,
  AutomationsOverviewResponse,
} from "bb-plugin-automations/rpc-types";
import { ResourceListState } from "@bb/shared-ui/resource-list";

export default {
  title: "Automations",
};

const noop = () => {};
const now = new Date(2027, 0, 15, 9).getTime();

function automation(
  id: string,
  name: string,
  overrides: Partial<AutomationResponse> = {},
): AutomationResponse {
  return {
    id,
    projectId: "proj_personal",
    name,
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "0 9 * * 1-5",
      timezone: "America/Los_Angeles",
    },
    execution: {
      mode: "agent",
      prompt: `Run ${name.toLowerCase()}.`,
      providerId: "claude",
      model: "claude-opus-5",
      permissionMode: "auto",
      environment: { type: "host", workspace: { type: "personal" } },
    },
    origin: "human",
    createdByThreadId: null,
    nextRunAt: now + 86_400_000,
    lastRunAt: now - 3_600_000,
    runCount: 12,
    lastRunStatus: "succeeded",
    lastRunThreadId: null,
    lastError: null,
    createdAt: now - 30 * 86_400_000,
    updatedAt: now,
    ...overrides,
  };
}

const OVERVIEW_ENTRIES: AutomationsOverviewResponse["automations"] = [
  {
    automation: automation("ci-triage", "CI failure triage"),
    project: { id: "proj_personal", name: "Personal" },
  },
  {
    automation: automation("release", "Release readiness", {
      projectId: "proj_bb",
      lastRunStatus: "running",
      nextRunAt: now + 3_600_000,
    }),
    project: { id: "proj_bb", name: "bb" },
  },
  {
    automation: automation("dependencies", "Dependency drift", {
      projectId: "proj_bb",
      enabled: false,
      nextRunAt: null,
    }),
    project: { id: "proj_bb", name: "bb" },
  },
  {
    automation: automation("one-shot", "Prepare launch notes", {
      projectId: "proj_moss",
      trigger: { triggerType: "once", runAt: now - 86_400_000 },
      enabled: false,
      nextRunAt: null,
      runCount: 1,
      lastRunStatus: "succeeded",
    }),
    project: { id: "proj_moss", name: "Moss" },
  },
  {
    automation: automation("stale-worktrees", "Stale worktree cleanup", {
      projectId: "proj_moss",
      lastRunStatus: "failed",
      lastError: "Host was offline",
    }),
    project: { id: "proj_moss", name: "Moss" },
  },
];

function StoryFrame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto box-border h-[720px] w-full max-w-5xl px-5 py-4">
      {children}
    </main>
  );
}

function Overview({
  entries = OVERVIEW_ENTRIES,
  error = null,
  initialMode = "installed",
}: {
  entries?: AutomationsOverviewResponse["automations"] | null;
  error?: string | null;
  initialMode?: AutomationCollectionMode;
}) {
  const [mode, setMode] = useState<AutomationCollectionMode>(initialMode);
  return (
    <StoryFrame>
      <AutomationOverviewView
        entries={entries}
        error={error}
        onRetry={noop}
        onOpenDetail={noop}
        onEnabledChange={async () => {}}
        onCreateViaChat={noop}
        activeMode={mode}
        onModeChange={setMode}
      />
    </StoryFrame>
  );
}

export function OverviewPage() {
  return <Overview />;
}

export function OverviewStates() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-5 py-6">
      {[
        {
          label: "Loading",
          content: <Overview entries={null} />,
        },
        {
          label: "Empty",
          content: <Overview entries={[]} />,
        },
        {
          label: "Failed",
          content: <Overview entries={null} error="Connection timed out" />,
        },
      ].map(({ label, content }) => (
        <section key={label} className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">{label}</h2>
          <div className="overflow-hidden rounded-md border border-border">
            {content}
          </div>
        </section>
      ))}
    </main>
  );
}

export function BrowseTemplates() {
  return <Overview initialMode="browse" />;
}

const DETAIL_AUTOMATION = automation("nightly-digest", "Nightly digest", {
  trigger: {
    triggerType: "schedule",
    cron: "0 9 * * 1-5",
    timezone: "UTC",
  },
  execution: {
    mode: "agent",
    prompt: "Summarize yesterday's commits and open pull requests.",
    providerId: "claude",
    model: "claude-opus-5",
    permissionMode: "auto",
    environment: { type: "host", workspace: { type: "personal" } },
  },
  nextRunAt: now,
  lastRunAt: null,
  runCount: 0,
  lastRunStatus: null,
});

const PROJECT_AUTOMATION: AutomationResponse = {
  ...DETAIL_AUTOMATION,
  projectId: "proj_bb",
  execution: {
    mode: "agent",
    prompt: "Summarize yesterday's commits and open pull requests.",
    providerId: "claude",
    model: "claude-opus-5",
    permissionMode: "auto",
    environment: {
      type: "host",
      hostId: "host_local",
      workspace: {
        type: "unmanaged",
        path: "/Users/you/Code/bb",
        branch: { kind: "existing", name: "agent/tools-hub-schedules" },
      },
    },
  },
};

const SCRIPT_AUTOMATION: AutomationResponse = {
  ...DETAIL_AUTOMATION,
  id: "sync-reports",
  name: "Sync reports",
  trigger: { triggerType: "once", runAt: now },
  execution: {
    mode: "script",
    script: `#!/usr/bin/env bash
set -euo pipefail

report_date="$(date -u +%F)"
output_dir="\${REPORT_OUTPUT:-./reports}"

mkdir -p "$output_dir"

for repository in api app docs integrations; do
  echo "Collecting $repository activity for $report_date"
  gh pr list \\
    --repo "bb/$repository" \\
    --state all \\
    --json number,title,state,updatedAt \\
    > "$output_dir/$repository-$report_date.json"

  gh issue list \\
    --repo "bb/$repository" \\
    --state all \\
    --json number,title,state,updatedAt \\
    > "$output_dir/$repository-issues-$report_date.json"

  echo "Collected $repository"
done

echo "Validating report files"
find "$output_dir" -type f -name "*$report_date.json" -print

echo "Reports written to $output_dir"`,
    interpreter: "bash",
    timeoutMs: 60_000,
    env: {
      REPORT_OUTPUT: "/tmp/bb-reports",
      GH_HOST: "github.com",
    },
  },
};

/** Enabled and recurring, but the server has not computed a next run. */
const UNSCHEDULED_AUTOMATION: AutomationResponse = {
  ...DETAIL_AUTOMATION,
  id: "unscheduled-digest",
  name: "Unscheduled digest",
  nextRunAt: null,
};

/** A one-time automation that already ran and will not run again. */
const COMPLETED_AUTOMATION: AutomationResponse = {
  ...DETAIL_AUTOMATION,
  id: "one-time-backfill",
  name: "One-time backfill",
  trigger: { triggerType: "once", runAt: now - 86_400_000 },
  enabled: false,
  nextRunAt: null,
  runCount: 1,
  lastRunAt: now - 86_400_000,
  lastRunStatus: "succeeded",
};

const RUNS: AutomationRunResponse[] = (
  [
    ["succeeded", null],
    ["failed", "Exit code 1: provider timed out"],
    ["running", null],
    ["skipped", null],
  ] as const
).map(([status, error], index) => ({
  id: `run_${index}`,
  automationId: DETAIL_AUTOMATION.id,
  runMode: "agent",
  threadId: `thr_${index}`,
  status,
  trigger: index === 0 ? "manual" : "schedule",
  // The only skip reasons the product emits are "empty output" and
  // "wakeAgent false" (script-runner.ts:101,110). The previous fixture invented
  // an overlap-suppression string, which read as a second, confusing "running".
  skipReason: status === "skipped" ? "empty output" : null,
  error,
  output: null,
  exitCode: null,
  scheduledFor: now,
  startedAt: now,
  finishedAt: status === "running" ? null : now + 42_000,
}));

function AutomationDetail({
  value = DETAIL_AUTOMATION,
  projectLabel = "Local",
  runs = [],
  loading = false,
  error = null,
}: {
  value?: AutomationResponse;
  projectLabel?: string;
  runs?: readonly AutomationRunResponse[];
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <AutomationDetailView
      automation={value}
      projectLabel={projectLabel}
      runsState={{
        runs,
        nextCursor: null,
        loading,
        loadingMore: false,
        error,
        loadMore: noop,
        retry: noop,
      }}
      actionPending={false}
      onToggle={noop}
      onEdit={noop}
      onRunNow={noop}
      onDelete={noop}
      onOpenThread={noop}
    />
  );
}

function DetailState({
  name,
  note,
  children,
}: {
  name: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-[var(--story-doc-width)_minmax(0,1fr)] items-start max-[900px]:grid-cols-1">
      <div className="h-full border-r border-border bg-surface-recessed max-[900px]:border-b max-[900px]:border-r-0">
        <div className="sticky top-0 px-4 py-4">
          <h2 className="text-sm font-medium text-foreground">{name}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {note}
          </p>
        </div>
      </div>
      <div className="min-w-0 px-5 py-5">{children}</div>
    </section>
  );
}

export function DetailStates() {
  return (
    <main
      className="mx-auto w-full max-w-[72rem] space-y-4 px-5 py-6"
      style={{ "--story-doc-width": "232px" } as CSSProperties}
    >
      <header>
        <h1 className="text-lg font-semibold text-foreground">
          Automation detail states
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          An automation page is Definition then Runs. Runs owns its loading,
          empty, failed, and populated states without moving.
        </p>
      </header>
      <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
        <DetailState
          name="Agent automation"
          note="A recurring prompt with disabled model and access selectors plus its exact configured project location."
        >
          <AutomationDetail
            value={PROJECT_AUTOMATION}
            projectLabel="bb"
            runs={RUNS}
          />
        </DetailState>
        <DetailState
          name="Script automation"
          note="The exact stored script that will run, capped with a bottom fade and transient scrollbar. Environment-variable names are available without exposing values."
        >
          <AutomationDetail value={SCRIPT_AUTOMATION} runs={RUNS.slice(0, 1)} />
        </DetailState>
        <DetailState
          name="No next run"
          note="Enabled and recurring, but nothing is scheduled. The upcoming-run slot says so rather than going blank."
        >
          <AutomationDetail
            value={UNSCHEDULED_AUTOMATION}
            runs={RUNS.slice(0, 1)}
          />
        </DetailState>
        <DetailState
          name="Completed one-time run"
          note="A one-shot that already ran. The trigger still says One time and the run itself is in Runs, so the meta row no longer repeats “Completed”."
        >
          <AutomationDetail
            value={COMPLETED_AUTOMATION}
            runs={RUNS.slice(0, 1)}
          />
        </DetailState>
        <DetailState
          name="No runs yet"
          note="The Runs section stays in place and explains itself rather than collapsing."
        >
          <AutomationDetail />
        </DetailState>
        <DetailState
          name="Runs loading"
          note="The definition is usable while history is still arriving."
        >
          <AutomationDetail loading />
        </DetailState>
        <DetailState
          name="Runs unavailable"
          note="Only the run history is unavailable; the definition remains usable, and Retry stays with the affected section."
        >
          <AutomationDetail error="Request timed out" />
        </DetailState>
        <DetailState
          name="Paused"
          note="A disabled automation keeps its full definition and history."
        >
          <AutomationDetail
            value={{ ...DETAIL_AUTOMATION, enabled: false }}
            runs={RUNS.slice(0, 2)}
          />
        </DetailState>
        <DetailState
          name="Route loading"
          note="Before the automation resolves."
        >
          <ResourceListState
            state="loading"
            message="Loading automation"
            layout="detail"
          />
        </DetailState>
        <DetailState
          name="Route not found"
          note="The automation was deleted or the id is wrong."
        >
          <ResourceListState
            state="error"
            message="Automation not found."
            layout="detail"
            onRetry={noop}
          />
        </DetailState>
      </div>
    </main>
  );
}
