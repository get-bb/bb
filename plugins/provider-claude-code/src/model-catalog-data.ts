/**
 * BB's curated, version-pinned Claude Code models — the data only, with no
 * imports, because two very different loaders read it:
 *
 * - the plugin's `server.ts` (loaded by the bb server, where only the SDK
 *   root specifier resolves) declares it as the provider's cold-cache
 *   fallback (`experimental_models.fallback`);
 * - the bridge (`model-catalog.ts`, run on the host) filters it against the
 *   account-scoped probe so only models the account can run reach the picker.
 *
 * Secondary "More models" choices, moving aliases, and retired model strings
 * are deliberately absent: they live in the bridge's selected-only catalog,
 * which exists to label an already-stored selection rather than to offer new
 * ones.
 */

export type ClaudeCodeReasoningLevel =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "ultracode"
  | "max";

export interface ClaudeCodeReasoningEffortData {
  reasoningEffort: ClaudeCodeReasoningLevel;
  description: string;
}

export interface ClaudeCodeCatalogEntryData {
  model: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: ClaudeCodeReasoningLevel;
}

/**
 * Ultracode requires an xhigh-capable model (it decomposes to xhigh effort
 * plus standing workflow orchestration), so only the xhigh ladder offers it.
 * Descriptions match `@bb/domain`'s shared reasoning-effort constants.
 */
export const CLAUDE_XHIGH_CAPABLE_REASONING_EFFORT_DATA: readonly ClaudeCodeReasoningEffortData[] =
  [
    { reasoningEffort: "low", description: "Low reasoning effort" },
    { reasoningEffort: "medium", description: "Medium reasoning effort" },
    { reasoningEffort: "high", description: "High reasoning effort" },
    { reasoningEffort: "xhigh", description: "Extra high reasoning effort" },
    {
      reasoningEffort: "ultracode",
      description:
        "Extra high reasoning effort plus multi-agent workflow orchestration",
    },
    { reasoningEffort: "max", description: "Maximum reasoning effort" },
  ];

export const DEFAULT_CLAUDE_CODE_MODEL = "claude-opus-5[1m]";

export const CLAUDE_CODE_ACTIVE_CATALOG_DATA: readonly ClaudeCodeCatalogEntryData[] =
  [
    {
      model: "claude-fable-5",
      displayName: "Fable 5",
      description:
        "Fable 5 for demanding reasoning; requires Claude Code v2.1.170+",
      defaultReasoningEffort: "high",
    },
    {
      model: DEFAULT_CLAUDE_CODE_MODEL,
      displayName: "Opus 5 (1M)",
      description: "Opus 5 with 1M context for complex long coding sessions",
      defaultReasoningEffort: "high",
    },
    {
      model: "claude-opus-4-8[1m]",
      displayName: "Opus 4.8 (1M)",
      description: "Opus 4.8 with 1M context for complex long coding sessions",
      defaultReasoningEffort: "high",
    },
    {
      model: "claude-opus-4-7[1m]",
      displayName: "Opus 4.7 (1M)",
      description: "Opus 4.7 with 1M context for complex long coding sessions",
      defaultReasoningEffort: "medium",
    },
    {
      model: "claude-sonnet-5",
      displayName: "Sonnet 5",
      description: "Sonnet 5 for everyday coding tasks with deeper reasoning",
      defaultReasoningEffort: "medium",
    },
  ];
