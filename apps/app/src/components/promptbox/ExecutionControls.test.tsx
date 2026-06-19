// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  ExecutionControls,
  type ExecutionControlsProps,
} from "./ExecutionControls";

function makeExecutionControlsProps(
  providerOnChange?: (value: string) => void,
): ExecutionControlsProps {
  return {
    provider: {
      options: [
        { value: "codex", label: "Codex" },
        { value: "claude", label: "Claude Code" },
      ],
      selectedId: "codex",
      onChange: providerOnChange,
      hasMultiple: true,
    },
    model: {
      active: null,
      selected: "gpt-5",
      options: [{ value: "gpt-5", label: "GPT-5" }],
      moreOptions: [],
      isLoading: false,
      loadFailed: false,
      loadError: null,
      onChange: vi.fn(),
    },
    reasoning: {
      value: "medium",
      options: [{ value: "medium", label: "Medium" }],
      onChange: vi.fn(),
    },
  };
}

function renderExecutionControls(props: ExecutionControlsProps) {
  const { wrapper } = createQueryClientTestHarness();
  return render(<ExecutionControls {...props} />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExecutionControls", () => {
  it("hides provider tabs when the provider is locked", () => {
    renderExecutionControls(makeExecutionControlsProps());

    fireEvent.click(
      screen.getByRole("button", {
        name: "Provider, model and reasoning",
      }),
    );

    expect(screen.queryByText("Model")).not.toBeNull();
    expect(screen.queryByTitle("Claude Code")).toBeNull();
  });

  it("shows provider tabs when provider changes are allowed", () => {
    renderExecutionControls(makeExecutionControlsProps(vi.fn()));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Provider, model and reasoning",
      }),
    );

    expect(screen.queryByTitle("Claude Code")).not.toBeNull();
  });
});
