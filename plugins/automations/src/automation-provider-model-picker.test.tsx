// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import type { AgentExecutionUpdate, AutomationResponse } from "./rpc-types.js";

installTestPluginRuntime();

const { AutomationDetailView } = await import("../detail-view.js");

afterEach(cleanup);

const automation: AutomationResponse = {
  id: "auto_test",
  projectId: "proj_test",
  name: "Digest",
  enabled: true,
  trigger: { triggerType: "schedule", cron: "0 9 * * *", timezone: "UTC" },
  execution: {
    mode: "agent",
    prompt: "Summarize the inbox",
    providerId: "codex",
    model: "gpt-5.6-codex",
    reasoningLevel: "medium",
    permissionMode: "accept-edits",
    environment: { type: "reuse", environmentId: "env_test" },
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
};

describe("automation provider and model picker", () => {
  it("uses the standard editor to complete an automation with a missing prompt", () => {
    if (automation.execution.mode !== "agent") {
      throw new Error("Expected an agent automation fixture");
    }
    const onUpdate = vi.fn(async (_update: AgentExecutionUpdate) => {});
    render(
      <AutomationDetailView
        automation={{
          ...automation,
          execution: { ...automation.execution, prompt: "" },
        }}
        projectLabel="Test project"
        runsState={{
          runs: [],
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: null,
          loadMore: vi.fn(),
          retry: vi.fn(),
        }}
        actionPending={false}
        editing
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onUpdateAgent={onUpdate}
        onRunNow={vi.fn()}
        onDelete={vi.fn()}
        onOpenThread={vi.fn()}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "Edit prompt" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Run now" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const save = screen.getByRole("button", { name: "Save Prompt" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Automation prompt"), {
      target: { value: "Review the failed build" },
    });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    expect(onUpdate).toHaveBeenCalledWith({
      prompt: "Review the failed build",
      providerId: "codex",
      model: "gpt-5.6-codex",
      reasoningLevel: "medium",
      serviceTier: null,
      permissionMode: "accept-edits",
    });
  });

  it("persists the host picker's coherent tuple and reconciles permissions", () => {
    const onUpdate = vi.fn(async (_update: AgentExecutionUpdate) => {});
    render(
      <AutomationDetailView
        automation={automation}
        projectLabel="Test project"
        runsState={{
          runs: [],
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: null,
          loadMore: vi.fn(),
          retry: vi.fn(),
        }}
        actionPending={false}
        editing
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onUpdateAgent={onUpdate}
        onRunNow={vi.fn()}
        onDelete={vi.fn()}
        onOpenThread={vi.fn()}
      />,
    );

    const picker = screen.getByTestId("bb-provider-model-picker");
    expect(picker.getAttribute("data-routing-kind")).toBe("environment");
    expect(picker.getAttribute("data-routing-id")).toBe("env_test");
    expect(picker.getAttribute("data-provider-change-allowed")).toBe("true");
    fireEvent.change(screen.getByLabelText("Provider ID"), {
      target: { value: "claude" },
    });
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "claude-opus-5" },
    });
    fireEvent.change(screen.getByLabelText("Reasoning level"), {
      target: { value: "ultra" },
    });
    fireEvent.change(screen.getByLabelText("Service tier"), {
      target: { value: "fast" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply execution selection" }),
    );
    const permission = screen.getByLabelText("Permission mode");
    expect(permission.getAttribute("data-provider-id")).toBe("claude");
    expect(permission.getAttribute("data-routing-kind")).toBe("environment");
    fireEvent.change(permission, { target: { value: "auto" } });
    fireEvent.click(screen.getByText("Save Prompt"));

    expect(onUpdate).toHaveBeenCalledWith({
      prompt: "Summarize the inbox",
      providerId: "claude",
      model: "claude-opus-5",
      reasoningLevel: "ultra",
      serviceTier: "fast",
      permissionMode: "auto",
    });
  });
});
