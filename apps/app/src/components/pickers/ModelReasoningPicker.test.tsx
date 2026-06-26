// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AvailableModel, ReasoningLevel } from "@bb/domain";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { systemExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ModelReasoningPicker } from "./ModelReasoningPicker";
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
  moreModelOptions = [],
}: {
  onSelectedProviderChange?: (value: string) => void;
  onModelChange?: (value: string) => void;
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
      modelOptions={codexModels}
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
});
