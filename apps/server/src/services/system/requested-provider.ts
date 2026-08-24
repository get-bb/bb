const CELL_PROVIDER_ALIASES = {
  grok: "acp-grok",
  xai: "acp-grok",
} as const;

export const CANONICAL_GROK_PROVIDER_ID = "acp-grok";

/**
 * Canonicalize a caller-supplied provider id for cell/thread runs.
 * Work Together may send `grok` or `xai`; bb's ACP agent id is `acp-grok`.
 */
export function resolveRequestedProviderId(providerId: string): string {
  const trimmed = providerId.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  return (
    CELL_PROVIDER_ALIASES[trimmed as keyof typeof CELL_PROVIDER_ALIASES] ??
    trimmed
  );
}
