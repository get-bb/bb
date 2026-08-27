// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationsOverviewResponse } from "./rpc-types.js";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_PermissionModePicker: () => null,
  experimental_ProviderModelPicker: () => null,
}));

import { AutomationOverviewView } from "../overview-view.js";

afterEach(cleanup);

const missingPromptEntry: AutomationsOverviewResponse["automations"][number] = {
  automation: {
    id: "auto_missing_prompt",
    projectId: "proj_test",
    name: "Daily digest",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "0 9 * * *",
      timezone: "UTC",
    },
    execution: {
      mode: "agent",
      prompt: "",
      providerId: "codex",
      model: "gpt-5.6-codex",
      reasoningLevel: "medium",
      permissionMode: "accept-edits",
      environment: { type: "project-default" },
    },
    origin: "human",
    createdByThreadId: null,
    nextRunAt: Date.now() + 60_000,
    lastRunAt: null,
    runCount: 0,
    lastRunStatus: null,
    lastRunThreadId: null,
    lastError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    problem: "missing-agent-prompt",
  },
  project: { id: "proj_test", name: "Test project" },
};

const invalidEntry: AutomationsOverviewResponse["automations"][number] = {
  automation: {
    id: "auto_invalid",
    projectId: "proj_test",
    name: "Unreadable automation",
    problem: "invalid-stored-data",
  },
  project: { id: "proj_test", name: "Test project" },
};

describe("automation overview recovery rows", () => {
  it("searches displayed problem labels and keeps repairable rows in status filters", () => {
    render(
      <AutomationOverviewView
        entries={[missingPromptEntry, invalidEntry]}
        error={null}
        onRetry={vi.fn()}
        onOpenDetail={vi.fn()}
        onEnabledChange={vi.fn(async () => {})}
        onCreateViaChat={vi.fn()}
        activeMode="installed"
        onModeChange={vi.fn()}
      />,
    );

    expect(screen.getByText("9AM")).toBeTruthy();
    const search = screen.getByPlaceholderText("Search automations");
    fireEvent.change(search, { target: { value: "Prompt required" } });
    expect(screen.getByText("Daily digest")).toBeTruthy();
    expect(screen.queryByText("Unreadable automation")).toBeNull();

    fireEvent.change(search, { target: { value: "Invalid data" } });
    expect(screen.queryByText("Daily digest")).toBeNull();
    expect(screen.getByText("Unreadable automation")).toBeTruthy();

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", {
        name: "Active",
      }),
    );
    expect(screen.getByText("Daily digest")).toBeTruthy();
    expect(screen.queryByText("Unreadable automation")).toBeNull();
  });
});
