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

  it("ranks a namespaced skill by its direct name without another fetch", () => {
    const names = filterCommandSuggestions(
      [
        { ...pluginSkill, name: "alpha-review-notes" },
        { ...pluginSkill, name: "ottonomous:review" },
        { ...pluginSkill, name: "zeta-review" },
      ],
      "review",
    ).map((suggestion) => suggestion.name);

    expect(names).toEqual([
      "ottonomous:review",
      "alpha-review-notes",
      "zeta-review",
    ]);
  });

  it("keeps menu sections primary when ranking non-exact matches", () => {
    const names = filterCommandSuggestions(
      [
        {
          ...pluginSkill,
          name: "review-helper",
          description: "Contains deploy guidance",
        },
        {
          ...pluginSkill,
          name: "deploy-service",
          source: "command",
          origin: "user",
        },
      ],
      "deploy",
    ).map((suggestion) => suggestion.name);

    expect(names).toEqual(["review-helper", "deploy-service"]);
  });

  it("ranks an exact user-command name above skills from an earlier section", () => {
    const names = filterCommandSuggestions(
      [
        {
          ...pluginSkill,
          name: "deploy-review",
          description: "Contains deploy guidance",
        },
        {
          ...pluginSkill,
          name: "deploy",
          source: "command",
          origin: "user",
        },
      ],
      "deploy",
    ).map((suggestion) => suggestion.name);

    expect(names).toEqual(["deploy", "deploy-review"]);
  });
});
