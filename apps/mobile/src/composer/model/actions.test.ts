import { describe, expect, it } from "vitest";
import {
  buildComposerPromptActions,
  resolvePromptActionInsertion,
} from "./actions";
import { createComposerValue } from "./document";
import { composerValueToPromptEditorValue } from "./serialization";

describe("buildComposerPromptActions", () => {
  it("orders provider + app actions and exposes the skills trigger", () => {
    const result = buildComposerPromptActions([
      {
        kind: "plan",
        command: { trigger: "/", name: "plan", trailingText: " " },
      },
      { kind: "skills", trigger: "/" },
    ]);
    expect(result.skillsTrigger).toBe("/");
    expect(result.actions.map((action) => action.kind)).toEqual([
      "skills",
      "plan",
      "automation",
      "plugin",
    ]);
  });

  it("has no command trigger for a provider without a skills action", () => {
    const result = buildComposerPromptActions([]);
    expect(result.skillsTrigger).toBeNull();
    expect(result.actions.map((action) => action.kind)).toEqual([
      "automation",
      "plugin",
    ]);
  });
});

describe("resolvePromptActionInsertion", () => {
  const plan = {
    kind: "plan" as const,
    text: "/plan ",
    command: { trigger: "/" as const, name: "plan", trailingText: " " },
  };

  it("inserts a command pill with its trailing text and a separating space", () => {
    const result = resolvePromptActionInsertion(
      createComposerValue("fix it"),
      6,
      plan,
    );
    expect(result?.value.text).toBe("fix it /plan ");
    expect(result?.caret).toBe(13);
    expect(composerValueToPromptEditorValue(result!.value)).toEqual({
      text: "fix it /plan ",
      mentions: [
        {
          start: 7,
          end: 12,
          resource: {
            kind: "command",
            trigger: "/",
            name: "plan",
            source: "command",
            origin: "user",
            label: "plan",
            argumentHint: null,
          },
        },
      ],
    });
  });

  it("does not duplicate a command pill already at the caret", () => {
    const first = resolvePromptActionInsertion(
      createComposerValue(""),
      0,
      plan,
    )!;
    // Caret right after the pill (before the trailing space).
    expect(resolvePromptActionInsertion(first.value, 5, plan)).toBeNull();
  });

  it("inserts the skills trigger and plain prompts as text", () => {
    const skills = { kind: "skills" as const, text: "/" };
    expect(
      resolvePromptActionInsertion(createComposerValue("hi"), 2, skills),
    ).toMatchObject({
      caret: 4,
    });
    const plugin = {
      kind: "plugin" as const,
      text: "Create a new bb plugin that ",
    };
    const result = resolvePromptActionInsertion(
      createComposerValue(""),
      0,
      plugin,
    )!;
    expect(result.value.text).toBe("Create a new bb plugin that ");
    expect(
      resolvePromptActionInsertion(result.value, result.caret, plugin),
    ).toBeNull();
  });
});
