import type { ModelPickerOption } from "@/data/compose";

/**
 * Up to this many models (fresh + retired) the list is short enough to scan by
 * eye, so the search field is more clutter than help. Mirrors the web picker.
 */
export const MODEL_SEARCH_MIN_OPTIONS = 5;

export function showModelSearch(
  modelOptions: readonly ModelPickerOption[],
  moreModelOptions: readonly ModelPickerOption[],
): boolean {
  return (
    modelOptions.length + moreModelOptions.length > MODEL_SEARCH_MIN_OPTIONS
  );
}

/**
 * Build a loose fuzzy RegExp from a plain-text query. Each character is
 * matched in order with `.*` between them, so "gpt4" matches "GPT-4 Turbo".
 */
export function buildFuzzyRegex(query: string): RegExp {
  const pattern = query
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(pattern, "i");
}

// The text a model row is matched against: the visible label, the route
// provider (Pi sub-providers such as "openrouter"), and the raw model id, so
// typing any of them finds the model.
function modelSearchText(option: ModelPickerOption): string {
  return `${option.label} ${option.routeProviderId ?? ""} ${option.value}`;
}

export interface FilteredModelOptions {
  /** Fresh options that match the query (all of them when not searching). */
  modelOptions: readonly ModelPickerOption[];
  /** Retired options that match the query (all of them when not searching). */
  moreModelOptions: readonly ModelPickerOption[];
  isSearching: boolean;
}

/**
 * Fuzzy-filter both model lists by `query`. An empty/whitespace query passes
 * both lists through untouched with `isSearching: false`.
 */
export function filterModelOptions(
  modelOptions: readonly ModelPickerOption[],
  moreModelOptions: readonly ModelPickerOption[],
  query: string,
): FilteredModelOptions {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return { modelOptions, moreModelOptions, isSearching: false };
  }
  const regex = buildFuzzyRegex(normalizedQuery);
  const matches = (option: ModelPickerOption) =>
    regex.test(modelSearchText(option));
  return {
    modelOptions: modelOptions.filter(matches),
    moreModelOptions: moreModelOptions.filter(matches),
    isSearching: true,
  };
}
