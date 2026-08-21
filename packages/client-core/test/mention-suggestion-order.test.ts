import { describe, expect, it } from "vitest";
import {
  orderMentionSuggestions,
  type PromptMentionSuggestion,
} from "../src/index.js";

function thread(title: string): PromptMentionSuggestion {
  return {
    kind: "thread",
    path: "thread:t",
    replacement: "thread:t",
    projectId: "p",
    threadId: "t",
    title,
  };
}

function plugin(
  title: string,
  providerId = "installed",
): PromptMentionSuggestion {
  return {
    kind: "plugin",
    pluginId: "at-plugin",
    providerId,
    itemId: `${providerId}:${title}`,
    providerLabel: providerId,
    title,
    subtitle: null,
    icon: null,
    replacement: title,
  };
}

describe("orderMentionSuggestions", () => {
  it("puts an exact match above a prefix match from an earlier section", () => {
    expect(
      orderMentionSuggestions(
        [thread("Plugin migration"), plugin("Plugin")],
        "  PLUGIN ",
      ).map((suggestion) => suggestion.replacement),
    ).toEqual(["Plugin", "thread:t"]);
  });

  it("keeps sections contiguous under their strongest match", () => {
    expect(
      orderMentionSuggestions(
        [
          thread("Plugin migration"),
          plugin("Plugin"),
          plugin("Plugin Guide"),
          plugin("Plugin Shop", "community"),
        ],
        "plugin",
      ).map((suggestion) => suggestion.replacement),
    ).toEqual(["Plugin", "Plugin Guide", "thread:t", "Plugin Shop"]);
  });
});
