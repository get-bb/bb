import {
  HIGH_REASONING_EFFORT,
  LOW_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  ULTRACODE_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
  type AvailableModel,
  type ModelReasoningEffort,
} from "@get-bb/plugin-sdk/provider-bridge";

// Defensive copy so callers can hand out reasoning efforts in mutable API
// responses without aliasing the shared module-level constants.
export function cloneReasoningEfforts(
  efforts: readonly ModelReasoningEffort[],
): ModelReasoningEffort[] {
  return efforts.map((effort) => ({ ...effort }));
}

export interface ClaudeCodeCatalogEntry {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: readonly ModelReasoningEffort[];
  defaultReasoningEffort: AvailableModel["defaultReasoningEffort"];
}

// Ultracode requires an xhigh-capable model (it decomposes to xhigh effort plus
// standing workflow orchestration), so only the xhigh ladder offers it.
export const CLAUDE_XHIGH_CAPABLE_REASONING_EFFORTS: readonly ModelReasoningEffort[] =
  [
    LOW_REASONING_EFFORT,
    MEDIUM_REASONING_EFFORT,
    HIGH_REASONING_EFFORT,
    XHIGH_REASONING_EFFORT,
    ULTRACODE_REASONING_EFFORT,
    MAX_REASONING_EFFORT,
  ];

export const DEFAULT_CLAUDE_CODE_MODEL = "claude-opus-5[1m]";

/**
 * BB's curated, version-pinned Claude Code models. Lives here rather than in the
 * daemon because two consumers need the same rows:
 *
 * - the daemon filters this list against an account-scoped probe, so only models
 *   the account can actually run reach the picker
 * - the app and server show it unfiltered as a provisional catalog, before or
 *   instead of a successful probe
 *
 * Secondary "More models" choices, moving aliases, and retired model strings are
 * deliberately absent: they live in the daemon's selected-only catalog, which
 * exists to label an already-stored selection rather than to offer new ones.
 */
export const CLAUDE_CODE_ACTIVE_CATALOG: readonly ClaudeCodeCatalogEntry[] = [
  {
    id: "claude-fable-5",
    model: "claude-fable-5",
    displayName: "Fable 5",
    description:
      "Fable 5 for demanding reasoning; requires Claude Code v2.1.170+",
    supportedReasoningEfforts: CLAUDE_XHIGH_CAPABLE_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    id: DEFAULT_CLAUDE_CODE_MODEL,
    model: DEFAULT_CLAUDE_CODE_MODEL,
    displayName: "Opus 5 (1M)",
    description: "Opus 5 with 1M context for complex long coding sessions",
    supportedReasoningEfforts: CLAUDE_XHIGH_CAPABLE_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    id: "claude-opus-4-8[1m]",
    model: "claude-opus-4-8[1m]",
    displayName: "Opus 4.8 (1M)",
    description: "Opus 4.8 with 1M context for complex long coding sessions",
    supportedReasoningEfforts: CLAUDE_XHIGH_CAPABLE_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    id: "claude-opus-4-7[1m]",
    model: "claude-opus-4-7[1m]",
    displayName: "Opus 4.7 (1M)",
    description: "Opus 4.7 with 1M context for complex long coding sessions",
    supportedReasoningEfforts: CLAUDE_XHIGH_CAPABLE_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: "claude-sonnet-5",
    model: "claude-sonnet-5",
    displayName: "Sonnet 5",
    description: "Sonnet 5 for everyday coding tasks with deeper reasoning",
    supportedReasoningEfforts: CLAUDE_XHIGH_CAPABLE_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
];

/**
 * The curated catalog as picker rows, for use before or instead of a successful
 * account-scoped probe:
 *
 * - the app renders it as react-query placeholder data on a cold cache, so the
 *   picker is populated immediately rather than waiting on a CLI process spawn
 * - the server substitutes it when the probe fails transiently
 *
 * These rows are pinned model ids, so an account without the matching
 * entitlement or CLI version will not be able to run every one of them. Neither
 * caller may treat this list as authoritative: absence from it is never proof
 * that a stored model was retired, and only a successful probe may trigger model
 * recovery. Once a probe succeeds, its result is what should be shown and
 * remembered.
 *
 * Returns fresh objects because these flow into mutable API responses.
 */
export function listClaudeCodeFallbackModels(): AvailableModel[] {
  return CLAUDE_CODE_ACTIVE_CATALOG.map((entry) => ({
    ...entry,
    supportedReasoningEfforts: cloneReasoningEfforts(
      entry.supportedReasoningEfforts,
    ),
    isDefault: entry.model === DEFAULT_CLAUDE_CODE_MODEL,
  }));
}
