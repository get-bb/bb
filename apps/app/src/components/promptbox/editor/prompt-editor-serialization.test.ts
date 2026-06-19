import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Node } from "@tiptap/pm/model";
import type { PromptTextMention } from "@bb/domain";
import {
  PromptMentionExtension,
  promptMentionArgumentHintPlaceholder,
} from "./prompt-mention-extension";
import {
  promptCommandResourceFromSuggestion,
  promptEditorContentFromValue,
  promptEditorInlineContentFromValue,
  promptEditorValueFromDoc,
  type PromptEditorValue,
} from "./prompt-editor-serialization";

// Mirror the editor's StarterKit disables so the schema used in tests matches
// production (see PromptBoxInternal.tsx useEditor extensions).
const schema = getSchema([
  StarterKit.configure({
    blockquote: {},
    bold: {},
    bulletList: {},
    code: {},
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    heading: {},
    horizontalRule: false,
    italic: {},
    link: false,
    listItem: {},
    orderedList: {},
    strike: false,
    underline: false,
  }),
  PromptMentionExtension,
]);

function roundTrip(value: PromptEditorValue): PromptEditorValue {
  const node = Node.fromJSON(schema, promptEditorContentFromValue(value));
  return promptEditorValueFromDoc(node);
}

describe("prompt editor serialization round-trip", () => {
  it("round-trips plain text with no quotes (regression)", () => {
    const value: PromptEditorValue = {
      text: "hello there\nsecond line",
      mentions: [],
    };
    expect(roundTrip(value)).toEqual(value);
  });

  it("round-trips a single one-line quote", () => {
    const value: PromptEditorValue = { text: "> hello", mentions: [] };
    expect(roundTrip(value)).toEqual(value);
  });

  it("round-trips a multi-line quote", () => {
    const value: PromptEditorValue = { text: "> a\n> b", mentions: [] };
    expect(roundTrip(value)).toEqual(value);
  });

  it("round-trips a quote followed by a reply", () => {
    const value: PromptEditorValue = { text: "> a\nmy reply", mentions: [] };
    expect(roundTrip(value)).toEqual(value);
  });

  it("round-trips two quotes each with a reply", () => {
    const value: PromptEditorValue = {
      text: "> q1\nr1\n> q2\nr2",
      mentions: [],
    };
    expect(roundTrip(value)).toEqual(value);
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
    // "> a\nhey @thread done" — the mention "@thread" sits in the reply line.
    const prefix = "> a\nhey ";
    const mentionText = "@thread";
    const text = `${prefix}${mentionText} done`;
    const mention: PromptTextMention = {
      start: prefix.length,
      end: prefix.length + mentionText.length,
      resource: {
        kind: "thread",
        threadId: "thr_123",
        projectId: "proj_1",
        label: "@thread",
      },
    };
    const value: PromptEditorValue = { text, mentions: [mention] };

    const result = roundTrip(value);
    expect(result.text).toBe(text);
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]!.start).toBe(mention.start);
    expect(result.mentions[0]!.end).toBe(mention.end);
    expect(result.mentions[0]!.resource).toEqual(mention.resource);
  });
});

describe("prompt editor markdown serialization (doc -> markdown text)", () => {
  function serialize(content: unknown[]): PromptEditorValue {
    const doc = Node.fromJSON(schema, { type: "doc", content });
    return promptEditorValueFromDoc(doc);
  }

  it("serializes bold, italic, and code marks", () => {
    expect(
      serialize([
        {
          type: "paragraph",
          content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }],
        },
      ]).text,
    ).toBe("**x**");
    expect(
      serialize([
        {
          type: "paragraph",
          content: [{ type: "text", text: "y", marks: [{ type: "italic" }] }],
        },
      ]).text,
    ).toBe("_y_");
    expect(
      serialize([
        {
          type: "paragraph",
          content: [{ type: "text", text: "z", marks: [{ type: "code" }] }],
        },
      ]).text,
    ).toBe("`z`");
  });

  it("nests bold outside italic", () => {
    expect(
      serialize([
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "bold" }, { type: "italic" }],
            },
          ],
        },
      ]).text,
    ).toBe("**_x_**");
  });

  it("serializes headings with the right level", () => {
    expect(
      serialize([
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Title" }],
        },
      ]).text,
    ).toBe("## Title");
  });

  it("serializes bullet and ordered lists", () => {
    expect(
      serialize([
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "a" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "b" }] },
              ],
            },
          ],
        },
      ]).text,
    ).toBe("- a\n- b");
    expect(
      serialize([
        {
          type: "orderedList",
          attrs: { start: 1 },
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "a" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "b" }] },
              ],
            },
          ],
        },
      ]).text,
    ).toBe("1. a\n2. b");
  });

  it("indents nested lists", () => {
    expect(
      serialize([
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "a" }] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "a1" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]).text,
    ).toBe("- a\n  - a1");
  });

  it("separates stacked blocks with a single newline", () => {
    expect(
      serialize([
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "H" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "para" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "i" }] },
              ],
            },
          ],
        },
      ]).text,
    ).toBe("# H\npara\n- i");
  });

  it("keeps a mention's offset correct inside a heading", () => {
    const resource = {
      kind: "thread" as const,
      threadId: "thr_1",
      projectId: "proj_1",
      label: "@thr",
    };
    const result = serialize([
      {
        type: "heading",
        attrs: { level: 2 },
        content: [
          { type: "text", text: "see " },
          { type: "mention", attrs: { resource, serializedText: "@thr" } },
        ],
      },
    ]);
    // "## see @thr" -> mention spans the "@thr" token after the "## see " prefix.
    expect(result.text).toBe("## see @thr");
    expect(result.mentions).toHaveLength(1);
    expect(result.text.slice(result.mentions[0]!.start, result.mentions[0]!.end)).toBe(
      "@thr",
    );
    expect(result.mentions[0]!.resource).toEqual(resource);
  });

  it("keeps a mention's offset correct inside a list item", () => {
    const resource = {
      kind: "thread" as const,
      threadId: "thr_1",
      projectId: "proj_1",
      label: "@thr",
    };
    const result = serialize([
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "first" }] },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "ping " },
                  {
                    type: "mention",
                    attrs: { resource, serializedText: "@thr" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(result.text).toBe("- first\n- ping @thr");
    expect(result.mentions).toHaveLength(1);
    expect(
      result.text.slice(result.mentions[0]!.start, result.mentions[0]!.end),
    ).toBe("@thr");
  });
});

describe("prompt editor serialization", () => {
  it("builds command mention resources from provider command suggestions", () => {
    expect(
      promptCommandResourceFromSuggestion({
        trigger: "/",
        suggestion: {
          kind: "command",
          name: "review",
          source: "skill",
          origin: "user",
          description: "Review code changes",
          argumentHint: "<files>",
        },
      }),
    ).toEqual({
      kind: "command",
      trigger: "/",
      name: "review",
      source: "skill",
      origin: "user",
      label: "review",
      argumentHint: "<files>",
    });
  });

  it("serializes a selected skill as a pill without materializing argument hint text", () => {
    const text = "/review ";
    const mentions: PromptTextMention[] = [
      {
        start: 0,
        end: "/review".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "review",
          source: "skill",
          origin: "user",
          label: "review",
          argumentHint: "<files>",
        },
      },
    ];

    expect(promptEditorInlineContentFromValue({ text, mentions })).toEqual([
      {
        type: "mention",
        attrs: {
          resource: mentions[0].resource,
          serializedText: "/review",
        },
      },
      { type: "text", text: " " },
    ]);
  });

  it("does not render argument hint placeholders for any command source", () => {
    expect(
      promptMentionArgumentHintPlaceholder({
        kind: "command",
        trigger: "/",
        name: "review",
        source: "skill",
        origin: "user",
        label: "review",
        argumentHint: "<files>",
      }),
    ).toBeNull();
    expect(
      promptMentionArgumentHintPlaceholder({
        kind: "command",
        trigger: "/",
        name: "frontend:component",
        source: "command",
        origin: "project",
        label: "frontend:component",
        argumentHint: " $ARGUMENTS ",
      }),
    ).toBeNull();
    expect(
      promptMentionArgumentHintPlaceholder({
        kind: "command",
        trigger: "/",
        name: "note",
        source: "command",
        origin: "user",
        label: "note",
        argumentHint: "<note-path>",
      }),
    ).toBeNull();
  });
});
