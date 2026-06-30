import { useState } from "react";
import type { ReasoningLevel } from "@bb/domain";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import { ModelReasoningPicker } from "./ModelReasoningPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  STORY_CLAUDE_CODE_MODELS,
  STORY_CLAUDE_CODE_MORE_MODELS,
  STORY_CLAUDE_REASONING,
  STORY_CODEX_MODELS,
  STORY_CODEX_REASONING,
  STORY_PI_MODELS,
  STORY_PROVIDER_OPTIONS,
  STORY_SERVICE_TIER_SUPPORT,
} from "../../../.ladle/story-fixtures";
import { ModelPickerStoryQueryProvider } from "../../../.ladle/model-picker-query-provider";

export default {
  title: "pickers/Model Reasoning Picker",
};

const noop = () => {};
const codexModelLoadError = {
  providerId: "codex",
  code: "failed",
} satisfies SystemExecutionOptionsModelLoadError;
const codexTimeoutModelLoadError = {
  providerId: "codex",
  code: "timeout",
} satisfies SystemExecutionOptionsModelLoadError;
const codexMissingCliModelLoadError = {
  providerId: "codex",
  code: "missing_executable",
} satisfies SystemExecutionOptionsModelLoadError;

const codexBase = {
  providerOptions: STORY_PROVIDER_OPTIONS,
  serviceTierSupportByProvider: STORY_SERVICE_TIER_SUPPORT,
  selectedProviderId: "codex",
  onSelectedProviderChange: noop,
  hasMultipleProviders: true,
  modelValue: "gpt-5.5",
  modelOptions: STORY_CODEX_MODELS,
  onModelChange: noop,
  reasoningValue: "medium" as ReasoningLevel,
  reasoningOptions: STORY_CODEX_REASONING,
  onReasoningChange: noop,
  fastModeEnabled: false,
  onFastModeChange: noop,
  showFastModeToggle: true,
};

const claudeBase = {
  ...codexBase,
  selectedProviderId: "claude-code",
  modelValue: "claude-sonnet-5",
  modelOptions: STORY_CLAUDE_CODE_MODELS,
  moreModelOptions: STORY_CLAUDE_CODE_MORE_MODELS,
  reasoningOptions: STORY_CLAUDE_REASONING,
  showFastModeToggle: false,
};

const MODEL_OPTIONS_BY_PROVIDER_ID: Record<
  string,
  readonly (typeof STORY_CODEX_MODELS)[number][]
> = {
  codex: STORY_CODEX_MODELS,
  "claude-code": STORY_CLAUDE_CODE_MODELS,
  pi: STORY_PI_MODELS,
};

const MORE_MODEL_OPTIONS_BY_PROVIDER_ID: Record<
  string,
  readonly (typeof STORY_CODEX_MODELS)[number][]
> = {
  codex: [],
  "claude-code": STORY_CLAUDE_CODE_MORE_MODELS,
  pi: [],
};

const REASONING_OPTIONS_BY_PROVIDER_ID: Record<
  string,
  readonly (typeof STORY_CODEX_REASONING)[number][]
> = {
  codex: STORY_CODEX_REASONING,
  "claude-code": STORY_CLAUDE_REASONING,
  pi: STORY_CODEX_REASONING,
};

export function Overview() {
  return (
    <ModelPickerStoryQueryProvider>
      <StoryCard>
        <StoryRow
          label="default"
          hint="codex selected, medium reasoning, fast mode supported"
        >
          <ModelReasoningPicker {...codexBase} />
        </StoryRow>
        <StoryRow label="muted" hint="prompt-box treatment">
          <ModelReasoningPicker {...codexBase} muted />
        </StoryRow>
        <StoryRow
          label="claude-code selected"
          hint="all five reasoning levels; no fast mode toggle"
        >
          <ModelReasoningPicker {...claudeBase} reasoningValue="max" />
        </StoryRow>
        <StoryRow label="fast mode active" hint="codex + fastModeEnabled">
          <ModelReasoningPicker {...codexBase} fastModeEnabled />
        </StoryRow>
        <StoryRow
          label="interactive"
          hint="provider tabs and model selection use seeded story data"
        >
          <ModelReasoningPickerInteractive />
        </StoryRow>
        <StoryRow
          label="loading models"
          hint="committed provider loading state"
        >
          <ModelReasoningPickerLoading />
        </StoryRow>
        <StoryRow label="open: no models" hint="successful empty model list">
          <ModelReasoningPickerOpenEmpty />
        </StoryRow>
        <StoryRow
          label="open: request failed"
          hint="generic failure; provider tabs hidden"
        >
          <ModelReasoningPickerOpenGenericLoadError />
        </StoryRow>
        <StoryRow
          label="open: provider failed"
          hint="provider-specific failure; provider tabs remain"
        >
          <ModelReasoningPickerOpenLoadError error={codexModelLoadError} />
        </StoryRow>
        <StoryRow label="open: timeout" hint="provider-specific timeout">
          <ModelReasoningPickerOpenLoadError
            error={codexTimeoutModelLoadError}
          />
        </StoryRow>
        <StoryRow
          label="open: missing CLI"
          hint="provider-specific Codex install help"
        >
          <ModelReasoningPickerOpenLoadError
            error={codexMissingCliModelLoadError}
          />
        </StoryRow>
      </StoryCard>
    </ModelPickerStoryQueryProvider>
  );
}

function ModelReasoningPickerInteractive() {
  const [selectedProviderId, setSelectedProviderId] = useState("codex");
  const modelOptions =
    MODEL_OPTIONS_BY_PROVIDER_ID[selectedProviderId] ?? STORY_CODEX_MODELS;
  const moreModelOptions =
    MORE_MODEL_OPTIONS_BY_PROVIDER_ID[selectedProviderId] ?? [];
  const reasoningOptions =
    REASONING_OPTIONS_BY_PROVIDER_ID[selectedProviderId] ??
    STORY_CODEX_REASONING;
  const [modelValue, setModelValue] = useState(modelOptions[0]?.value ?? "");
  const [reasoningValue, setReasoningValue] =
    useState<ReasoningLevel>("medium");
  return (
    <ModelReasoningPicker
      {...codexBase}
      selectedProviderId={selectedProviderId}
      onSelectedProviderChange={(providerId) => {
        setSelectedProviderId(providerId);
        const nextModels =
          MODEL_OPTIONS_BY_PROVIDER_ID[providerId] ?? STORY_CODEX_MODELS;
        setModelValue(nextModels[0]?.value ?? "");
      }}
      modelValue={modelValue}
      modelOptions={modelOptions}
      moreModelOptions={moreModelOptions}
      reasoningValue={reasoningValue}
      reasoningOptions={reasoningOptions}
      showFastModeToggle={
        STORY_SERVICE_TIER_SUPPORT[selectedProviderId] ?? false
      }
      onReasoningChange={setReasoningValue}
      modal={false}
    />
  );
}

function ModelReasoningPickerOpenEmpty() {
  return (
    <ModelReasoningPicker
      {...codexBase}
      modelValue=""
      modelOptions={[]}
      reasoningOptions={[]}
      modelLoadError={null}
      defaultOpen
      modal={false}
    />
  );
}

function ModelReasoningPickerLoading() {
  return (
    <ModelReasoningPicker
      {...codexBase}
      modelValue=""
      modelOptions={[]}
      reasoningOptions={[]}
      modelIsLoading
      defaultOpen
      modal={false}
    />
  );
}

function ModelReasoningPickerOpenGenericLoadError() {
  return (
    <ModelReasoningPicker
      {...codexBase}
      modelValue=""
      modelOptions={[]}
      reasoningOptions={[]}
      modelLoadFailed
      modelLoadError={null}
      defaultOpen
      modal={false}
    />
  );
}

function ModelReasoningPickerOpenLoadError({
  error,
}: {
  error: SystemExecutionOptionsModelLoadError;
}) {
  return (
    <ModelReasoningPicker
      {...codexBase}
      modelValue=""
      modelOptions={[]}
      reasoningOptions={[]}
      modelLoadError={error}
      defaultOpen
      modal={false}
    />
  );
}
