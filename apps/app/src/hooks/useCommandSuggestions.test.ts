import { describe, expect, it } from "vitest";
import { AUTOMATION_PROMPT_ACTION } from "@/components/promptbox/PromptBoxActionsMenu";
import {
  commandSuggestionMatchesQuery,
  filterCommandSuggestions,
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
  AUTOMATION_PROMPT_ACTION,
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
        name: "automation",
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

    expect(
      promptActionCommandSuggestions({
        promptActions,
        query: "auto",
        trigger: "/",
      }).map((suggestion) => suggestion.name),
    ).toEqual(["automation"]);
  });
});

describe("commandSuggestionMatchesQuery", () => {
  const pluginSkill = {
    kind: "command",
    name: "review",
    source: "skill",
    origin: "user",
    description: "Review a pull request",
    argumentHint: null,
    pluginId: "github",
  } as const;

  it("filters the cached catalog locally by name and description", () => {
    expect(commandSuggestionMatchesQuery(pluginSkill, "rev")).toBe(true);
    expect(commandSuggestionMatchesQuery(pluginSkill, "pull")).toBe(true);
    expect(commandSuggestionMatchesQuery(pluginSkill, "deploy")).toBe(false);
  });

  it("filters without taking ownership of suggestion ordering", () => {
    const names = filterCommandSuggestions(
      [
        {
          ...pluginSkill,
          name: "deploy-service",
          source: "command",
          origin: "user",
        },
        { ...pluginSkill, name: "deploy-helper" },
        {
          ...pluginSkill,
          name: "review-helper",
          description: "Contains deploy guidance",
        },
        { ...pluginSkill, name: "review-helper", description: null },
      ],
      "deploy",
    ).map((suggestion) => suggestion.name);

    expect(names).toEqual(["deploy-service", "deploy-helper", "review-helper"]);
  });
});
