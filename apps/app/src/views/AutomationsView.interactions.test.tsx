// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Automation } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  AutomationsOverview,
  type AutomationRowActions,
} from "./AutomationsView";

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto_test",
    projectId: PERSONAL_PROJECT_ID,
    name: "Daily standup digest",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "0 9 * * 1-5",
      timezone: "America/Los_Angeles",
    },
    execution: {
      mode: "agent",
      prompt: "Summarize updates.",
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

describe("AutomationsOverview interactions", () => {
  afterEach(cleanup);

  it("closes the row actions menu after selecting delete", async () => {
    const automation = makeAutomation();
    const actions: AutomationRowActions = {
      onPause: vi.fn(),
      onResume: vi.fn(),
      onRun: vi.fn(),
      onDelete: vi.fn(),
    };

    render(
      <MemoryRouter>
        <AutomationsOverview
          entries={[
            {
              automation,
              project: { id: PERSONAL_PROJECT_ID, name: "Personal" },
            },
          ]}
          isLoading={false}
          hasInitialLoadError={false}
          actions={actions}
          onCreateAutomation={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Daily standup digest actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(actions.onDelete).toHaveBeenCalledWith({
      automation,
      project: { id: PERSONAL_PROJECT_ID, name: "Personal" },
    });
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    });
  });
});
