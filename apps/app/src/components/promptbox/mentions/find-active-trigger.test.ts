import { describe, expect, it } from "vitest";
import { findActiveTrigger } from "./find-active-trigger";

function editorWithText(
  text: string,
  options: { caret?: number; empty?: boolean } = {},
): Parameters<typeof findActiveTrigger>[0] {
  const caret = options.caret ?? text.length;
  return {
    state: {
      selection: {
        empty: options.empty ?? true,
        from: caret,
      },
      doc: {
        textBetween(from: number, to: number) {
          return text.slice(from, to);
        },
      },
    },
  };
}

describe("findActiveTrigger", () => {
  it("detects a slash command trigger with a skill query", () => {
    expect(
      findActiveTrigger(editorWithText("Run /openai-docs"), [
        { char: "@", kind: "mention" },
        { char: "/", kind: "command" },
      ]),
    ).toEqual({
      char: "/",
      kind: "command",
      query: "openai-docs",
      from: 4,
      to: "Run /openai-docs".length,
    });
  });

  it("captures namespaced slash command queries", () => {
    expect(
      findActiveTrigger(editorWithText("/frontend:component"), [
        { char: "@", kind: "mention" },
        { char: "/", kind: "command" },
      ]),
    ).toMatchObject({
      char: "/",
      kind: "command",
      query: "frontend:component",
    });
  });

  it("does not treat the legacy dollar prefix as an active command trigger", () => {
    expect(
      findActiveTrigger(editorWithText("$openai-docs"), [
        { char: "@", kind: "mention" },
        { char: "/", kind: "command" },
      ]),
    ).toBeNull();
  });
});
