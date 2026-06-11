// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ExecutionControls } from "./ExecutionControls";

const CODEX_CLI_URL = "https://developers.openai.com/codex/cli";

afterEach(() => {
  cleanup();
});

describe("ExecutionControls", () => {
  it("keeps the picker reachable and renders model load errors when multiple providers have no models", () => {
    const loadError: SystemExecutionOptionsModelLoadError = {
      providerId: "codex",
      code: "missing_executable",
    };
    const { wrapper } = createQueryClientTestHarness();

    render(
      <ExecutionControls
        provider={{
          options: [
            { value: "codex", label: "Codex" },
            { value: "pi", label: "Pi" },
          ],
          selectedId: "codex",
          onChange: vi.fn(),
          hasMultiple: true,
          displayName: "Codex",
        }}
        model={{
          active: null,
          selected: "",
          options: [],
          loadError,
          onChange: vi.fn(),
        }}
        reasoning={{
          value: "medium",
          options: [],
          onChange: vi.fn(),
        }}
      />,
      { wrapper },
    );

    const picker = screen.getByRole("button", { name: "Provider, model and reasoning" });
    expect(picker.textContent).toContain("Select model");

    fireEvent.click(picker);

    const link = screen.getByRole("link", { name: "Codex CLI" });
    expect(link.getAttribute("href")).toBe(CODEX_CLI_URL);
  });

  it("renders the selected provider load error when editable single-provider controls have no picker", () => {
    const loadError: SystemExecutionOptionsModelLoadError = {
      providerId: "codex",
      code: "missing_executable",
    };
    const { wrapper } = createQueryClientTestHarness();

    render(
      <ExecutionControls
        provider={{
          options: [{ value: "codex", label: "Codex" }],
          selectedId: "codex",
          onChange: vi.fn(),
          hasMultiple: false,
        }}
        model={{
          active: null,
          selected: "",
          options: [],
          loadError,
          onChange: vi.fn(),
        }}
        reasoning={{
          value: "medium",
          options: [],
          onChange: vi.fn(),
        }}
      />,
      { wrapper },
    );

    expect(
      screen.queryByRole("button", { name: "Provider, model and reasoning" }),
    ).toBeNull();
    const link = screen.getByRole("link", { name: "Codex CLI" });
    expect(link.getAttribute("href")).toBe(CODEX_CLI_URL);
  });

  it("renders a disabled model/reasoning picker showing the inherited model when disabled", () => {
    const { wrapper } = createQueryClientTestHarness();
    const onModelChange = vi.fn();

    render(
      <ExecutionControls
        disabled
        provider={{
          options: [{ value: "codex", label: "Codex" }],
          selectedId: "codex",
          hasMultiple: false,
        }}
        model={{
          active: { model: "gpt-5.5" },
          selected: "gpt-5.5",
          options: [{ value: "gpt-5.5", label: "GPT-5.5" }],
          onChange: onModelChange,
        }}
        reasoning={{
          value: "medium",
          options: [{ value: "medium", label: "Medium" }],
          onChange: vi.fn(),
        }}
      />,
      { wrapper },
    );

    // The SAME picker the interactive surface renders, but disabled: the
    // trigger button is present yet non-interactive, and clicking it opens no
    // menu and never fires onChange.
    const picker = screen.getByRole("button", {
      name: "Provider, model and reasoning",
    });
    expect(picker.hasAttribute("disabled")).toBe(true);
    // Shows the inherited model label (brand prefix stripped) in the same spot
    // the interactive picker would.
    expect(picker.textContent).toContain("5.5");

    fireEvent.click(picker);
    expect(screen.queryByText("Reasoning")).toBeNull();
    expect(onModelChange).not.toHaveBeenCalled();
  });
});
