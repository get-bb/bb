import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Automation, AutomationRun } from "@bb/server-contract";
import { PROJECT_IDS } from "../../.ladle/story-fixtures";
import { AutomationDetailContent } from "./AutomationDetailView";

export default {
  title: "Automations / Detail",
};

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto_watchdog",
    projectId: PERSONAL_PROJECT_ID,
    name: "Disk space watchdog",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "*/15 * * * *",
      timezone: "America/New_York",
    },
    execution: {
      mode: "script",
      scriptFile: "disk.sh",
      interpreter: "bash",
      timeoutMs: 30_000,
    },
    environment: { type: "host", workspace: { type: "personal" } },
    autoArchive: false,
    origin: "agent",
    createdByThreadId: "thr_8x",
    nextRunAt: 1_700_003_600_000,
    lastRunAt: 1_700_000_000_000,
    runCount: 3,
    lastRunStatus: "succeeded",
    lastRunThreadId: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 100,
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run_1",
    automationId: "auto_watchdog",
    runMode: "script",
    threadId: null,
    status: "succeeded",
    trigger: "schedule",
    skipReason: null,
    error: null,
    output: "Disk at 92%",
    exitCode: 0,
    scheduledFor: 1_700_000_000_000,
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_000_300,
    ...overrides,
  };
}

const NOOP = () => {};

const scriptRuns: AutomationRun[] = [
  makeRun(),
  makeRun({ id: "run_silent", output: null, startedAt: 1_699_999_100_000 }),
  makeRun({
    id: "run_fail",
    status: "failed",
    output: null,
    error: "df: /xyz: No such file or directory",
    exitCode: 1,
    startedAt: 1_699_998_200_000,
  }),
];

const agentAutomation = makeAutomation({
  id: "auto_digest",
  name: "Daily standup digest",
  projectId: PROJECT_IDS.bb,
  origin: "agent",
  execution: {
    mode: "agent",
    prompt: "Summarize yesterday's merged PRs and post the digest.",
    providerId: "codex",
    model: "gpt-5",
    permissionMode: "readonly",
  },
  trigger: {
    triggerType: "schedule",
    cron: "0 9 * * 1-5",
    timezone: "America/New_York",
  },
});

const agentRuns: AutomationRun[] = [
  makeRun({
    id: "run_agent",
    runMode: "agent",
    threadId: "thr_digest",
    output: null,
    exitCode: null,
  }),
  makeRun({
    id: "run_skip",
    runMode: "agent",
    status: "skipped",
    output: null,
    exitCode: null,
    skipReason: "Nothing merged since the last run.",
    startedAt: 1_699_999_000_000,
  }),
];

function Story(props: Partial<Parameters<typeof AutomationDetailContent>[0]>) {
  return (
    <main className="flex h-screen min-w-0 flex-col p-4 md:p-5">
      <AutomationDetailContent
        automation={props.automation ?? makeAutomation()}
        runs={props.runs ?? scriptRuns}
        runsLoading={props.runsLoading ?? false}
        runsError={props.runsError ?? false}
        onPause={NOOP}
        onResume={NOOP}
        onRun={NOOP}
        onDelete={NOOP}
        actionsPending={props.actionsPending ?? false}
      />
    </main>
  );
}

export function ScriptAutomation() {
  return <Story />;
}

export function AgentAutomation() {
  return <Story automation={agentAutomation} runs={agentRuns} />;
}

export function Paused() {
  return <Story automation={makeAutomation({ enabled: false })} />;
}

export function NoRuns() {
  return <Story runs={[]} />;
}

export function RunsLoading() {
  return <Story runs={[]} runsLoading />;
}

export function RunsError() {
  return <Story runs={[]} runsError />;
}
