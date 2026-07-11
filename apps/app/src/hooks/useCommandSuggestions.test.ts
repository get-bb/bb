import { describe, expect, it } from "vitest";
import { AUTOMATION_PROMPT_ACTION } from "@/components/promptbox/PromptBoxActionsMenu";
import { promptActionCommandSuggestions } from "./useCommandSuggestions";

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
        query: "auto",
        trigger: "/",
      }).map((suggestion) => suggestion.name),
    ).toEqual(["automation"]);
  });
});
