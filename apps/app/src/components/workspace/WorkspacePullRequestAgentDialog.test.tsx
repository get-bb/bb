// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/promptbox/ExecutionControls", () => ({
  ExecutionControls: () => <div>agent controls</div>,
}));

import { WorkspacePullRequestAgentDialog } from "./WorkspacePullRequestAgentDialog";
import type { WorkspacePullRequestAgentConfig } from "./WorkspacePullRequestAgentDialog";

afterEach(() => {
  vi.clearAllMocks();
});

const agentConfig: WorkspacePullRequestAgentConfig = {
  execution: {
    provider: {
      options: [{ value: "codex", label: "Codex" }],
      selectedId: "codex",
      hasMultiple: false,
    },
    model: {
      active: { model: "gpt-5" },
      selected: "gpt-5",
      options: [{ value: "gpt-5", label: "GPT-5" }],
      moreOptions: [],
      isLoading: false,
      loadFailed: false,
      onChange: vi.fn(),
    },
    reasoning: {
      value: "medium",
      options: [{ value: "medium", label: "Medium" }],
      onChange: vi.fn(),
    },
  },
  executionInputSources: {},
  model: "gpt-5",
  permissionMode: "full",
  providerId: "codex",
  reasoningLevel: "medium",
  serviceTier: "default",
};

describe("WorkspacePullRequestAgentDialog", () => {
  it("submits the edited prompt and selected agent", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <WorkspacePullRequestAgentDialog
        agentConfig={agentConfig}
        isSubmitting={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Create a draft pull request and return its URL." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start agent" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        executionInputSources: {},
        model: "gpt-5",
        permissionMode: "full",
        prompt: "Create a draft pull request and return its URL.",
        providerId: "codex",
        reasoningLevel: "medium",
        serviceTier: "default",
      });
    });
  });
});
