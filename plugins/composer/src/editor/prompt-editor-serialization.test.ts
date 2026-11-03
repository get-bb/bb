import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { promptEditorExtensions } from "./prompt-editor-extensions";
import { Node, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { ComposerMention } from "@get-bb/plugin-sdk/app";
import {
  promptEditorClipboardTextFromSlice,
  promptEditorContentFromValue,
  promptEditorCopiedSlice,
  promptEditorInlineContentFromValue,
  promptEditorValueFromDoc,
  type PromptEditorValue,
} from "./prompt-editor-serialization";

const schema = getSchema(promptEditorExtensions({ getPlaceholder: () => "" }));

function roundTrip(value: PromptEditorValue): PromptEditorValue {
  const node = Node.fromJSON(schema, promptEditorContentFromValue(value));
  return promptEditorValueFromDoc(node);
}

describe("prompt editor serialization round-trip", () => {
  it.each([
    "hello there\nsecond line",
    "# Title\n- **bold**\n- _italic_\n1. `code`",
    "Open apps/app/src/snake_case_file.ts",
  ])(
    "round-trips literal text without applying Markdown formatting: %s",
    (text) => {
      const value: PromptEditorValue = { text, mentions: [] };
      expect(roundTrip(value)).toEqual(value);
    },
  );

  it("round-trips a single one-line quote", () => {
    const value: PromptEditorValue = { text: "> hello", mentions: [] };
    expect(roundTrip(value)).toEqual(value);
  });

  it("round-trips a multi-line quote", () => {
    const value: PromptEditorValue = { text: "> a\n> b", mentions: [] };
    expect(roundTrip(value)).toEqual(value);
  });

  it("canonicalizes a quote followed by a reply with a separator blank", () => {
    const value: PromptEditorValue = { text: "> a\nmy reply", mentions: [] };
    expect(roundTrip(value)).toEqual({
      text: "> a\n\nmy reply",
      mentions: [],
    });
  });

  it("canonicalizes two quotes each with a reply", () => {
    const value: PromptEditorValue = {
      text: "> q1\nr1\n> q2\nr2",
      mentions: [],
    };
    expect(roundTrip(value)).toEqual({
      text: "> q1\n\nr1\n> q2\n\nr2",
      mentions: [],
    });
  });

  it("round-trips a quote with an internal blank line", () => {
    const value: PromptEditorValue = { text: "> a\n>\n> b", mentions: [] };
    expect(roundTrip(value)).toEqual(value);
  });

  it("round-trips an empty string", () => {
    const value: PromptEditorValue = { text: "", mentions: [] };
    expect(roundTrip(value)).toEqual(value);
  });

  it("preserves a mention's offsets in a reply after a quote", () => {
    const prefix = "> a\n\nhey ";
    const mentionText = "@thread";
    const text = `${prefix}${mentionText} done`;
    const mention: ComposerMention = {
      from: prefix.length,
      to: prefix.length + mentionText.length,
      kind: "thread",
      threadId: "thr_123",
      projectId: "proj_1",
      label: "@thread",
    };
    const value: PromptEditorValue = { text, mentions: [mention] };

    expect(roundTrip(value)).toEqual(value);
  });
});

describe("prompt editor clipboard serialization", () => {
  function clipboardText(content: unknown[]): string {
    const doc = Node.fromJSON(schema, { type: "doc", content });
    return promptEditorClipboardTextFromSlice(
      new Slice(doc.content, 0, 0),
      schema,
    );
  }

  it("copies separate prompt lines with a single newline", () => {
    expect(
      clipboardText([
        { type: "paragraph", content: [{ type: "text", text: "first" }] },
        { type: "paragraph", content: [{ type: "text", text: "second" }] },
      ]),
    ).toBe("first\nsecond");
  });

  it("copies hard-break prompt lines with the same single newline", () => {
    expect(
      clipboardText([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "first" },
            { type: "hardBreak" },
            { type: "text", text: "second" },
          ],
        },
      ]),
    ).toBe("first\nsecond");
  });

  it("copies a blockquote without adding a trailing blank line", () => {
    expect(
      clipboardText([
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "quoted" }],
            },
          ],
        },
      ]),
    ).toBe("> quoted");
  });
});

describe("promptEditorCopiedSlice", () => {
  function copiedText(markdown: string, from: string, to: string): string {
    const doc = Node.fromJSON(
      schema,
      promptEditorContentFromValue({ text: markdown, mentions: [] }),
    );
    const positionOf = (needle: string): number => {
      let position: number | null = null;
      doc.descendants((node, nodePosition) => {
        const index = node.isText ? (node.text ?? "").indexOf(needle) : -1;
        if (position === null && index >= 0) {
          position = nodePosition + index;
        }
      });
      if (position === null) {
        throw new Error(`Missing ${needle}`);
      }
      return position;
    };
    const selection = TextSelection.create(
      doc,
      positionOf(from),
      positionOf(to) + to.length,
    );
    return promptEditorClipboardTextFromSlice(
      promptEditorCopiedSlice(selection.content(), selection),
      schema,
    );
  }

  it("drops the quote around part of a line", () => {
    expect(copiedText("> hello world", "ello", "ello")).toBe("ello");
  });

  it("keeps the quote around a whole line", () => {
    expect(copiedText("> hello world", "hello", "world")).toBe("> hello world");
  });

  it("keeps the quote around one whole line of a multi-line quote", () => {
    expect(copiedText("> first\n> second", "second", "second")).toBe(
      "> second",
    );
    expect(copiedText("> first\n> second", "econ", "econ")).toBe("econ");
  });

  it("drops a quote around a partial selection spanning several of its paragraphs", () => {
    expect(copiedText("> first\n>\n> second", "irst", "sec")).toBe(
      "irst\n\nsec",
    );
  });

  it("keeps a quote the selection only partly covers", () => {
    expect(copiedText("> quoted\n\nafter", "uoted", "af")).toBe(
      "> uoted\n\naf",
    );
  });
});

describe("prompt editor serialization", () => {
  it("round-trips a project mention through the editor document", () => {
    const value: PromptEditorValue = {
      text: "look at @project:proj_abc please",
      mentions: [
        {
          from: "look at ".length,
          to: "look at @project:proj_abc".length,
          kind: "project",
          projectId: "proj_abc",
          label: "Alpha Service",
        },
      ],
    };

    expect(roundTrip(value)).toEqual(value);
  });

  it("serializes a selected skill as a pill without materializing argument hint text", () => {
    const text = "/review ";
    const mentions: ComposerMention[] = [
      {
        from: 0,
        to: "/review".length,
        kind: "command",
        trigger: "/",
        name: "review",
        source: "skill",
        origin: "user",
        label: "review",
        argumentHint: "<files>",
      },
    ];

    expect(promptEditorInlineContentFromValue({ text, mentions })).toEqual([
      {
        type: "mention",
        attrs: {
          mention: {
            kind: "command",
            trigger: "/",
            name: "review",
            source: "skill",
            origin: "user",
            label: "review",
            argumentHint: "<files>",
          },
          serializedText: "/review",
        },
      },
      { type: "text", text: " " },
    ]);
  });
});

describe("prompt editor mention word boundaries", () => {
  function skill(from: number, name: string): ComposerMention {
    return {
      from,
      to: from + 1 + name.length,
      kind: "command",
      trigger: "/",
      name,
      source: "skill",
      origin: "user",
      label: name,
      argumentHint: null,
    };
  }

  function thread(from: number, threadId: string): ComposerMention {
    return {
      from,
      to: from + "@thread:".length + threadId.length,
      kind: "thread",
      threadId,
      label: threadId,
    };
  }

  it.each([
    {
      name: "a word typed right after a pill",
      input: {
        text: "I am lost. /poteto-modeAlso testing",
        mentions: [skill(11, "poteto-mode")],
      },
      expected: {
        text: "I am lost. /poteto-mode Also testing",
        mentions: [skill(11, "poteto-mode")],
      },
    },
    {
      name: "a word typed right before a pill",
      input: { text: "hello/review", mentions: [skill(5, "review")] },
      expected: { text: "hello /review", mentions: [skill(6, "review")] },
    },
    {
      name: "two adjacent pills",
      input: {
        text: "@thread:thr_a@thread:thr_b",
        mentions: [thread(0, "thr_a"), thread(13, "thr_b")],
      },
      expected: {
        text: "@thread:thr_a @thread:thr_b",
        mentions: [thread(0, "thr_a"), thread(14, "thr_b")],
      },
    },
    {
      name: "a pill inside a quote",
      input: { text: "> /reviewAlso", mentions: [skill(2, "review")] },
      expected: { text: "> /review Also", mentions: [skill(2, "review")] },
    },
  ])("separates $name", ({ input, expected }) => {
    const separated = roundTrip(input);
    expect(separated).toEqual(expected);
    expect(roundTrip(separated)).toEqual(expected);
  });

  it.each([
    { text: "see /review, then", mentions: [skill(4, "review")] },
    { text: "(/review)", mentions: [skill(1, "review")] },
    { text: "/review world", mentions: [skill(0, "review")] },
    { text: "/review\nAlso", mentions: [skill(0, "review")] },
    { text: "/review", mentions: [skill(0, "review")] },
  ])("leaves punctuation, whitespace and line breaks alone: $text", (value) => {
    expect(roundTrip(value)).toEqual(value);
  });
});
