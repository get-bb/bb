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

  it("renders the model as a static label when onChange is omitted (locked model)", () => {
    const { wrapper } = createQueryClientTestHarness();

    render(
      <ExecutionControls
        provider={{
          selectedId: "codex",
          hasMultiple: false,
        }}
        model={{
          active: { model: "gpt-5.5" },
          selected: "gpt-5.5",
          options: [],
        }}
      />,
      { wrapper },
    );

    // No interactive model/reasoning picker; the inherited model renders as a
    // read-only, formatted label.
    expect(
      screen.queryByRole("button", {
        name: "Provider, model and reasoning",
      }),
    ).toBeNull();
    // Rendered in both the full + compact label spans (CSS shows one per width).
    expect(screen.getAllByText("GPT-5.5").length).toBeGreaterThan(0);
  });

  it("renders the selected provider load error when locked single-provider controls have no picker", () => {
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
          hasMultiple: false,
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

    expect(
      screen.queryByRole("button", { name: "Provider, model and reasoning" }),
    ).toBeNull();
    const link = screen.getByRole("link", { name: "Codex CLI" });
    expect(link.getAttribute("href")).toBe(CODEX_CLI_URL);
  });
});
