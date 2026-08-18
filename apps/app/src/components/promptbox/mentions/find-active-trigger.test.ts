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

  it("detects a trigger near the caret in a very large document", () => {
    const bulk = "x".repeat(500_000);
    const text = `${bulk} /deploy`;
    expect(
      findActiveTrigger(editorWithText(text), [
        { char: "@", kind: "mention" },
        { char: "/", kind: "command" },
      ]),
    ).toEqual({
      char: "/",
      kind: "command",
      query: "deploy",
      from: bulk.length + 1,
      to: text.length,
    });
  });

  it("does not fake a start-of-input boundary at the scan-window edge", () => {
    // The trigger char sits mid-word (preceded by a letter). With a windowed
    // scan whose window happens to begin exactly at the trigger char, the `^`
    // branch must not fire and open a menu.
    const prefix = "y".repeat(500_000);
    const tail = "z".repeat(255);
    const text = `${prefix}@${tail}`;
    expect(
      findActiveTrigger(editorWithText(text), [{ char: "@", kind: "mention" }]),
    ).toBeNull();
  });
});
