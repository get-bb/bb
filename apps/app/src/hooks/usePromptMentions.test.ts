import { describe, expect, it } from "vitest";
import { shouldShowPluginProviderSuggestions } from "./usePromptMentions";

describe("shouldShowPluginProviderSuggestions", () => {
  it("hides provider rows while the current query differs from the debounced search", () => {
    expect(
      shouldShowPluginProviderSuggestions({
        debouncedQuery: "fix",
        hasMentionProviders: true,
        isPlaceholderData: false,
        trimmedQuery: "zzz",
      }),
    ).toBe(false);
  });

  it("hides provider rows while React Query is serving placeholder data", () => {
    expect(
      shouldShowPluginProviderSuggestions({
        debouncedQuery: "fix",
        hasMentionProviders: true,
        isPlaceholderData: true,
        trimmedQuery: "fix",
      }),
    ).toBe(false);
  });

  it("shows provider rows only for live data matching the current query", () => {
    expect(
      shouldShowPluginProviderSuggestions({
        debouncedQuery: "fix",
        hasMentionProviders: true,
        isPlaceholderData: false,
        trimmedQuery: "fix",
      }),
    ).toBe(true);
  });
});
