import type { PromptMentionResource } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { createComposerValue, insertMention } from "./document";
import {
  appendQuoteToComposerValue,
  commandInsertionFromSuggestion,
  composerValueFromPromptEditorValue,
  composerValueFromPromptInput,
  composerValueToPromptEditorValue,
  composerValueToPromptInput,
  mentionDisplayText,
  mentionInsertionFromSuggestion,
  type PromptEditorValue,
} from "./serialization";

const THREAD: PromptMentionResource = {
  kind: "thread",
  threadId: "thr_1",
  projectId: "proj_1",
  label: "Fix login",
};
const FILE: PromptMentionResource = {
  kind: "path",
  source: "workspace",
  entryKind: "file",
  path: "apps/app/src/foo.ts",
  label: "foo.ts",
};
const REVIEW: PromptMentionResource = {
  kind: "command",
  trigger: "/",
  name: "review",
  source: "command",
  origin: "user",
  label: "review",
  argumentHint: null,
};

/**
 * Fixtures mirror what the web editor emits for the same pills
 * (`serializedText` spans in `PromptEditorValue`) and what
 * `promptDraftToInput` then sends. The native composer must reach the same
 * `PromptInput` from its display-text model.
 */
describe("PromptEditorValue round trip", () => {
  it("plain text", () => {
    const value = createComposerValue("hello there\nsecond line");
    const editor = composerValueToPromptEditorValue(value);
    expect(editor).toEqual({ text: "hello there\nsecond line", mentions: [] });
    expect(composerValueToPromptInput(value)).toEqual([
      { type: "text", text: "hello there\nsecond line", mentions: [] },
    ]);
  });

  it("one thread mention: web text is `@thread:<id>`, pill shows `@<label>`", () => {
    // What the web persists/sends for "look at @thread:thr_1 please".
    const web: PromptEditorValue = {
      text: "look at @thread:thr_1 please",
      mentions: [{ start: 8, end: 21, resource: THREAD }],
    };
    const value = composerValueFromPromptEditorValue(web);
    expect(value.text).toBe("look at @Fix login please");
    expect(value.mentions).toEqual([
      {
        start: 8,
        end: 18,
        resource: THREAD,
        serializedText: "@thread:thr_1",
      },
    ]);
    expect(composerValueToPromptEditorValue(value)).toEqual(web);
    expect(composerValueToPromptInput(value)).toEqual([
      {
        type: "text",
        text: "look at @thread:thr_1 please",
        mentions: [{ start: 8, end: 21, resource: THREAD }],
      },
    ]);
  });

  it("a path mention keeps the full path in the serialized text", () => {
    const web: PromptEditorValue = {
      text: "open @apps/app/src/foo.ts now",
      mentions: [{ start: 5, end: 25, resource: FILE }],
    };
    const value = composerValueFromPromptEditorValue(web);
    expect(value.text).toBe("open @foo.ts now");
    expect(composerValueToPromptEditorValue(value)).toEqual(web);
  });

  it("a slash command pill serializes back to `/name`", () => {
    const web: PromptEditorValue = {
      text: "/review the diff",
      mentions: [{ start: 0, end: 7, resource: REVIEW }],
    };
    const value = composerValueFromPromptEditorValue(web);
    expect(value.text).toBe("/review the diff");
    expect(composerValueToPromptEditorValue(value)).toEqual(web);
    expect(composerValueToPromptInput(value)).toEqual([
      {
        type: "text",
        text: "/review the diff",
        mentions: [{ start: 0, end: 7, resource: REVIEW }],
      },
    ]);
  });

  it("attachments become localImage / localFile parts after the text", () => {
    const value = createComposerValue("  see attached  ");
    expect(
      composerValueToPromptInput(value, [
        {
          type: "localImage",
          path: "img-1.png",
          name: "img-1.png",
          sizeBytes: 10,
        },
        {
          type: "localFile",
          path: "doc-1.pdf",
          name: "doc.pdf",
          sizeBytes: 20,
          mimeType: "application/pdf",
        },
      ]),
    ).toEqual([
      { type: "text", text: "see attached", mentions: [] },
      { type: "localImage", path: "img-1.png" },
      {
        type: "localFile",
        path: "doc-1.pdf",
        name: "doc.pdf",
        sizeBytes: 20,
        mimeType: "application/pdf",
      },
    ]);
  });

  it("attachments-only drafts produce no text part", () => {
    expect(
      composerValueToPromptInput(createComposerValue(""), [
        {
          type: "localImage",
          path: "img-1.png",
          name: "img-1.png",
          sizeBytes: 0,
        },
      ]),
    ).toEqual([{ type: "localImage", path: "img-1.png" }]);
  });

  it("trims surrounding whitespace and clips mention offsets like the web", () => {
    const web: PromptEditorValue = {
      text: "  @thread:thr_1 hi  ",
      mentions: [{ start: 2, end: 15, resource: THREAD }],
    };
    const value = composerValueFromPromptEditorValue(web);
    expect(composerValueToPromptInput(value)).toEqual([
      {
        type: "text",
        text: "@thread:thr_1 hi",
        mentions: [{ start: 0, end: 13, resource: THREAD }],
      },
    ]);
  });

  it("seeds from PromptInput (fork / handoff / edit)", () => {
    const seeded = composerValueFromPromptInput([
      {
        type: "text",
        text: "redo @thread:thr_1",
        mentions: [{ start: 5, end: 18, resource: THREAD }],
      },
      { type: "localFile", path: "notes.md", name: "notes.md", sizeBytes: 3 },
    ]);
    expect(seeded.value.text).toBe("redo @Fix login");
    expect(seeded.attachments).toEqual([
      { type: "localFile", path: "notes.md", name: "notes.md", sizeBytes: 3 },
    ]);
  });

  it("drops invalid or overlapping web ranges instead of corrupting offsets", () => {
    const web: PromptEditorValue = {
      text: "@thread:thr_1 x",
      mentions: [
        { start: 0, end: 13, resource: THREAD },
        { start: 5, end: 9, resource: THREAD },
        { start: 10, end: 40, resource: THREAD },
      ],
    };
    const value = composerValueFromPromptEditorValue(web);
    expect(value.mentions).toHaveLength(1);
    expect(value.text).toBe("@Fix login x");
  });
});

describe("insertion from suggestions", () => {
  it("prefixes the trigger char unless the replacement carries it", () => {
    const thread = mentionInsertionFromSuggestion(
      {
        kind: "thread",
        path: "thread:thr_1",
        replacement: "thread:thr_1",
        projectId: "proj_1",
        threadId: "thr_1",
        title: "Fix login",
      },
      "@",
    );
    expect(thread).toEqual({
      resource: THREAD,
      serializedText: "@thread:thr_1",
      displayText: "@Fix login",
    });
    const plugin = mentionInsertionFromSuggestion(
      {
        kind: "plugin",
        pluginId: "tasks",
        providerId: "tasks",
        itemId: "tasks:ABC-1",
        providerLabel: "Tasks",
        title: "ABC-1 Ship it",
        subtitle: null,
        icon: null,
        replacement: "ABC-1 Ship it",
      },
      "#",
    );
    expect(plugin.serializedText).toBe("#ABC-1 Ship it");
    expect(plugin.displayText).toBe("#ABC-1 Ship it");
  });

  it("builds a command pill identical to the web's resource", () => {
    expect(
      commandInsertionFromSuggestion(
        {
          kind: "command",
          name: "review",
          source: "command",
          origin: "user",
          description: null,
          argumentHint: null,
        },
        "/",
      ),
    ).toEqual({
      resource: REVIEW,
      serializedText: "/review",
      displayText: "/review",
    });
  });

  it("a pill inserted from the typeahead serializes to the web's text", () => {
    const value = createComposerValue("ask @Fix now");
    const insertion = mentionInsertionFromSuggestion(
      {
        kind: "thread",
        path: "thread:thr_1",
        replacement: "thread:thr_1",
        projectId: "proj_1",
        threadId: "thr_1",
        title: "Fix login",
      },
      "@",
    );
    const result = insertMention(value, {
      from: 4,
      to: 8,
      ...insertion,
      trailingText: "",
    });
    expect(result.value.text).toBe("ask @Fix login now");
    expect(composerValueToPromptEditorValue(result.value)).toEqual({
      text: "ask @thread:thr_1 now",
      mentions: [{ start: 4, end: 17, resource: THREAD }],
    });
  });

  it("falls back to the serialized text when a label is empty", () => {
    expect(
      mentionDisplayText({ ...THREAD, label: "  " }, "@thread:thr_1"),
    ).toBe("@thread:thr_1");
  });
});

describe("appendQuoteToComposerValue", () => {
  it("appends a blockquote and keeps pill offsets", () => {
    const value = createComposerValue("@Fix login", [
      { start: 0, end: 10, resource: THREAD, serializedText: "@thread:thr_1" },
    ]);
    const next = appendQuoteToComposerValue(value, "line one\n\nline two");
    expect(next.text).toBe("@Fix login\n> line one\n>\n> line two\n");
    expect(next.mentions).toBe(value.mentions);
    expect(appendQuoteToComposerValue(value, "   ")).toBe(value);
  });
});
