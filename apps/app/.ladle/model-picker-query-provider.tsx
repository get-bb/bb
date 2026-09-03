import { useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AvailableModel,
  ProviderComposerAction,
  ProviderInfo,
  ReasoningLevel,
} from "@bb/domain";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import { systemExecutionOptionsQueryKey } from "../src/hooks/queries/query-keys";
import type { PickerOption } from "../src/components/pickers/OptionPicker";
import type { ModelPickerOption } from "../src/components/pickers/model-picker-option";
import {
  STORY_CLAUDE_CODE_MORE_MODELS,
  STORY_CLAUDE_CODE_MODELS,
  STORY_CLAUDE_REASONING,
  STORY_CODEX_MODELS,
  STORY_CODEX_REASONING,
  STORY_OMP_MODELS,
  STORY_OMP_PROVIDER_OPTION,
  STORY_PI_MODELS,
  STORY_PROVIDER_OPTIONS,
  STORY_SERVICE_TIER_SUPPORT,
} from "./story-fixtures";

const permissionModes = ["accept-edits", "auto", "full"] as const;

const STORY_COMPOSER_ACTIONS_BY_PROVIDER: Record<
  string,
  readonly ProviderComposerAction[]
> = {
  codex: [
    { kind: "skills", trigger: "/" },
    {
      kind: "plan",
      command: { trigger: "/", name: "plan", trailingText: " " },
    },
    {
      kind: "goal",
      command: { trigger: "/", name: "goal", trailingText: " " },
    },
  ],
  "claude-code": [
    { kind: "skills", trigger: "/" },
    {
      kind: "plan",
      command: { trigger: "/", name: "plan", trailingText: " " },
    },
  ],
  pi: [],
  omp: [],
};

const STORY_PROVIDER_INFOS: ProviderInfo[] = [
  ...STORY_PROVIDER_OPTIONS,
  STORY_OMP_PROVIDER_OPTION,
].map((provider) => ({
  id: provider.value,
  pluginId: `provider-${provider.value}`,
  displayName: provider.label,
  logoUrl: null,
  available: true,
  maintenance: { health: true, usage: true, installation: true },
  composerActions: [
    ...(STORY_COMPOSER_ACTIONS_BY_PROVIDER[provider.value] ?? []),
  ],
  capabilities: {
    supportsThreadArchive: true,
    supportsThreadRename: true,
    supportsServiceTier: STORY_SERVICE_TIER_SUPPORT[provider.value] ?? false,
    supportsNativeUserQuestion: true,
    supportsFork: true,
    supportsSessionRewind: true,
    modelCatalogScope: "workspace",
    permissionModes: [...permissionModes],
  },
}));

function makeSupportedReasoningEfforts(
  reasoningOptions: readonly PickerOption<ReasoningLevel>[],
) {
  return reasoningOptions.map((option) => ({
    reasoningEffort: option.value,
    description: option.label,
  }));
}

function makeAvailableModels({
  models,
  reasoningOptions,
  markFirstDefault = true,
}: {
  models: readonly ModelPickerOption[];
  reasoningOptions: readonly PickerOption<ReasoningLevel>[];
  markFirstDefault?: boolean;
}): AvailableModel[] {
  const defaultReasoningEffort =
    reasoningOptions.find((option) => option.value === "medium")?.value ??
    reasoningOptions[0]?.value ??
    "medium";
  const supportedReasoningEfforts =
    makeSupportedReasoningEfforts(reasoningOptions);

  return models.map((model, index) => ({
    id: model.value,
    model: model.value,
    displayName: model.label,
    ...(model.routeProviderId
      ? { routeProviderId: model.routeProviderId }
      : {}),
    description: "",
    supportedReasoningEfforts,
    defaultReasoningEffort,
    isDefault: markFirstDefault && index === 0,
  }));
}

function makeExecutionOptions(
  models: AvailableModel[],
  selectedOnlyModels: AvailableModel[] = [],
): SystemExecutionOptionsResponse {
  return {
    providers: STORY_PROVIDER_INFOS,
    models,
    selectedOnlyModels,
    permissionCeiling: "full",
    modelLoadError: null,
  };
}

function createStoryQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
        staleTime: Infinity,
      },
    },
  });

  const executionOptionsByProviderId: Record<
    string,
    SystemExecutionOptionsResponse
  > = {
    codex: makeExecutionOptions(
      makeAvailableModels({
        models: STORY_CODEX_MODELS,
        reasoningOptions: STORY_CODEX_REASONING,
      }),
    ),
    "claude-code": makeExecutionOptions(
      makeAvailableModels({
        models: STORY_CLAUDE_CODE_MODELS,
        reasoningOptions: STORY_CLAUDE_REASONING,
      }),
      makeAvailableModels({
        models: STORY_CLAUDE_CODE_MORE_MODELS,
        reasoningOptions: STORY_CLAUDE_REASONING,
        markFirstDefault: false,
      }),
    ),
    pi: makeExecutionOptions(
      makeAvailableModels({
        models: STORY_PI_MODELS,
        reasoningOptions: STORY_CODEX_REASONING,
      }),
    ),
    omp: makeExecutionOptions(
      makeAvailableModels({
        models: STORY_OMP_MODELS,
        reasoningOptions: STORY_CODEX_REASONING,
      }),
    ),
  };

  for (const [providerId, executionOptions] of Object.entries(
    executionOptionsByProviderId,
  )) {
    queryClient.setQueryData<SystemExecutionOptionsResponse>(
      systemExecutionOptionsQueryKey({
        environmentId: null,
        hostId: null,
        providerId,
      }),
      executionOptions,
    );
  }

  return queryClient;
}

export function ModelPickerStoryQueryProvider({
  children,
}: {
  children: ReactNode;
}) {
  const queryClient = useMemo(createStoryQueryClient, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
