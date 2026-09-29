import { useState } from "react";
import type { ReasoningLevel } from "@bb/domain";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ModelPickerStoryQueryProvider } from "../../../.ladle/model-picker-query-provider";
import {
  STORY_CLAUDE_CODE_MODELS,
  STORY_CLAUDE_CODE_MORE_MODELS,
  STORY_CLAUDE_REASONING,
  STORY_CODEX_MODELS,
  STORY_CODEX_REASONING,
  STORY_PI_MODELS,
  STORY_PI_REASONING,
  STORY_PROVIDER_OPTIONS,
  STORY_SERVICE_TIER_SUPPORT,
} from "../../../.ladle/story-fixtures";
import { SplitPreviewProvider } from "@/lib/define-split";
import { ModelReasoningMenu } from "./ModelReasoningMenuSplit";
import { ModelReasoningPicker } from "./ModelReasoningPicker";

export default { title: "performance/Model picker split" };

type ReviewState = "loading" | "error" | "live";

const MODELS_BY_PROVIDER = {
  codex: {
    models: STORY_CODEX_MODELS,
    more: [],
    reasoning: STORY_CODEX_REASONING,
  },
  "claude-code": {
    models: STORY_CLAUDE_CODE_MODELS,
    more: STORY_CLAUDE_CODE_MORE_MODELS,
    reasoning: STORY_CLAUDE_REASONING,
  },
  pi: { models: STORY_PI_MODELS, more: [], reasoning: STORY_PI_REASONING },
} as const;

function isStoryProvider(
  value: string,
): value is keyof typeof MODELS_BY_PROVIDER {
  return value in MODELS_BY_PROVIDER;
}

function Review({ compact }: { compact: boolean }) {
  const [state, setState] = useState<ReviewState>("loading");
  const [providerId, setProviderId] =
    useState<keyof typeof MODELS_BY_PROVIDER>("codex");
  const catalog = MODELS_BY_PROVIDER[providerId];
  const [model, setModel] = useState<string>(catalog.models[0].value);
  const [reasoning, setReasoning] = useState<ReasoningLevel>("medium");
  const [fastMode, setFastMode] = useState(false);

  return (
    <ModelPickerStoryQueryProvider>
      <CompactViewportOverrideProvider isCompactViewport={compact}>
        <div className="space-y-3 p-3">
          <div
            className="flex flex-wrap gap-3 text-sm"
            aria-label="Split review controls"
          >
            <button type="button" onClick={() => setState("loading")}>
              Hold loading
            </button>
            <button type="button" onClick={() => setState("error")}>
              Show failure
            </button>
            <button type="button" onClick={() => setState("live")}>
              Release to real UI
            </button>
            <button
              type="button"
              onClick={() => {
                setState("loading");
                window.setTimeout(() => setState("live"), 3000);
              }}
            >
              Release in 3 s
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {ModelReasoningMenu.id}: {state} · selected {providerId} / {model} /{" "}
            {reasoning}
            {fastMode ? " / fast" : ""}
          </p>
          <SplitPreviewProvider
            id={state === "live" ? "released" : ModelReasoningMenu.id}
            state={state === "live" ? "loading" : state}
            onRetry={() => setState("live")}
          >
            <div className="flex items-start" data-app-composer>
              <ModelReasoningPicker
                providerOptions={STORY_PROVIDER_OPTIONS}
                selectedProviderId={providerId}
                onSelectedProviderChange={(value) => {
                  if (!isStoryProvider(value)) return;
                  setProviderId(value);
                  setModel(MODELS_BY_PROVIDER[value].models[0].value);
                }}
                hasMultipleProviders
                modelValue={model}
                modelOptions={catalog.models}
                moreModelOptions={catalog.more}
                onModelChange={setModel}
                reasoningValue={reasoning}
                reasoningOptions={catalog.reasoning}
                onReasoningChange={setReasoning}
                fastModeEnabled={fastMode}
                onFastModeChange={setFastMode}
                showFastModeToggle
                serviceTierSupportByProvider={STORY_SERVICE_TIER_SUPPORT}
                modal={false}
              />
            </div>
          </SplitPreviewProvider>
        </div>
      </CompactViewportOverrideProvider>
    </ModelPickerStoryQueryProvider>
  );
}

export const Desktop = () => <Review compact={false} />;

export const Phone = () => <Review compact />;
