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

  it("detects a hash mention trigger with an issue query", () => {
    expect(
      findActiveTrigger(editorWithText("Look at #42"), [
        { char: "@", kind: "mention" },
        { char: "#", kind: "mention" },
        { char: "/", kind: "command" },
      ]),
    ).toEqual({
      char: "#",
      kind: "mention",
      query: "42",
      from: "Look at ".length,
      to: "Look at #42".length,
    });
  });

  it("does not treat markdown hash headings as mention queries", () => {
    expect(
      findActiveTrigger(editorWithText("##"), [
        { char: "@", kind: "mention" },
        { char: "#", kind: "mention" },
        { char: "/", kind: "command" },
      ]),
    ).toBeNull();
  });

  it("does not extend a mention query through a repeated trigger char", () => {
    expect(
      findActiveTrigger(editorWithText("Look at #one#two"), [
        { char: "@", kind: "mention" },
        { char: "#", kind: "mention" },
        { char: "/", kind: "command" },
      ]),
    ).toBeNull();
  });

  it("does not treat dollar as an active command trigger", () => {
    expect(
      findActiveTrigger(editorWithText("$openai-docs"), [
        { char: "@", kind: "mention" },
        { char: "/", kind: "command" },
      ]),
    ).toBeNull();
  });
});
