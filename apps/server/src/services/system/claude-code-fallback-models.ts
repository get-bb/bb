/**
 * The provisional Claude Code model rows the server substitutes when the
 * daemon's account-scoped probe fails transiently, so the picker is populated
 * instead of empty and the real failure defers to submit time.
 *
 * These are pinned model ids, so an account without the matching entitlement or
 * CLI version will not be able to run every one of them. This list is never
 * authoritative: absence from it is not proof that a stored model was retired,
 * and only a successful probe may trigger model recovery.
 *
 * DEBT: the daemon keeps its own copy (agent-runtime's
 * claude-code/model-catalog.ts, which filters it against the probe) and the app
 * keeps a third for cold-cache placeholder rows (system-queries.ts). One copy
 * per consumer is the established shape on this branch — a shared package for
 * it is exactly the coupling the provider catalog package was deleted to
 * remove. They converge when the claude-code plugin owns its provider metadata
 * and serves these rows (wave 5 of plans/agent-provider-plugin-surface.md).
 */
import {
  HIGH_REASONING_EFFORT,
  LOW_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  ULTRACODE_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
  type AvailableModel,
  type ModelReasoningEffort,
} from "@bb/domain";

const DEFAULT_CLAUDE_CODE_MODEL = "claude-opus-5[1m]";

const XHIGH_LADDER: readonly ModelReasoningEffort[] = [
  LOW_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  HIGH_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
  ULTRACODE_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
];

const CLAUDE_CODE_FALLBACK_CATALOG: readonly Omit<
  AvailableModel,
  "isDefault" | "supportedReasoningEfforts"
>[] = [
  {
    id: "claude-fable-5",
    model: "claude-fable-5",
    displayName: "Fable 5",
    description:
      "Fable 5 for demanding reasoning; requires Claude Code v2.1.170+",
    defaultReasoningEffort: "high",
  },
  {
    id: DEFAULT_CLAUDE_CODE_MODEL,
    model: DEFAULT_CLAUDE_CODE_MODEL,
    displayName: "Opus 5 (1M)",
    description: "Opus 5 with 1M context for complex long coding sessions",
    defaultReasoningEffort: "high",
  },
  {
    id: "claude-opus-4-8[1m]",
    model: "claude-opus-4-8[1m]",
    displayName: "Opus 4.8 (1M)",
    description: "Opus 4.8 with 1M context for complex long coding sessions",
    defaultReasoningEffort: "high",
  },
  {
    id: "claude-opus-4-7[1m]",
    model: "claude-opus-4-7[1m]",
    displayName: "Opus 4.7 (1M)",
    description: "Opus 4.7 with 1M context for complex long coding sessions",
    defaultReasoningEffort: "medium",
  },
  {
    id: "claude-sonnet-5",
    model: "claude-sonnet-5",
    displayName: "Sonnet 5",
    description: "Sonnet 5 for everyday coding tasks with deeper reasoning",
    defaultReasoningEffort: "medium",
  },
];

/** Fresh rows: these flow into mutable API responses. */
export function listClaudeCodeFallbackModels(): AvailableModel[] {
  return CLAUDE_CODE_FALLBACK_CATALOG.map((entry) => ({
    ...entry,
    supportedReasoningEfforts: [...XHIGH_LADDER],
    isDefault: entry.model === DEFAULT_CLAUDE_CODE_MODEL,
  }));
}
