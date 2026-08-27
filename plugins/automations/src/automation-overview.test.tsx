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

const missingPromptEntry: AutomationsOverviewResponse["automations"][number] =
  {
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

describe("automation overview recovery rows", () => {
  it("makes a missing prompt prominent and routes Edit through the normal editor", () => {
    const onOpenDetail = vi.fn();

    render(
      <AutomationOverviewView
        entries={[missingPromptEntry]}
        error={null}
        onRetry={vi.fn()}
        onOpenDetail={onOpenDetail}
        onEnabledChange={vi.fn(async () => {})}
        onCreateViaChat={vi.fn()}
        activeMode="installed"
        onModeChange={vi.fn()}
      />,
    );

    const status = screen.getByText("Prompt required");
    expect(status.className).toContain("text-warning-text");

    const row = status.closest("[data-resource-row]");
    expect(row).not.toBeNull();
    expect(row?.className).toContain("items-start");
    expect(row?.className).not.toContain("opacity-60");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onOpenDetail).toHaveBeenCalledWith(
      {
        projectId: "proj_test",
        automationId: "auto_missing_prompt",
      },
      { editing: true },
    );
  });
});
