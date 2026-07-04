import { describe, expect, it } from "vitest";
import { LOOP_PROMPT_ACTION } from "@/components/promptbox/PromptBoxActionsMenu";
import {
  mergeCommandSuggestions,
  promptActionCommandSuggestions,
} from "./useCommandSuggestions";

const promptActions = [
  { kind: "skills", text: "/" },
  {
    kind: "plan",
    command: { trigger: "/", name: "plan", trailingText: " " },
    text: "/plan ",
  },
  {
    kind: "goal",
    command: { trigger: "/", name: "goal", trailingText: " " },
    text: "/goal ",
  },
  LOOP_PROMPT_ACTION,
] as const;

describe("promptActionCommandSuggestions", () => {
  it("turns prompt action commands into slash command suggestions", () => {
    expect(
      promptActionCommandSuggestions({
        promptActions,
        query: "",
        trigger: "/",
      }),
    ).toEqual([
      {
        kind: "command",
        name: "plan",
        source: "command",
        origin: "user",
        description: null,
        argumentHint: null,
      },
      {
        kind: "command",
        name: "goal",
        source: "command",
        origin: "user",
        description: null,
        argumentHint: null,
      },
      {
        kind: "command",
        name: "loop",
        source: "command",
        origin: "user",
        description: null,
        argumentHint: null,
      },
    ]);
  });

  it("filters prompt action commands by the active query", () => {
    expect(
      promptActionCommandSuggestions({
        promptActions,
        query: "lo",
        trigger: "/",
      }).map((suggestion) => suggestion.name),
    ).toEqual(["loop"]);
  });
});

describe("mergeCommandSuggestions", () => {
  it("returns commands in the shared visual section order after merging", () => {
    expect(
      mergeCommandSuggestions(
        [
          {
            kind: "command",
            name: "loop",
            source: "command",
            origin: "user",
            description: null,
            argumentHint: null,
          },
        ],
        [
          {
            kind: "command",
            name: "review",
            source: "skill",
            origin: "user",
            description: "Review code changes",
            argumentHint: null,
          },
          {
            kind: "command",
            name: "open",
            source: "plugin",
            origin: "user",
            description: "Open Linear issue",
            argumentHint: null,
            pluginId: "linear",
          },
          {
            kind: "command",
            name: "frontend:component",
            source: "command",
            origin: "project",
            description: "Create a component",
            argumentHint: null,
          },
        ],
      ).map((suggestion) => suggestion.name),
    ).toEqual(["review", "open", "frontend:component", "loop"]);
  });

  it("keeps same-named plugin commands from different plugins", () => {
    expect(
      mergeCommandSuggestions(
        [],
        [
          {
            kind: "command",
            name: "open",
            source: "plugin",
            origin: "user",
            description: "Open Linear issue",
            argumentHint: null,
            pluginId: "linear",
          },
          {
            kind: "command",
            name: "open",
            source: "plugin",
            origin: "user",
            description: "Open GitHub issue",
            argumentHint: null,
            pluginId: "github",
          },
          {
            kind: "command",
            name: "open",
            source: "plugin",
            origin: "user",
            description: "Duplicate Linear issue",
            argumentHint: null,
            pluginId: "linear",
          },
        ],
      ).map((suggestion) => suggestion.description),
    ).toEqual(["Open Linear issue", "Open GitHub issue"]);
  });
});
