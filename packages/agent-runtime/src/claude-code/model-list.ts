import {
  cloneReasoningEfforts,
  HIGH_REASONING_EFFORT,
  LOW_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  ULTRACODE_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
  type AvailableModel,
  type ModelReasoningEffort,
} from "@bb/domain";

type ClaudeCodeCatalogEntry = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: readonly ModelReasoningEffort[];
  defaultReasoningEffort: AvailableModel["defaultReasoningEffort"];
};

// Ultracode requires an xhigh-capable model (it decomposes to xhigh effort +
// standing workflow orchestration), so only the xhigh ladder offers it.
const XHIGH_CAPABLE_REASONING_EFFORTS: readonly ModelReasoningEffort[] = [
  LOW_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  HIGH_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
  ULTRACODE_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
];

const OPUS_4_7_REASONING_EFFORTS: readonly ModelReasoningEffort[] =
  XHIGH_CAPABLE_REASONING_EFFORTS;

const OPUS_4_6_REASONING_EFFORTS: readonly ModelReasoningEffort[] = [
  LOW_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  HIGH_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
];

const SONNET_REASONING_EFFORTS: readonly ModelReasoningEffort[] = [
  LOW_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  HIGH_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
];

const HAIKU_REASONING_EFFORTS: readonly ModelReasoningEffort[] = [
  LOW_REASONING_EFFORT,
];

const CLAUDE_FABLE_5_MODEL = "claude-fable-5";
const CLAUDE_MYTHOS_5_MODEL = "claude-mythos-5";
const CLAUDE_OPUS_4_8_MODEL = "claude-opus-4-8";
const CLAUDE_OPUS_4_7_MODEL = "claude-opus-4-7";
const CLAUDE_OPUS_4_6_MODEL = "claude-opus-4-6";
const CLAUDE_SONNET_4_6_MODEL = "claude-sonnet-4-6";
const CLAUDE_HAIKU_4_5_MODEL = "claude-haiku-4-5";

function withOneMillionContext(model: string): string {
  return `${model}[1m]`;
}

const DEFAULT_CLAUDE_CODE_MODEL = withOneMillionContext(
  CLAUDE_OPUS_4_8_MODEL,
);

// Keep the active catalog version-pinned. Moving aliases and retired model
// strings live in the selected-only catalog so existing stored selections can
// render with their proper label without being offered as fresh choices.
const CLAUDE_CODE_CATALOG: readonly ClaudeCodeCatalogEntry[] = [
  {
    id: CLAUDE_FABLE_5_MODEL,
    model: CLAUDE_FABLE_5_MODEL,
    displayName: "Fable 5",
    description:
      "Fable 5 for demanding reasoning; requires Claude Code v2.1.170+",
    supportedReasoningEfforts: XHIGH_CAPABLE_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    id: CLAUDE_MYTHOS_5_MODEL,
    model: CLAUDE_MYTHOS_5_MODEL,
    displayName: "Mythos 5",
    description: "Mythos 5 for approved Project Glasswing access",
    supportedReasoningEfforts: XHIGH_CAPABLE_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    id: withOneMillionContext(CLAUDE_OPUS_4_8_MODEL),
    model: withOneMillionContext(CLAUDE_OPUS_4_8_MODEL),
    displayName: "Opus 4.8 (1M)",
    description: "Opus 4.8 with 1M context for complex long coding sessions",
    supportedReasoningEfforts: XHIGH_CAPABLE_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    id: withOneMillionContext(CLAUDE_OPUS_4_7_MODEL),
    model: withOneMillionContext(CLAUDE_OPUS_4_7_MODEL),
    displayName: "Opus 4.7 (1M)",
    description: "Opus 4.7 with 1M context for complex long coding sessions",
    supportedReasoningEfforts: OPUS_4_7_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: withOneMillionContext(CLAUDE_SONNET_4_6_MODEL),
    model: withOneMillionContext(CLAUDE_SONNET_4_6_MODEL),
    displayName: "Sonnet 4.6 (1M)",
    description: "Sonnet 4.6 with 1M context for long coding sessions",
    supportedReasoningEfforts: SONNET_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: CLAUDE_SONNET_4_6_MODEL,
    model: CLAUDE_SONNET_4_6_MODEL,
    displayName: "Sonnet 4.6",
    description: "Sonnet 4.6 for everyday coding tasks",
    supportedReasoningEfforts: SONNET_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: CLAUDE_HAIKU_4_5_MODEL,
    model: CLAUDE_HAIKU_4_5_MODEL,
    displayName: "Haiku 4.5",
    description: "Haiku 4.5 for quick answers",
    supportedReasoningEfforts: HAIKU_REASONING_EFFORTS,
    defaultReasoningEffort: "low",
  },
];

const CLAUDE_CODE_SELECTED_ONLY_CATALOG: readonly ClaudeCodeCatalogEntry[] = [
  {
    id: CLAUDE_OPUS_4_8_MODEL,
    model: CLAUDE_OPUS_4_8_MODEL,
    displayName: "Opus 4.8 (Legacy)",
    description:
      "Legacy Opus 4.8 model retained for existing non-1M selections",
    supportedReasoningEfforts: XHIGH_CAPABLE_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    id: CLAUDE_OPUS_4_7_MODEL,
    model: CLAUDE_OPUS_4_7_MODEL,
    displayName: "Opus 4.7 (Legacy)",
    description:
      "Legacy Opus 4.7 model retained for existing non-1M selections",
    supportedReasoningEfforts: OPUS_4_7_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: withOneMillionContext(CLAUDE_OPUS_4_6_MODEL),
    model: withOneMillionContext(CLAUDE_OPUS_4_6_MODEL),
    displayName: "Opus 4.6 (1M, Legacy)",
    description:
      "Legacy Opus 4.6 1M model retained for existing selections",
    supportedReasoningEfforts: OPUS_4_6_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: CLAUDE_OPUS_4_6_MODEL,
    model: CLAUDE_OPUS_4_6_MODEL,
    displayName: "Opus 4.6 (Legacy)",
    description: "Legacy Opus 4.6 model retained for existing selections",
    supportedReasoningEfforts: OPUS_4_6_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: "best",
    model: "best",
    displayName: "Best Alias",
    description:
      "Moving best alias retained for existing selections; resolves to Fable 5 where available",
    supportedReasoningEfforts: XHIGH_CAPABLE_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    id: "fable",
    model: "fable",
    displayName: "Fable Alias",
    description:
      "Moving Fable alias retained for existing selections; resolves to Claude Fable 5",
    supportedReasoningEfforts: XHIGH_CAPABLE_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    id: "opus[1m]",
    model: "opus[1m]",
    displayName: "Opus Alias (1M, Legacy)",
    description: "Legacy moving Opus 1M alias retained for existing selections",
    supportedReasoningEfforts: OPUS_4_6_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: "opus",
    model: "opus",
    displayName: "Opus Alias (Legacy)",
    description: "Legacy moving Opus alias retained for existing selections",
    supportedReasoningEfforts: OPUS_4_6_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: "sonnet[1m]",
    model: "sonnet[1m]",
    displayName: "Sonnet Alias (1M, Legacy)",
    description:
      "Legacy moving Sonnet 1M alias retained for existing selections",
    supportedReasoningEfforts: SONNET_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: "sonnet",
    model: "sonnet",
    displayName: "Sonnet Alias (Legacy)",
    description: "Legacy moving Sonnet alias retained for existing selections",
    supportedReasoningEfforts: SONNET_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: "haiku",
    model: "haiku",
    displayName: "Haiku Alias (Legacy)",
    description: "Legacy moving Haiku alias retained for existing selections",
    supportedReasoningEfforts: HAIKU_REASONING_EFFORTS,
    defaultReasoningEffort: "low",
  },
];

function buildCatalogModel(entry: ClaudeCodeCatalogEntry): AvailableModel {
  return {
    id: entry.id,
    model: entry.model,
    displayName: entry.displayName,
    description: entry.description,
    supportedReasoningEfforts: cloneReasoningEfforts(
      entry.supportedReasoningEfforts,
    ),
    defaultReasoningEffort: entry.defaultReasoningEffort,
    isDefault: false,
  };
}

function markDefaultModel(models: AvailableModel[]): AvailableModel[] {
  return models.map((model) =>
    model.model === DEFAULT_CLAUDE_CODE_MODEL
      ? { ...model, isDefault: true }
      : model,
  );
}

export interface ListClaudeCodeModelsResult {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}

export function listClaudeCodeModels(): ListClaudeCodeModelsResult {
  return {
    models: markDefaultModel(CLAUDE_CODE_CATALOG.map(buildCatalogModel)),
    selectedOnlyModels:
      CLAUDE_CODE_SELECTED_ONLY_CATALOG.map(buildCatalogModel),
  };
}
