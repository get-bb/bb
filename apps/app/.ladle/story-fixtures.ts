import { useState } from "react";
import { reconcileReasoningLevel } from "@bb/domain";
import type {
  Host,
  ProjectSource,
  ProviderInfo,
  ReasoningLevel,
  Thread,
  WorkspaceStatus,
} from "@bb/domain";
import type {
  ProviderCliKey,
  ProviderCliStatus,
} from "@bb/host-daemon-contract";
import type {
  ProjectResponse,
  SystemEnvironmentProvider,
} from "@bb/server-contract";
import { EMPTY_ORDERED_MENTION_SUGGESTIONS } from "@bb/client-core";
import {
  makeEnvironment as makeEnvironmentFixture,
  makeHost as makeHostFixture,
  makeProviderInfo,
  makeThread as makeThreadFixture,
  makeThreadListEntry as makeThreadListEntryFixture,
} from "@bb/test-helpers/domain-fixtures";
import { makeProjectResponse } from "../src/test/fixtures/projects";
import { getProviderIconInfo } from "../src/lib/provider-icon";
import type { PickerOption } from "../src/components/pickers/OptionPicker";
import type { ModelPickerOption } from "../src/components/pickers/model-picker-option";
import type { ProjectSelectorOption } from "../src/components/pickers/ProjectSelector";
import type { ReuseThreadOption } from "../src/components/pickers/ReuseEnvironmentPicker";
import type { ExecutionControlsProps } from "../src/components/promptbox/ExecutionControls";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  type AttachmentsConfig,
  type TypeaheadCommandConfig,
  type TypeaheadConfig,
  type TypeaheadMentionConfig,
} from "../src/components/promptbox/PromptBoxInternal";

const noop = () => {};

export const HOST_IDS = {
  local: "host_local",
  remote: "host_remote",
} as const;

export const HOST_NAMES = {
  local: "Michael's MacBook Pro",
  remote: "michael-build-box",
} as const;

export const PROJECT_IDS = {
  bb: "proj_bb",
  pierre: "proj_pierre",
  ingest: "proj_ingest_pipeline",
} as const;

export const PROJECT_NAMES = {
  bb: "bb",
  pierre: "pierre",
  ingest: "ingest-pipeline",
} as const;

export const BRANCH_NAMES = {
  default: "main",
  feature: "feat/sidebar-rail",
} as const;

export function makeTypeaheadConfig(
  mentionOverrides: Partial<TypeaheadMentionConfig> = {},
  commandOverrides: Partial<TypeaheadCommandConfig> = {},
): TypeaheadConfig {
  const mention: TypeaheadMentionConfig = {
    results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
    isLoading: false,
    isError: false,
    onQueryChange: noop,
    ...mentionOverrides,
  };
  return {
    mention,
    command: {
      ...INERT_TYPEAHEAD_COMMAND_CONFIG,
      ...commandOverrides,
    },
  };
}

export function makeAttachmentsConfig(
  overrides: Partial<AttachmentsConfig> = {},
): AttachmentsConfig {
  const base: AttachmentsConfig = {
    items: [],
    projectId: PROJECT_IDS.bb,
    onAttachFiles: noop,
    onRemove: noop,
    isAttaching: false,
    error: null,
  };
  return { ...base, ...overrides };
}

function storyProviderIcon(providerId: string, glyph: string) {
  return getProviderIconInfo("agent", providerId, {
    logoUrl: null,
    icon: { glyph },
  })?.icon;
}

function makeStoryProvider(
  id: string,
  displayName: string,
  glyph: string,
): ProviderInfo {
  return makeProviderInfo({
    id,
    displayName,
    logoUrl: null,
    icon: { glyph },
  });
}

const storyCodexProvider = makeStoryProvider("codex", "Codex", "Code");
const storyClaudeCodeProvider = makeStoryProvider(
  "claude-code",
  "Claude Code",
  "Brain",
);
const storyCursorProvider = makeStoryProvider("acp-cursor", "Cursor", "Zap");
export const STORY_CLAUDE_CODE_PROVIDER_ID = storyClaudeCodeProvider.id;
export const STORY_CURSOR_PROVIDER_ID = storyCursorProvider.id;

export const STORY_PROVIDERS_BY_ID: ReadonlyMap<string, ProviderInfo> = new Map(
  [storyCodexProvider, storyClaudeCodeProvider, storyCursorProvider].map(
    (provider) => [provider.id, provider],
  ),
);

export const STORY_PROVIDER_OPTIONS: readonly PickerOption<string>[] = [
  { value: "codex", label: "Codex", icon: storyProviderIcon("codex", "Code") },
  {
    value: "claude-code",
    label: "Claude Code",
    icon: storyProviderIcon("claude-code", "Sparkles"),
  },
  { value: "pi", label: "Pi", icon: storyProviderIcon("pi", "Zap") },
];

export const STORY_CODEX_MODELS: readonly PickerOption<string>[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
  { value: "gpt-5.2", label: "GPT-5.2" },
];

export const STORY_CLAUDE_CODE_MODELS: readonly PickerOption<string>[] = [
  { value: "claude-fable-5", label: "Claude Fable 5" },
  { value: "claude-opus-4-8[1m]", label: "Claude Opus 4.8 (1M)" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
];

export const STORY_CLAUDE_CODE_MORE_MODELS: readonly PickerOption<string>[] = [
  { value: "claude-sonnet-4-6[1m]", label: "Claude Sonnet 4.6 (1M)" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

export const STORY_PI_REASONING: readonly PickerOption<ReasoningLevel>[] = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
];

const STORY_PI_OPUS_REASONING: readonly PickerOption<ReasoningLevel>[] = [
  ...STORY_PI_REASONING,
  { value: "max", label: "Max" },
];

export const STORY_PI_MODELS: readonly (ModelPickerOption & {
  reasoningOptions: readonly PickerOption<ReasoningLevel>[];
})[] = [
  {
    value: "openai-codex/gpt-5.5",
    label: "GPT-5.5",
    routeProviderId: "openai-codex",
    reasoningOptions: STORY_PI_REASONING,
  },
  {
    value: "openai-codex/gpt-5.4",
    label: "GPT-5.4",
    routeProviderId: "openai-codex",
    reasoningOptions: STORY_PI_REASONING,
  },
  {
    value: "openai-codex/gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    routeProviderId: "openai-codex",
    reasoningOptions: STORY_PI_REASONING,
  },
  {
    value: "openai/gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    routeProviderId: "openai",
    reasoningOptions: STORY_PI_REASONING,
  },
  {
    value: "openai/gpt-5.3-codex-spark",
    label: "GPT-5.3 Codex Spark",
    routeProviderId: "openai",
    reasoningOptions: STORY_PI_REASONING.filter(
      ({ value }) => value !== "none",
    ),
  },
  {
    value: "openai-codex/gpt-5.3-codex-spark",
    label: "GPT-5.3 Codex Spark",
    routeProviderId: "openai-codex",
    reasoningOptions: STORY_PI_REASONING,
  },
  {
    value: "anthropic/claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    routeProviderId: "anthropic",
    reasoningOptions: STORY_PI_REASONING.filter(
      ({ value }) => value !== "xhigh",
    ),
  },
  {
    value: "anthropic/claude-opus-4-8",
    label: "Claude Opus 4.8",
    routeProviderId: "anthropic",
    reasoningOptions: STORY_PI_OPUS_REASONING,
  },
  {
    value: "anthropic/claude-opus-4-7",
    label: "Claude Opus 4.7",
    routeProviderId: "anthropic",
    reasoningOptions: STORY_PI_OPUS_REASONING,
  },
];

export const STORY_CODEX_REASONING: readonly PickerOption<ReasoningLevel>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
  { value: "ultra", label: "Ultra" },
];

export const STORY_CLAUDE_REASONING: readonly PickerOption<ReasoningLevel>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "ultracode", label: "Ultracode" },
  { value: "max", label: "Max" },
];

export const STORY_SERVICE_TIER_SUPPORT: Record<string, boolean> = {
  codex: true,
  "claude-code": false,
  pi: false,
};

export const STORY_PROJECT_SOURCES: readonly ProjectSource[] = [
  {
    id: "src_local",
    projectId: PROJECT_IDS.bb,
    type: "local_path",
    hostId: HOST_IDS.local,
    path: "/Users/michael/Projects/bb",
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "src_remote",
    projectId: PROJECT_IDS.bb,
    type: "local_path",
    hostId: HOST_IDS.remote,
    path: "/home/michael/bb",
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
  },
];

export const STORY_BRANCH_OPTIONS: readonly string[] = [
  "main",
  "release/1.2",
  "feat/sidebar-rail",
  "fix/timeline-pagination",
  "bb/refactor-project-creation-thr_jj65bdsiwa",
];

export const STORY_WORKTREE_OPTIONS: readonly ReuseThreadOption[] = [
  {
    environmentId: "env_review_flow",
    branchName: "bb/review-flow-thr_4hge9xn14m",
    name: null,
    path: null,
    environmentProviderId: "git-worktree",
    threads: [
      { id: "thr_review", title: "Review flow cleanup" },
      { id: "thr_tests", title: "Backfill promptbox tests" },
    ],
  },
  {
    environmentId: "env_timeline",
    branchName: "bb/timeline-pagination-thr_qfk8ksbxkk",
    name: "Timeline workspace",
    path: null,
    environmentProviderId: "git-worktree",
    threads: [{ id: "thr_timeline", title: "Timeline pagination" }],
  },
];

export const STORY_ENVIRONMENT_PROVIDERS: readonly SystemEnvironmentProvider[] =
  [
    {
      machineProviderId: null,
      id: "project-checkout",
      displayName: "Project checkout",
      description: "Work in this project checkout.",
      icon: "Laptop",
      logoUrl: null,
      pluginId: "environment-project-checkout",
      acceptsEmptyInputs: true,
      machineAvailability: {},
      availability: null,
      requires: {
        projectCheckout: true,
        gitCheckout: false,
        gitRemote: false,
        projectless: false,
      },
      inputs: null,
    },
    {
      machineProviderId: null,
      id: "git-worktree",
      displayName: "Worktree",
      description: "Create an isolated Git worktree.",
      icon: "FolderGit",
      logoUrl: null,
      pluginId: "environment-git-worktree",
      acceptsEmptyInputs: true,
      machineAvailability: {},
      availability: null,
      requires: {
        projectCheckout: true,
        gitCheckout: true,
        gitRemote: false,
        projectless: false,
      },
      inputs: null,
    },
    {
      machineProviderId: null,
      id: "personal-workspace",
      displayName: "Personal workspace",
      description: "Create a personal directory without a project.",
      icon: "Folder",
      logoUrl: null,
      pluginId: "environment-personal-workspace",
      acceptsEmptyInputs: true,
      machineAvailability: {},
      availability: null,
      requires: {
        projectCheckout: false,
        gitCheckout: false,
        gitRemote: false,
        projectless: true,
      },
      inputs: null,
    },
  ];

export const STORY_PROJECTS: readonly ProjectSelectorOption[] = [
  { id: PROJECT_IDS.bb, name: PROJECT_NAMES.bb },
  { id: PROJECT_IDS.pierre, name: PROJECT_NAMES.pierre },
];

export function makeExecutionControlsProps(
  overrides: Partial<ExecutionControlsProps> = {},
): ExecutionControlsProps {
  const base: ExecutionControlsProps = {
    provider: {
      options: STORY_PROVIDER_OPTIONS,
      selectedId: "codex",
      onChange: noop,
      hasMultiple: true,
    },
    model: {
      active: { model: "gpt-5.5" },
      selected: "gpt-5.5",
      options: STORY_CODEX_MODELS,
      moreOptions: [],
      isLoading: false,
      loadFailed: false,
      onChange: noop,
    },
    serviceTier: {
      value: undefined,
      onChange: noop,
      supported: true,
      supportByProvider: STORY_SERVICE_TIER_SUPPORT,
    },
    reasoning: {
      value: "medium",
      options: STORY_CODEX_REASONING,
      onChange: noop,
    },
  };
  return { ...base, ...overrides };
}

export function useInteractiveExecutionControls(
  base: ExecutionControlsProps,
): ExecutionControlsProps {
  const [providerId, setProviderId] = useState(
    base.provider.selectedId ?? "codex",
  );
  const [model, setModel] = useState(base.model.selected);
  const [reasoning, setReasoning] = useState(base.reasoning.value);
  const [serviceTier, setServiceTier] = useState(base.serviceTier?.value);
  const catalogForProvider = (id: string, selectedModel = model) => {
    if (id === base.provider.selectedId) {
      return {
        models: base.model.options,
        moreModels: base.model.moreOptions,
        reasoning: base.reasoning.options,
      };
    }
    return {
      models:
        id === "claude-code"
          ? STORY_CLAUDE_CODE_MODELS
          : id === "pi"
            ? STORY_PI_MODELS
            : STORY_CODEX_MODELS,
      moreModels: id === "claude-code" ? STORY_CLAUDE_CODE_MORE_MODELS : [],
      reasoning:
        id === "claude-code"
          ? STORY_CLAUDE_REASONING
          : id === "pi"
            ? (STORY_PI_MODELS.find((option) => option.value === selectedModel)
                ?.reasoningOptions ?? STORY_PI_REASONING)
            : STORY_CODEX_REASONING,
    };
  };
  const catalog = catalogForProvider(providerId);
  return {
    ...base,
    provider: {
      ...base.provider,
      selectedId: providerId,
      onChange: (id) => {
        const next = catalogForProvider(id, "");
        setProviderId(id);
        setModel(next.models[0]?.value ?? "");
        if (next.reasoning.length > 0) {
          setReasoning((current) =>
            reconcileReasoningLevel(
              current,
              next.reasoning.map((option) => option.value),
            ),
          );
        }
        setServiceTier(undefined);
      },
    },
    model: {
      ...base.model,
      active: { model },
      selected: model,
      options: catalog.models,
      moreOptions: catalog.moreModels,
      onChange: (value) => {
        setModel(value);
        const next = catalogForProvider(providerId, value);
        if (next.reasoning.length > 0) {
          setReasoning((current) =>
            reconcileReasoningLevel(
              current,
              next.reasoning.map((option) => option.value),
            ),
          );
        }
      },
    },
    reasoning: {
      value: reasoning,
      options: catalog.reasoning,
      onChange: setReasoning,
    },
    ...(base.serviceTier
      ? {
          serviceTier: {
            ...base.serviceTier,
            value: serviceTier,
            onChange: setServiceTier,
            supported: STORY_SERVICE_TIER_SUPPORT[providerId] ?? false,
          },
        }
      : {}),
  };
}

export function makeThread(overrides: Partial<Thread> = {}): Thread {
  return makeThreadFixture({
    id: "thr_demo",
    projectId: PROJECT_IDS.bb,
    environmentId: "env_demo",
    title: "Audit recurring permission failures",
    titleFallback: "Audit recurring permission failures",
    ...overrides,
  });
}

export function makeThreadListEntry(
  overrides: Parameters<typeof makeThreadListEntryFixture>[0] = {},
) {
  return makeThreadListEntryFixture({
    id: "thr_demo",
    projectId: PROJECT_IDS.bb,
    title: "Audit recurring permission failures",
    titleFallback: "Audit recurring permission failures",
    ...overrides,
  });
}

export function makeProject(
  overrides: Partial<ProjectResponse> = {},
): ProjectResponse {
  return makeProjectResponse({
    id: PROJECT_IDS.bb,
    name: PROJECT_NAMES.bb,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  });
}

export function makeHost(overrides: Partial<Host> = {}): Host {
  return makeHostFixture({
    id: HOST_IDS.local,
    name: HOST_NAMES.local,
    lastSeenAt: 100,
    updatedAt: 100,
    ...overrides,
  });
}

export function makeProviderCliStatus(
  provider: ProviderCliKey,
  overrides: Partial<ProviderCliStatus> = {},
): ProviderCliStatus {
  const identity =
    provider === "codex"
      ? { displayName: "Codex", executableName: "codex" }
      : provider === "claude-code"
        ? { displayName: "Claude Code", executableName: "claude" }
        : { displayName: "Cursor", executableName: "agent" };
  return {
    displayName: identity.displayName,
    executableName: identity.executableName,
    executablePath: `/usr/local/bin/${identity.executableName}`,
    installed: true,
    installSource: "npmGlobal",
    currentVersion: "1.0.0",
    latestVersion: "1.0.0",
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: null,
    needsUpdate: false,
    versionUnsupported: false,
    ...overrides,
  };
}

export function makeEnvironment(
  overrides: Parameters<typeof makeEnvironmentFixture>[0] = {},
) {
  return makeEnvironmentFixture({
    id: "env_demo",
    projectId: PROJECT_IDS.bb,
    hostId: HOST_IDS.local,
    path: "/Users/michael/Projects/bb",
    branchName: BRANCH_NAMES.feature,
    baseBranch: BRANCH_NAMES.default,
    defaultBranch: BRANCH_NAMES.default,
    updatedAt: 100,
    ...overrides,
  });
}

export function makeWorkspaceStatus(
  overrides: Partial<WorkspaceStatus> = {},
): WorkspaceStatus {
  const base: WorkspaceStatus = {
    workingTree: {
      hasUncommittedChanges: false,
      state: "clean",
      insertions: 0,
      deletions: 0,
      lineStatsComplete: true,
      files: [],
    },
    branch: {
      currentBranch: BRANCH_NAMES.feature,
      defaultBranch: BRANCH_NAMES.default,
    },
    checkout: {
      kind: "branch",
      branchName: BRANCH_NAMES.feature,
      headSha: null,
    },
    mergeBase: {
      mergeBaseBranch: BRANCH_NAMES.default,
      baseRef: null,
      aheadCount: 0,
      behindCount: 0,
      hasCommittedUnmergedChanges: false,
      commits: [],
      insertions: 0,
      deletions: 0,
      lineStatsComplete: true,
      files: [],
    },
  };
  return { ...base, ...overrides };
}
