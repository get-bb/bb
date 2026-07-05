/**
 * Drops the brand prefix from a model label once provider context is
 * unambiguous (the trigger shows the provider icon; the menu shows provider
 * tabs above the model list). "Sonnet 4.6" / "5.5" reads cleaner than
 * "Claude Sonnet 4.6" / "GPT-5.5".
 *
 * Lives at the picker's render site rather than in `formatModelLabel` so
 * stories — which hand picker labels in directly — see the same trigger and
 * menu output as production paths that go through the formatter.
 */
export function stripModelBrandPrefix(
  label: string,
  providerId: string,
): string {
  switch (providerId) {
    case "claude-code":
      return label.replace(/^Claude\s+/i, "");
    case "codex":
      return label.replace(/^GPT-/i, "");
    default:
      return label;
  }
}

const PROVIDER_DISPLAY_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  cursor: "Cursor",
  google: "Google",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  xai: "xAI",
  "xai-oauth": "xAI",
  zai: "Z.AI",
};

/**
 * Extracts the provider segment from a `provider/modelId` model value, or null
 * when the value has no provider prefix (codex/claude-code use bare ids).
 */
export function modelOptionProvider(value: string): string | null {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    return null;
  }
  return value.slice(0, slash);
}

function providerDisplayLabel(provider: string): string {
  return (
    PROVIDER_DISPLAY_LABELS[provider] ??
    provider
      .replace(/-/g, " ")
      .replace(/\b\w/g, (match) => match.toUpperCase())
  );
}

export interface ModelOptionGroup<
  TOption extends { value: string; label: string },
> {
  providerKey: string;
  providerLabel: string;
  options: readonly TOption[];
}

/**
 * Groups model options by their `provider/` prefix so ACP agents like omp (whose
 * catalog spans cursor / openai-codex / xai-oauth / zai) can surface a header
 * per provider in the model dropdown. Returns null when options carry fewer
 * than two distinct provider prefixes, so single-provider catalogs (codex,
 * claude-code) keep rendering as a flat list with a single "Model" header.
 */
export function groupModelOptionsByProvider<
  TOption extends { value: string; label: string },
>(options: readonly TOption[]): ModelOptionGroup<TOption>[] | null {
  const providers = new Set<string>();
  for (const option of options) {
    const provider = modelOptionProvider(option.value);
    if (provider) {
      providers.add(provider);
    }
  }
  if (providers.size < 2) {
    return null;
  }
  const buckets = new Map<string, TOption[]>();
  for (const option of options) {
    const provider = modelOptionProvider(option.value) ?? "other";
    const bucket = buckets.get(provider);
    if (bucket) {
      bucket.push(option);
    } else {
      buckets.set(provider, [option]);
    }
  }
  return [...buckets.entries()].map(([provider, groupedOptions]) => ({
    providerKey: provider,
    providerLabel: providerDisplayLabel(provider),
    options: groupedOptions,
  }));
}
