import { useState, type ReactNode } from "react";
import {
  AgentAutomationDefinition,
  AutomationLifecycleControl,
  AutomationScriptContent,
  ScriptAutomationDefinition,
  RunRow,
} from "./detail-view";
import { AUTOMATION_CREATE_TEMPLATES, OverviewRow } from "./overview-view";
import type {
  AutomationResponse,
  AgentEnvironment,
  AutomationRunResponse,
  AutomationsOverviewResponse,
} from "./src/rpc-types";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  ResourceActionButton,
  ResourceCreateButton,
  ResourceListState,
  ResourceOverflowMenu,
} from "@/components/ui/resource-list";

export default {
  title: "Automations",
  meta: { modelPickerCatalog: { environmentIds: ["env_story_reuse"] } },
};

function StoryCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-md" style={{ margin: "1.5rem" }}>
      {children}
    </div>
  );
}

function StoryRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="grid items-start gap-x-4 px-4 py-3"
      style={{ gridTemplateColumns: "210px minmax(0, 1fr)" }}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-muted-foreground">{label}</span>
        {hint === undefined ? null : (
          <span className="text-xs break-words text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {children}
      </div>
    </div>
  );
}

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
      providerId: "claude-code",
      model: "claude-fable-5",
      reasoningLevel: "medium",
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
    automation: automation("pending-reminder", "A pending launch reminder", {
      projectId: "proj_bb",
      trigger: { triggerType: "once", runAt: now + 86_400_000 },
      nextRunAt: now + 86_400_000,
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

const DETAIL_AUTOMATION = automation("nightly-digest", "Nightly digest", {
  trigger: {
    triggerType: "schedule",
    cron: "0 9 * * 1-5",
    timezone: "UTC",
  },
  execution: {
    mode: "agent",
    prompt: "Summarize yesterday's commits and open pull requests.",
    providerId: "claude-code",
    model: "claude-fable-5",
    reasoningLevel: "medium",
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
  lastRunAt: now,
  runCount: 3,
  lastRunStatus: "running",
  execution: {
    mode: "agent",
    prompt: "Summarize yesterday's commits and open pull requests.",
    providerId: "claude-code",
    model: "claude-fable-5",
    reasoningLevel: "medium",
    permissionMode: "auto",
    environment: {
      type: "host",

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
  lastRunAt: now - 3_600_000,
  runCount: 1,
  lastRunStatus: "succeeded",
  execution: {
    mode: "script",
    workingDirectory: { type: "project" },
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

function runsFor(
  value: AutomationResponse,
  statuses: readonly AutomationRunResponse["status"][],
): AutomationRunResponse[] {
  const script = value.execution.mode === "script";
  const latestStartedAt = value.lastRunAt ?? now;
  return statuses.map((status, index) => {
    const startedAt = latestStartedAt - index * 3_600_000;
    return {
      id: `${value.id}_run_${index}`,
      automationId: value.id,
      runMode: value.execution.mode,
      threadId: script ? null : `thr_${value.id}_${index}`,
      status,
      trigger:
        value.trigger.triggerType === "once" && !value.enabled
          ? "schedule"
          : index === 0
            ? "manual"
            : "schedule",
      skipReason: script && status === "skipped" ? "empty output" : null,
      error:
        status === "failed"
          ? script
            ? "Script exited with code 1"
            : "Provider timed out"
          : null,
      output:
        script && status === "succeeded"
          ? "Reports written to ./reports"
          : null,
      exitCode:
        script && status !== "running" ? (status === "failed" ? 1 : 0) : null,
      scheduledFor: startedAt,
      startedAt,
      finishedAt: status === "running" ? null : startedAt + 42_000,
    };
  });
}

function PromptVariant({
  value,
  editable = false,
  projectLabel,
}: {
  value: AutomationResponse;
  editable?: boolean;
  projectLabel?: string;
}) {
  const [execution, setExecution] = useState(value.execution);
  const [editing, setEditing] = useState(editable);
  if (execution.mode !== "agent") return null;
  return (
    <div className="w-full max-w-2xl">
      <AgentAutomationDefinition
        execution={execution}
        editing={editing}
        personalProject={value.projectId === "proj_personal"}
        projectContextLabel={
          projectLabel ??
          (value.projectId === "proj_personal" ? "Personal" : "bb")
        }
        pending={false}
        onCancel={() => setEditing(false)}
        onUpdate={async (update) => {
          setExecution({
            ...execution,
            ...update,
            serviceTier: update.serviceTier ?? undefined,
          });
          setEditing(false);
        }}
      />
    </div>
  );
}

export function OverviewRows() {
  const descriptions: Record<string, { label: string; hint: string }> = {
    "ci-triage": {
      label: "Recurring · Personal",
      hint: "Enabled weekday schedule in the Personal project. Shows the project label and next run.",
    },
    release: {
      label: "Run in progress",
      hint: "A recurring project automation whose latest run is still running. Shows the activity spinner.",
    },
    "pending-reminder": {
      label: "One-time · pending",
      hint: "Scheduled once for a future date. Shows One time and the next-run date.",
    },
    dependencies: {
      label: "Paused",
      hint: "Disabled recurring automation. The switch is off and there is no next-run date.",
    },
    "one-shot": {
      label: "One-time · completed",
      hint: "Already ran successfully. The row is muted and its switch cannot be enabled again.",
    },
    "stale-worktrees": {
      label: "Last run failed",
      hint: "The latest run failed, but the recurring schedule remains enabled. Shows the failure indicator.",
    },
  };
  return (
    <StoryCard>
      {OVERVIEW_ENTRIES.map(({ automation: value, project }) => (
        <StoryRow
          key={value.id}
          label={descriptions[value.id]?.label ?? value.name}
          hint={descriptions[value.id]?.hint}
        >
          {"execution" in value ? (
            <div className="w-full max-w-3xl">
              <OverviewRow
                automation={value}
                project={project}
                onNavigate={noop}
                onEnabledChange={async () => {}}
                onRunNow={async () => {}}
                onDelete={() => {}}
              />
            </div>
          ) : null}
        </StoryRow>
      ))}
      <StoryRow
        label="Script automation"
        hint="Uses the script icon instead of the agent calendar icon. The schedule and toggle use the same row layout."
      >
        <div className="w-full max-w-3xl">
          <OverviewRow
            automation={SCRIPT_AUTOMATION}
            project={{ id: "proj_personal", name: "Personal" }}
            onNavigate={noop}
            onEnabledChange={async () => {}}
            onRunNow={async () => {}}
            onDelete={() => {}}
          />
        </div>
      </StoryRow>
    </StoryCard>
  );
}

export function OverviewStates() {
  const states = [
    {
      label: "Fetching automations",
      hint: "Replaces the list while its first request is pending. The page reveals these four skeleton rows after its loading delay.",
      state: "loading",
      message: "Loading automations",
    },
    {
      label: "No automations created",
      hint: "The request succeeded, but there are no installed automations.",
      state: "empty",
      message: "No automations installed.",
    },
    {
      label: "Could not load the list",
      hint: "The request failed. The page offers Retry; this isolated example does not make a request.",
      state: "error",
      message: "Couldn't load automations.",
    },
    {
      label: "No search results",
      hint: "Automations exist, but none match the entered search text.",
      state: "empty",
      message: 'No automations match "release"',
    },
    {
      label: "No filter matches",
      hint: "Automations exist, but the selected project or status filters exclude all of them.",
      state: "empty",
      message: "No automations match these filters.",
    },
    {
      label: "No search and filter matches",
      hint: "Both a search term and filters are active, and no automation matches both.",
      state: "empty",
      message: 'No automations match "release" with these filters.',
    },
  ] as const;
  return (
    <StoryCard>
      {states.map(({ label, hint, state, message }) => (
        <StoryRow key={label} label={label} hint={hint}>
          <div className="w-full max-w-3xl">
            <ResourceListState
              state={state}
              message={message}
              onRetry={state === "error" ? noop : undefined}
            />
          </div>
        </StoryRow>
      ))}
    </StoryCard>
  );
}

function environmentVariant(
  environment: AgentEnvironment,
  targetThreadId?: string,
): AutomationResponse {
  const value = PROJECT_AUTOMATION;
  if (value.execution.mode !== "agent") return value;
  return {
    ...value,
    execution: {
      ...value.execution,
      environment,
      ...(targetThreadId === undefined ? {} : { targetThreadId }),
    },
  };
}

export function DetailStates() {
  return (
    <StoryCard>
      <StoryRow
        label="Personal workspace prompt"
        hint="Read-only prompt using a personal workspace. The footer shows its configured workspace and permissions."
      >
        <PromptVariant value={DETAIL_AUTOMATION} />
      </StoryRow>
      <StoryRow
        label="Project checkout prompt"
        hint="Read-only prompt in a project. The footer includes the project name and configured checkout path."
      >
        <PromptVariant value={PROJECT_AUTOMATION} />
      </StoryRow>
      <StoryRow
        label="Reuse an environment"
        hint="An existing environment ID is configured. Shows Reuse environment with the same open-folder icon as core’s reuse selector."
      >
        <PromptVariant
          value={environmentVariant({
            type: "reuse",
            environmentId: "env_story_reuse",
          })}
        />
      </StoryRow>
      <StoryRow
        label="Create a new worktree"
        hint="Creates a managed worktree from the default branch. Shows New worktree metadata."
      >
        <PromptVariant
          value={environmentVariant({
            type: "host",
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "default" },
            },
          })}
        />
      </StoryRow>
      <StoryRow
        label="Use project defaults"
        hint="No explicit workspace is configured. Shows Project default metadata."
      >
        <PromptVariant
          value={environmentVariant({ type: "project-default" })}
        />
      </StoryRow>
      <StoryRow
        label="Send to an existing thread"
        hint="The target thread takes precedence over the fallback environment. Shows Existing thread metadata."
      >
        <PromptVariant
          value={environmentVariant(
            { type: "project-default" },
            "thr_story_existing",
          )}
        />
      </StoryRow>
      <StoryRow
        label="Checkout without a path"
        hint="An unmanaged workspace with no configured path. Shows the Workspace fallback label."
      >
        <PromptVariant
          value={environmentVariant({
            type: "host",
            workspace: { type: "unmanaged", path: null },
          })}
        />
      </StoryRow>
      <StoryRow
        label="Long project and path"
        hint="Exercises truncation when both the project name and checkout path are long."
      >
        <PromptVariant
          projectLabel="Infrastructure and release engineering"
          value={environmentVariant({
            type: "host",
            workspace: {
              type: "unmanaged",
              path: "/Users/you/Code/infrastructure-and-release-engineering/services/deployment-orchestrator",
            },
          })}
        />
      </StoryRow>
      <StoryRow
        label="Narrow prompt box"
        hint="A 320px-wide reused-environment prompt. Exercises compact labels and permission-control sizing."
      >
        <div className="max-w-full" style={{ width: 320 }}>
          <PromptVariant
            value={environmentVariant({
              type: "reuse",
              environmentId: "env_story_reuse",
            })}
          />
        </div>
      </StoryRow>
      <StoryRow
        label="editing prompt"
        hint="Change the prompt, model, or permission; Save and Cancel update this example."
      >
        <PromptVariant value={PROJECT_AUTOMATION} editable />
      </StoryRow>
      <StoryRow
        label="Short script"
        hint="A script that fits without scrolling or a bottom fade."
      >
        <div className="w-full max-w-2xl rounded-md border border-border">
          <AutomationScriptContent content={'echo "Reports ready"'} />
        </div>
      </StoryRow>
      <StoryRow
        label="Script environment variables"
        hint="A script with two configured variables. Their count sits beside the interpreter and timeout; hover or focus it to see the names."
      >
        <div className="w-full max-w-2xl">
          <ScriptAutomationDefinition
            execution={{
              mode: "script",
              workingDirectory: { type: "project" },
              resolvedWorkingDirectory: "/srv/projects/bb",
              script: 'echo "Preparing report"',
              interpreter: "bash",
              timeoutMs: 60000,
              env: {
                REPORT_OUTPUT: "/tmp/story-reports",
                API_TOKEN: "story-only-value",
              },
            }}
          />
        </div>
      </StoryRow>
      <StoryRow label="long script" hint="Scroll within the script preview.">
        <div className="w-full max-w-2xl rounded-md border border-border">
          <AutomationScriptContent
            content={
              SCRIPT_AUTOMATION.execution.mode === "script"
                ? (SCRIPT_AUTOMATION.execution.script ?? "")
                : ""
            }
          />
        </div>
      </StoryRow>
    </StoryCard>
  );
}

export function RunStates() {
  return (
    <StoryCard>
      {[PROJECT_AUTOMATION, SCRIPT_AUTOMATION].flatMap((value) =>
        runsFor(value, ["running", "succeeded", "failed", "skipped"]).map(
          (run) => (
            <StoryRow key={run.id} label={`${run.runMode} · ${run.status}`}>
              <div className="w-full max-w-2xl">
                <RunRow run={run} onOpenThread={noop} />
              </div>
            </StoryRow>
          ),
        ),
      )}
    </StoryCard>
  );
}

const automationMenuItems = [
  { label: "Run now", icon: "Play" as const, onSelect: noop },
  { kind: "separator" as const },
  {
    label: "Delete",
    icon: "Trash2" as const,
    tone: "destructive" as const,
    onSelect: noop,
  },
];

export function ControlStates() {
  return (
    <StoryCard>
      <StoryRow
        label="Active"
        hint="A recurring or future one-time automation is enabled."
      >
        <AutomationLifecycleControl
          checked
          label="Pause automation"
          onCheckedChange={noop}
        />
      </StoryRow>
      <StoryRow
        label="Paused"
        hint="The automation is retained but will not run."
      >
        <AutomationLifecycleControl
          checked={false}
          label="Resume automation"
          onCheckedChange={noop}
        />
      </StoryRow>
      <StoryRow
        label="Lifecycle pending"
        hint="An automation mutation is in flight."
      >
        <AutomationLifecycleControl
          checked
          disabled
          label="Pause automation"
          onCheckedChange={noop}
        />
      </StoryRow>
      <StoryRow
        label="Completed one-time"
        hint="The schedule is terminal; focus or hover the disabled switch for the reason."
      >
        <AutomationLifecycleControl
          checked={false}
          disabled
          disabledReason="This one-time automation has completed. Edit it to schedule another run."
          label="Completed automation"
          onCheckedChange={noop}
        />
      </StoryRow>
      <StoryRow
        label="Expired one-time"
        hint="The scheduled time passed without a completed run."
      >
        <AutomationLifecycleControl
          checked={false}
          disabled
          disabledReason="This one-time automation expired. Edit it to schedule another run."
          label="Expired automation"
          onCheckedChange={noop}
        />
      </StoryRow>
      <StoryRow
        label="Create"
        hint="Starts a blank chat-authored automation or opens the example menu."
      >
        <ResourceCreateButton
          label="New automation"
          templates={AUTOMATION_CREATE_TEMPLATES}
          onCreate={noop}
        />
      </StoryRow>
      <StoryRow
        label="Edit"
        hint="Contextual action attached to the Prompt or Script section."
      >
        <ResourceActionButton
          label="Edit with chat"
          tooltipLabel="Edit with chat"
          icon="Edit"
          onClick={noop}
        />
      </StoryRow>
      <StoryRow label="Edit loading" hint="The section action is in flight.">
        <ResourceActionButton
          label="Editing with chat"
          tooltipLabel="Editing with chat"
          icon="Edit"
          loading
          onClick={noop}
        />
      </StoryRow>
      <StoryRow
        label="Edit unavailable"
        hint="The action remains discoverable and explains why it cannot run."
      >
        <ResourceActionButton
          label="Edit with chat"
          icon="Edit"
          disabled
          disabledReason="No writable automation source"
          onClick={noop}
        />
      </StoryRow>
      <StoryRow
        label="Actions"
        hint="Run now and Delete live in the automation ownership menu."
      >
        <ResourceOverflowMenu
          label="Automation actions"
          items={automationMenuItems}
        />
      </StoryRow>
      <StoryRow
        label="Actions pending"
        hint="The menu is disabled while another automation action is pending."
      >
        <ResourceOverflowMenu
          label="Automation actions pending"
          disabled
          items={automationMenuItems}
        />
      </StoryRow>
      <StoryRow
        label="Run now"
        hint="The empty Runs state offers the manual action inline."
      >
        <Button type="button" variant="outline" size="sm" onClick={noop}>
          <Icon name="Play" className="size-3.5" aria-hidden />
          Run now
        </Button>
      </StoryRow>
      <StoryRow
        label="Run now pending"
        hint="Manual execution is unavailable while another action is pending."
      >
        <Button type="button" variant="outline" size="sm" disabled>
          <Icon name="Play" className="size-3.5" aria-hidden />
          Run now
        </Button>
      </StoryRow>
    </StoryCard>
  );
}
