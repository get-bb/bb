import type {
  AvailableModel,
  ModelReasoningEffort,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  CLAUDE_CODE_ACTIVE_CATALOG_DATA,
  CLAUDE_XHIGH_CAPABLE_REASONING_EFFORT_DATA,
  DEFAULT_CLAUDE_CODE_MODEL,
} from "./model-catalog-data.js";

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

// The rows themselves live in `model-catalog-data.ts` (import-free, so the
// plugin's server.ts can declare them too); this module types them for the
// bridge. Ultracode requires an xhigh-capable model (it decomposes to xhigh
// effort plus standing workflow orchestration), so only the xhigh ladder
// offers it.
export const CLAUDE_XHIGH_CAPABLE_REASONING_EFFORTS: readonly ModelReasoningEffort[] =
  CLAUDE_XHIGH_CAPABLE_REASONING_EFFORT_DATA.map((effort) => ({ ...effort }));

export { DEFAULT_CLAUDE_CODE_MODEL };

/**
 * BB's curated, version-pinned Claude Code models. Lives here rather than in the
 * daemon because two consumers need the same rows:
 *
 * - the daemon filters this list against an account-scoped probe, so only models
 *   the account can actually run reach the picker
 * - the plugin's server declaration offers it unfiltered as the provisional
 *   catalog, before or instead of a successful probe
 */
export const CLAUDE_CODE_ACTIVE_CATALOG: readonly ClaudeCodeCatalogEntry[] =
  CLAUDE_CODE_ACTIVE_CATALOG_DATA.map((entry) => ({
    id: entry.model,
    model: entry.model,
    displayName: entry.displayName,
    description: entry.description,
    supportedReasoningEfforts: CLAUDE_XHIGH_CAPABLE_REASONING_EFFORTS,
    defaultReasoningEffort: entry.defaultReasoningEffort,
  }));
