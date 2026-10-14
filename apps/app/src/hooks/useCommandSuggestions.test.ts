import { describe, expect, it } from "vitest";
import {
  discoveredCommandSuggestions,
  isCommandSuggestionsActive,
  promptActionCommandSuggestions,
  shouldPrefetchCommandCatalog,
  threadProviderCommandSuggestions,
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
    ]);
  });

  it("filters prompt action commands by the active query", () => {
    expect(
      promptActionCommandSuggestions({
        promptActions,
        query: "pl",
        trigger: "/",
      }).map((suggestion) => suggestion.name),
    ).toEqual(["plan"]);
  });
});

describe("threadProviderCommandSuggestions", () => {
  const commands = [
    {
      name: "review",
      source: "command",
      origin: "builtin",
      description: "Review the diff",
      argumentHint: null,
    },
    {
      name: "web",
      source: "command",
      origin: "builtin",
      description: null,
      argumentHint: "query",
    },
  ] as const;

  it("offers the agent's live commands under the slash trigger only", () => {
    expect(
      threadProviderCommandSuggestions({ commands, query: "", trigger: "/" }),
    ).toEqual([
      {
        kind: "command",
        name: "review",
        source: "command",
        origin: "builtin",
        description: "Review the diff",
        argumentHint: null,
      },
      {
        kind: "command",
        name: "web",
        source: "command",
        origin: "builtin",
        description: null,
        argumentHint: "query",
      },
    ]);
    expect(
      threadProviderCommandSuggestions({ commands, query: "", trigger: "$" }),
    ).toEqual([]);
    expect(
      threadProviderCommandSuggestions({
        commands: null,
        query: "",
        trigger: "/",
      }),
    ).toEqual([]);
  });

  it("filters them by the typed query", () => {
    expect(
      threadProviderCommandSuggestions({
        commands,
        query: "we",
        trigger: "/",
      }).map((suggestion) => suggestion.name),
    ).toEqual(["web"]);
  });
});

const BASE_ARGS = {
  projectId: "project-1",
  providerId: "codex",
  skillsTriggers: ["/"] as const,
  activeTrigger: null,
  query: null,
};

describe("useCommandSuggestions catalog prefetch", () => {
  it("warms the command catalog when a coarse-pointer composer gains focus", () => {
    expect(
      shouldPrefetchCommandCatalog({
        ...BASE_ARGS,
        composerFocused: false,
        isPointerCoarse: true,
      }),
    ).toBe(false);
    expect(
      shouldPrefetchCommandCatalog({
        ...BASE_ARGS,
        composerFocused: true,
        isPointerCoarse: true,
      }),
    ).toBe(true);
    expect(isCommandSuggestionsActive(BASE_ARGS)).toBe(false);
  });

  it("does not add a request for fine-pointer composers, which autofocus on mount", () => {
    expect(
      shouldPrefetchCommandCatalog({
        ...BASE_ARGS,
        composerFocused: true,
        isPointerCoarse: false,
      }),
    ).toBe(false);
    expect(isCommandSuggestionsActive(BASE_ARGS)).toBe(false);
  });

  it("still fetches on the first trigger without any focus signal", () => {
    expect(
      isCommandSuggestionsActive({
        ...BASE_ARGS,
        activeTrigger: "/",
        query: "",
      }),
    ).toBe(true);
  });

  it("offers only skills for the explicit dollar trigger", () => {
    expect(
      discoveredCommandSuggestions({
        commands: [
          {
            name: "writing-for-agents",
            source: "skill",
            origin: "user",
            description: "Write agent instructions",
            argumentHint: null,
          },
          {
            name: "plan",
            source: "command",
            origin: "builtin",
            description: "Plan work",
            argumentHint: null,
          },
        ],
        trigger: "$",
        commandScope: "thread",
        query: "",
      }).map((suggestion) => suggestion.name),
    ).toEqual(["writing-for-agents"]);
  });
});
