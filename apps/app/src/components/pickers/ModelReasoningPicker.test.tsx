// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AvailableModel, ReasoningLevel } from "@bb/domain";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { systemExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  buildFuzzyRegex,
  buildModelNavRows,
  ModelReasoningPicker,
} from "./ModelReasoningPicker";
import type { PickerOption } from "./OptionPicker";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getSystemExecutionOptions: vi.fn(),
  };
});

const providerOptions: readonly PickerOption<string>[] = [
  { value: "codex", label: "Codex" },
  { value: "claude-code", label: "Claude Code" },
];

const codexModels: readonly PickerOption<string>[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
];

// A list long enough (> MODEL_SEARCH_MIN_OPTIONS) to render the search box.
const manyCodexModels: readonly PickerOption<string>[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "o3", label: "o3" },
  { value: "o4-mini", label: "o4-mini" },
  { value: "sonnet-in-codex", label: "Sonnet" },
];

const reasoningOptions: readonly PickerOption<ReasoningLevel>[] = [
  { value: "medium", label: "Medium" },
];

function availableModel({
  value,
  label,
  isDefault = false,
}: {
  value: string;
  label: string;
  isDefault?: boolean;
}): AvailableModel {
  return {
    id: value,
    model: value,
    displayName: label,
    description: "",
    supportedReasoningEfforts: [
      { reasoningEffort: "medium", description: "Medium" },
    ],
    defaultReasoningEffort: "medium",
    isDefault,
  };
}

function executionOptions({
  models,
  selectedOnlyModels = [],
}: {
  models: AvailableModel[];
  selectedOnlyModels?: AvailableModel[];
}): SystemExecutionOptionsResponse {
  return {
    providers: [],
    models,
    selectedOnlyModels,
    modelLoadError: null,
  };
}

function renderPicker({
  onSelectedProviderChange = vi.fn(),
  onModelChange = vi.fn(),
  modelOptions = codexModels,
  moreModelOptions = [],
}: {
  onSelectedProviderChange?: (value: string) => void;
  onModelChange?: (value: string) => void;
  modelOptions?: readonly PickerOption<string>[];
  moreModelOptions?: readonly PickerOption<string>[];
} = {}) {
  const { queryClient, wrapper } = createQueryClientTestHarness();
  queryClient.setQueryData(
    systemExecutionOptionsQueryKey({
      environmentId: null,
      providerId: "claude-code",
    }),
    executionOptions({
      models: [
        availableModel({
          value: "claude-opus-4-7",
          label: "Claude Opus 4.7",
          isDefault: true,
        }),
      ],
    }),
  );

  render(
    <ModelReasoningPicker
      providerOptions={providerOptions}
      selectedProviderId="codex"
      onSelectedProviderChange={onSelectedProviderChange}
      hasMultipleProviders
      modelValue="gpt-5.5"
      modelOptions={modelOptions}
      moreModelOptions={moreModelOptions}
      onModelChange={onModelChange}
      reasoningValue="medium"
      reasoningOptions={reasoningOptions}
      onReasoningChange={vi.fn()}
      fastModeEnabled={false}
      onFastModeChange={vi.fn()}
      showFastModeToggle={false}
      modal={false}
    />,
    { wrapper },
  );

  return { onSelectedProviderChange, onModelChange };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ModelReasoningPicker", () => {
  it("previews another provider's models without committing the provider", async () => {
    const { onSelectedProviderChange, onModelChange } = renderPicker();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Provider, model and reasoning",
      }),
    );
    expect(screen.getAllByText("5.5")).toHaveLength(2);

    fireEvent.click(screen.getByTitle("Claude Code"));

    expect(await screen.findByText("Opus 4.7")).not.toBeNull();
    expect(screen.getAllByText("5.5")).toHaveLength(1);
    expect(onSelectedProviderChange).not.toHaveBeenCalled();
    expect(onModelChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Opus 4.7"));

    expect(onSelectedProviderChange).toHaveBeenCalledWith("claude-code");
    expect(onModelChange).toHaveBeenCalledWith("claude-opus-4-7");
  });

  it("opens selected-only models in a desktop submenu", async () => {
    const { onModelChange } = renderPicker({
      moreModelOptions: [{ value: "gpt-5.2", label: "GPT-5.2" }],
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Provider, model and reasoning",
      }),
    );
    fireEvent.pointerEnter(screen.getByText("More models"));

    fireEvent.click(await screen.findByText("5.2"));

    expect(onModelChange).toHaveBeenCalledWith("gpt-5.2");
  });

  it("fuzzy-filters a long model list and selects the match by keyboard", () => {
    const { onModelChange } = renderPicker({ modelOptions: manyCodexModels });

    fireEvent.click(
      screen.getByRole("button", { name: "Provider, model and reasoning" }),
    );

    const search = screen.getByPlaceholderText("Search models");
    fireEvent.change(search, { target: { value: "o4" } });

    // Only the fuzzy match survives; unrelated models are filtered out.
    expect(screen.getByText("o4-mini")).not.toBeNull();
    expect(screen.queryByText("Sonnet")).toBeNull();

    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onModelChange).toHaveBeenCalledWith("o4-mini");
  });

  it("reaches selected-only models by keyboard once a search flattens them", () => {
    const { onModelChange } = renderPicker({
      modelOptions: manyCodexModels,
      moreModelOptions: [{ value: "gpt-4.1-legacy", label: "GPT-4.1 Legacy" }],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Provider, model and reasoning" }),
    );

    // On desktop the extra models normally hide in a hover submenu; searching
    // flattens them inline so the keyboard can reach them.
    const search = screen.getByPlaceholderText("Search models");
    fireEvent.change(search, { target: { value: "legacy" } });

    expect(screen.getByText("4.1 Legacy")).not.toBeNull();

    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onModelChange).toHaveBeenCalledWith("gpt-4.1-legacy");
  });

  it("does not render the search box for short model lists", () => {
    renderPicker();

    fireEvent.click(
      screen.getByRole("button", { name: "Provider, model and reasoning" }),
    );

    expect(screen.queryByPlaceholderText("Search models")).toBeNull();
  });
});

describe("buildModelNavRows", () => {
  const primary: readonly PickerOption<string>[] = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ];
  const more: readonly PickerOption<string>[] = [{ value: "c", label: "C" }];

  it("keeps desktop extra models out of keyboard nav (submenu-driven)", () => {
    const rows = buildModelNavRows({
      modelOptions: primary,
      moreModelOptions: more,
      isCompactViewport: false,
      isSearching: false,
      showMoreModels: false,
    });

    expect(rows).toEqual([
      { kind: "model", option: primary[0] },
      { kind: "model", option: primary[1] },
    ]);
  });

  it("flattens extra models inline while searching, on any viewport", () => {
    for (const isCompactViewport of [false, true]) {
      const rows = buildModelNavRows({
        modelOptions: primary,
        moreModelOptions: more,
        isCompactViewport,
        isSearching: true,
        showMoreModels: false,
      });

      expect(rows).toEqual([
        { kind: "model", option: primary[0] },
        { kind: "model", option: primary[1] },
        { kind: "model", option: more[0] },
      ]);
    }
  });

  it("compact: a toggle precedes the extra models and only lists them when expanded", () => {
    const collapsed = buildModelNavRows({
      modelOptions: primary,
      moreModelOptions: more,
      isCompactViewport: true,
      isSearching: false,
      showMoreModels: false,
    });
    expect(collapsed.map((row) => row.kind)).toEqual([
      "model",
      "model",
      "more-toggle",
    ]);

    const expanded = buildModelNavRows({
      modelOptions: primary,
      moreModelOptions: more,
      isCompactViewport: true,
      isSearching: false,
      showMoreModels: true,
    });
    expect(expanded.map((row) => row.kind)).toEqual([
      "model",
      "model",
      "more-toggle",
      "model",
    ]);
  });

  it("omits the toggle entirely when there are no extra models", () => {
    const rows = buildModelNavRows({
      modelOptions: primary,
      moreModelOptions: [],
      isCompactViewport: true,
      isSearching: false,
      showMoreModels: true,
    });

    expect(rows).toEqual([
      { kind: "model", option: primary[0] },
      { kind: "model", option: primary[1] },
    ]);
  });
});

describe("buildFuzzyRegex", () => {
  it("matches subsequences case-insensitively", () => {
    expect(buildFuzzyRegex("gpt4").test("GPT-4 Turbo")).toBe(true);
    expect(buildFuzzyRegex("o4m").test("o4-mini")).toBe(true);
    expect(buildFuzzyRegex("xyz").test("o4-mini")).toBe(false);
  });

  it("escapes regex metacharacters so they match literally", () => {
    expect(buildFuzzyRegex("5.2").test("5.2")).toBe(true);
    // The dot is literal, so it must not match an arbitrary character.
    expect(buildFuzzyRegex("5.2").test("512")).toBe(false);
  });
});
