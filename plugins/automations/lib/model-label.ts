/**
 * The composer's model-label rules, duplicated for the automations plugin.
 *
 * The plugin only depends on `@bb/shared-ui`, so it cannot import from
 * `apps/app`, and moving these into shared-ui was rejected: `provider-icon.ts`
 * would drag `the provider catalog` and eight brand SVGs into a package that
 * currently has five dependencies and no domain knowledge.
 *
 * `formatModelLabel` and `stripModelBrandPrefix` below are verbatim copies so
 * drift against the originals shows up as a plain diff:
 *   - apps/app/src/hooks/thread-creation-options/selection-state.ts:310
 *   - apps/app/src/components/pickers/model-brand-prefix.ts:11
 *
 * Only `formatAutomationModelLabel` is new, and it is genuinely
 * automation-specific: the composer feeds the formatter a `displayName` from
 * the model catalogue ("Claude Opus 5"), but an automation persists only the
 * raw id ("claude-opus-5") with no catalogue lookup available here.
 */

/** Verbatim from selection-state.ts:310. */
export function formatModelLabel(value: string): string {
  return value
    .split("-")
    .map((part) => {
      if (part.toLowerCase() === "gpt") return "GPT";
      if (/^\d+(\.\d+)*$/.test(part)) return part;
      if (/^[a-z]+$/i.test(part)) {
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      }
      return part;
    })
    .join("-");
}

/**
 * Verbatim from model-brand-prefix.ts:11, with one widening: automations
 * persist `providerId` as an unvalidated free string (rpc-types.ts:126) and the
 * fixtures use "claude" while the catalogue's canonical id is "claude-code", so
 * this matches on prefix rather than exact equality. Remove the widening once
 * the stored id space is reconciled.
 */
export function stripModelBrandPrefix(
  label: string,
  providerId: string,
): string {
  if (providerId.startsWith("claude")) {
    return label.replace(/^Claude\s+/i, "");
  }
  if (providerId.startsWith("codex") || providerId.startsWith("openai")) {
    return label.replace(/^GPT-/i, "");
  }
  return label;
}

/**
 * Reach the composer's output from a raw model id.
 *
 * `formatModelLabel` splits and rejoins on "-", so a raw id survives as
 * "Claude-Opus-5". Strip the provider prefix while that delimiter is still
 * present, then turn the remaining id separators into spaces. Doing this in
 * the opposite order prevents the composer's `GPT-` rule from matching.
 */
export function formatAutomationModelLabel(
  model: string,
  providerId: string,
): string {
  const contextMatch = model.match(/^(.*)\[(\d+(?:\.\d+)?[km])\]$/i);
  const modelId = contextMatch?.[1] ?? model;
  const context = contextMatch?.[2]?.toUpperCase();
  const formatted = formatModelLabel(modelId);
  const withoutBrand = providerId.startsWith("claude")
    ? formatted.replace(/^Claude-/i, "")
    : stripModelBrandPrefix(formatted, providerId);
  const withVersion = providerId.startsWith("claude")
    ? withoutBrand.replace(/-(\d+)-(\d+)(?=-|$)/, "-$1.$2")
    : withoutBrand;
  const label = withVersion.split("-").join(" ");
  return context ? `${label} (${context})` : label;
}

/** Providers read as names in the composer, never as raw ids. */
export function formatAutomationProviderLabel(providerId: string): string {
  if (providerId.startsWith("claude")) return "Claude";
  if (providerId.startsWith("codex")) return "Codex";
  if (providerId.startsWith("openai")) return "OpenAI";
  if (providerId === "pi") return "Pi";
  if (providerId === "acp-cursor") return "Cursor";
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}
