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
    bold: false,
    bulletList: false,
    code: false,
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    heading: false,
    horizontalRule: false,
    italic: false,
    listItem: false,
    orderedList: false,
    strike: false,
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
