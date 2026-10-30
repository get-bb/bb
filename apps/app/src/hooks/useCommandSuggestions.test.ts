import { describe, expect, it } from "vitest";
import {
  discoveredCommandSuggestions,
  promptActionCommandSuggestions,
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
      threadProviderCommandSuggestions({
        commands,
        catalog: [],
        query: "",
        trigger: "/",
      }),
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
      threadProviderCommandSuggestions({
        commands,
        catalog: [],
        query: "",
        trigger: "$",
      }),
    ).toEqual([]);
    expect(
      threadProviderCommandSuggestions({
        commands: null,
        catalog: [],
        query: "",
        trigger: "/",
      }),
    ).toEqual([]);
  });

  it("filters them by the typed query", () => {
    expect(
      threadProviderCommandSuggestions({
        commands,
        catalog: [],
        query: "we",
        trigger: "/",
      }).map((suggestion) => suggestion.name),
    ).toEqual(["web"]);
  });

  it("leaves names the scanned catalog already offers to the catalog", () => {
    expect(
      threadProviderCommandSuggestions({
        commands,
        catalog: [
          {
            name: "review",
            source: "skill",
            origin: "user",
            description: "Review from the user's skill",
            argumentHint: null,
          },
        ],
        query: "",
        trigger: "/",
      }).map((suggestion) => suggestion.name),
    ).toEqual(["web"]);
  });
});

describe("discoveredCommandSuggestions", () => {
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
