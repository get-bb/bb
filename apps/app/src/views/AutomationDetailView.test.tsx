import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Automation, AutomationRun } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { AutomationDetailContent } from "./AutomationDetailView";

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

function renderContent(
  overrides: Partial<Parameters<typeof AutomationDetailContent>[0]>,
): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AutomationDetailContent
        automation={overrides.automation ?? makeAutomation()}
        runs={overrides.runs ?? []}
        runsLoading={overrides.runsLoading ?? false}
        runsError={overrides.runsError ?? false}
        onPause={overrides.onPause ?? NOOP}
        onResume={overrides.onResume ?? NOOP}
        onRun={overrides.onRun ?? NOOP}
        onDelete={overrides.onDelete ?? NOOP}
        actionsPending={overrides.actionsPending ?? false}
      />
    </MemoryRouter>,
  );
}

describe("AutomationDetailContent", () => {
  it("renders the header with name, Script and API pills", () => {
    const markup = renderContent({ automation: makeAutomation() });
    expect(markup).toContain("Disk space watchdog");
    expect(markup).toContain(">Script<");
    expect(markup).toContain(">API<");
  });

  it("renders the config summary with schedule, execution, and environment", () => {
    const markup = renderContent({ automation: makeAutomation() });
    expect(markup).toContain("America/New_York");
    expect(markup).toContain("bash disk.sh");
    expect(markup).toContain("30s timeout");
    expect(markup).toContain("Personal workspace");
  });

  it("shows a Pause icon button for an enabled automation and Resume for a paused one", () => {
    const enabled = renderContent({
      automation: makeAutomation({ enabled: true }),
    });
    expect(enabled).toContain('aria-label="Pause"');
    expect(enabled).toContain('data-icon="Pause"');
    expect(enabled).not.toContain('aria-label="Resume"');

    const paused = renderContent({
      automation: makeAutomation({ enabled: false }),
    });
    expect(paused).toContain('aria-label="Resume"');
    expect(paused).toContain('data-icon="Play"');
    expect(paused).not.toContain('aria-label="Pause"');
  });

  it("renders Run now and Delete icon actions", () => {
    const markup = renderContent({ automation: makeAutomation() });
    expect(markup).toContain('aria-label="Run now"');
    expect(markup).toContain('data-icon="Zap"');
    expect(markup).toContain('aria-label="Delete automation"');
    expect(markup).toContain('data-icon="Trash2"');
  });

  it("renders a succeeded script run with its captured output and exit code", () => {
    const markup = renderContent({
      runs: [makeRun()],
    });
    expect(markup).toContain("Succeeded");
    expect(markup).toContain("Disk at 92%");
    expect(markup).toContain("exit 0");
  });

  it("renders a failed run with its error output", () => {
    const markup = renderContent({
      runs: [
        makeRun({
          id: "run_fail",
          status: "failed",
          output: null,
          error: "df: /xyz: No such file or directory",
          exitCode: 1,
        }),
      ],
    });
    expect(markup).toContain("Failed");
    expect(markup).toContain("df: /xyz: No such file or directory");
    expect(markup).toContain("exit 1");
    expect(markup).toContain("text-destructive");
  });

  it("marks a silent succeeded script run", () => {
    const markup = renderContent({
      runs: [makeRun({ id: "run_silent", output: null })],
    });
    expect(markup).toContain("Succeeded · silent");
    expect(markup).toContain("silent gate");
  });

  it("links agent runs to their thread", () => {
    const markup = renderContent({
      automation: makeAutomation({
        execution: {
          mode: "agent",
          prompt: "Summarize merged PRs.",
          providerId: "codex",
          model: "gpt-5",
          permissionMode: "readonly",
        },
      }),
      runs: [
        makeRun({
          id: "run_agent",
          runMode: "agent",
          threadId: "thr_run",
          output: null,
          exitCode: null,
        }),
      ],
    });
    expect(markup).toContain('href="/threads/thr_run"');
    expect(markup).toContain("View thread");
  });

  it("shows a skip reason for skipped runs", () => {
    const markup = renderContent({
      runs: [
        makeRun({
          id: "run_skip",
          status: "skipped",
          output: null,
          exitCode: null,
          skipReason: "wakeAgent gate returned false",
        }),
      ],
    });
    expect(markup).toContain("Skipped");
    expect(markup).toContain("wakeAgent gate returned false");
  });

  it("shows the empty run-history state", () => {
    const markup = renderContent({ runs: [] });
    expect(markup).toContain("No runs yet.");
  });

  it("shows a loading run-history state", () => {
    const markup = renderContent({ runs: [], runsLoading: true });
    expect(markup).toContain("Loading...");
    expect(markup).not.toContain("No runs yet.");
  });

  it("shows a destructive run-history error state", () => {
    const markup = renderContent({ runs: [], runsError: true });
    expect(markup).toContain("Failed to load runs.");
    expect(markup).toContain("text-destructive");
  });
});
