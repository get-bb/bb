import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Automation } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  AutomationsOverview,
  type AutomationsOverviewProps,
} from "./AutomationsView";

interface AutomationOverviewEntry {
  automation: Automation;
  project: { id: string; name: string };
}

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto_demo",
    projectId: PERSONAL_PROJECT_ID,
    name: "Daily standup digest",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "0 9 * * 1-5",
      timezone: "America/New_York",
    },
    execution: {
      mode: "agent",
      prompt: "Summarize merged PRs.",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "readonly",
    },
    environment: { type: "host", workspace: { type: "personal" } },
    autoArchive: false,
    origin: "human",
    createdByThreadId: null,
    nextRunAt: 1_700_003_600_000,
    lastRunAt: null,
    runCount: 0,
    lastRunStatus: null,
    lastRunThreadId: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 100,
    ...overrides,
  };
}

function makeEntry(
  automation: Automation,
  project: { id: string; name: string } = {
    id: PERSONAL_PROJECT_ID,
    name: "Personal",
  },
): AutomationOverviewEntry {
  return { automation, project };
}

const NOOP = () => {};

function renderOverview(
  props: Partial<AutomationsOverviewProps> & {
    entries: readonly AutomationOverviewEntry[];
  },
): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AutomationsOverview
        entries={props.entries}
        isLoading={props.isLoading ?? false}
        hasInitialLoadError={props.hasInitialLoadError ?? false}
        onCreateAgentAutomation={props.onCreateAgentAutomation ?? NOOP}
        onCreateScriptAutomation={props.onCreateScriptAutomation ?? NOOP}
      />
    </MemoryRouter>,
  );
}

describe("AutomationsOverview", () => {
  it("groups automations by status into Active and Paused sections", () => {
    const markup = renderOverview({
      entries: [
        makeEntry(makeAutomation({ id: "auto_active", name: "Active one" })),
        makeEntry(
          makeAutomation({
            id: "auto_paused",
            name: "Paused one",
            enabled: false,
            nextRunAt: null,
          }),
        ),
      ],
    });

    expect(markup).toContain(">Active<");
    expect(markup).toContain(">Paused<");
    expect(markup).toContain("Active one");
    expect(markup).toContain("Paused one");
    // Enabled automations render the next-run label; paused ones read "Paused".
    expect(markup).toContain("Next ");
  });

  it("renders the API badge only for agent-origin automations", () => {
    const apiMarkup = renderOverview({
      entries: [makeEntry(makeAutomation({ origin: "agent" }))],
    });
    expect(apiMarkup).toContain(">API<");

    const humanMarkup = renderOverview({
      entries: [makeEntry(makeAutomation({ origin: "human" }))],
    });
    expect(humanMarkup).not.toContain(">API<");

    const appMarkup = renderOverview({
      entries: [makeEntry(makeAutomation({ origin: "app" }))],
    });
    expect(appMarkup).not.toContain(">API<");
  });

  it("renders the Script badge only for script-mode automations", () => {
    const scriptMarkup = renderOverview({
      entries: [
        makeEntry(
          makeAutomation({
            execution: {
              mode: "script",
              scriptFile: "watchdog.sh",
              interpreter: "bash",
              timeoutMs: 30_000,
            },
          }),
        ),
      ],
    });
    expect(scriptMarkup).toContain(">Script<");

    const agentMarkup = renderOverview({
      entries: [makeEntry(makeAutomation())],
    });
    expect(agentMarkup).not.toContain(">Script<");
  });

  it("omits the personal project label and shows real project names", () => {
    const markup = renderOverview({
      entries: [
        makeEntry(
          makeAutomation({ id: "auto_personal", projectId: PERSONAL_PROJECT_ID }),
          { id: PERSONAL_PROJECT_ID, name: "Personal" },
        ),
        makeEntry(
          makeAutomation({ id: "auto_app", projectId: "proj_app" }),
          { id: "proj_app", name: "App" },
        ),
      ],
    });

    expect(markup).not.toContain(">Personal<");
    expect(markup).toContain(">App<");
  });

  it("shows the empty state when there are no automations", () => {
    const markup = renderOverview({ entries: [] });
    expect(markup).toContain("No automations yet.");
  });

  it("shows a muted loading state", () => {
    const markup = renderOverview({ entries: [], isLoading: true });
    expect(markup).toContain("Loading...");
    expect(markup).not.toContain("No automations yet.");
  });

  it("shows a destructive error state", () => {
    const markup = renderOverview({
      entries: [],
      hasInitialLoadError: true,
    });
    expect(markup).toContain("Failed to load automations.");
    expect(markup).toContain("text-destructive");
  });
});
