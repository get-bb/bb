// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { PromptMentionExtension } from "./prompt-mention-extension";
import {
  promptEditorContentFromValue,
  promptEditorValueFromDoc,
  type PromptEditorValue,
} from "./prompt-editor-serialization";

const testEditorExtensions = [
  StarterKit.configure({
    blockquote: false,
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
];

function createTestEditorFromContent(content: JSONContent): Editor {
  return new Editor({
    extensions: testEditorExtensions,
    content,
  });
}

function createTestEditor(value: PromptEditorValue): Editor {
  return createTestEditorFromContent(promptEditorContentFromValue(value));
}

describe("prompt editor serialization", () => {
  it("round-trips mention pills as agent-facing text with ranges", () => {
    const initialValue: PromptEditorValue = {
      text: "Ask @thread:thr_prompt to inspect @apps/app/src/App.tsx",
      mentions: [
        {
          start: 4,
          end: 22,
          resource: {
            kind: "thread",
            threadId: "thr_prompt",
            label: "Prompt thread",
          },
        },
        {
          start: 34,
          end: 55,
          resource: {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "apps/app/src/App.tsx",
            label: "App.tsx",
          },
        },
      ],
    };
    const editor = createTestEditor(initialValue);

    try {
      expect(promptEditorValueFromDoc(editor.state.doc)).toEqual(initialValue);
    } finally {
      editor.destroy();
    }
  });

  it("serializes mention clipboard metadata into editor HTML", () => {
    const editor = createTestEditor({
      text: "Ask @thread:thr_prompt",
      mentions: [
        {
          start: "Ask ".length,
          end: "Ask @thread:thr_prompt".length,
          resource: {
            kind: "thread",
            threadId: "thr_prompt",
            label: "Prompt manager",
          },
        },
      ],
    });

    try {
      const html = editor.getHTML();

      expect(html).toContain('data-prompt-mention="true"');
      expect(html).toContain(
        'data-prompt-mention-serialized-text="@thread:thr_prompt"',
      );
      expect(html).toContain("data-prompt-mention-resource=");
    } finally {
      editor.destroy();
    }
  });

  it("serializes paragraph boundaries as newlines and keeps mention offsets", () => {
    const resource = {
      kind: "thread",
      threadId: "thr_second",
      projectId: "proj_second",
      label: "Second thread",
    };
    const editor = createTestEditorFromContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Line one" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ask " },
            {
              type: "mention",
              attrs: {
                resource,
                serializedText: "@thread:thr_second",
              },
            },
            { type: "text", text: " next" },
          ],
        },
      ],
    });

    try {
      expect(promptEditorValueFromDoc(editor.state.doc)).toEqual({
        text: "Line one\nAsk @thread:thr_second next",
        mentions: [
          {
            start: "Line one\nAsk ".length,
            end: "Line one\nAsk @thread:thr_second".length,
            resource,
          },
        ],
      });
    } finally {
      editor.destroy();
    }
  });

  it("drops invalid or overlapping ranges when building editor content", () => {
    const initialValue: PromptEditorValue = {
      text: "Use @thread:thr_one and @thread:thr_two",
      mentions: [
        {
          start: 4,
          end: 19,
          resource: {
            kind: "thread",
            threadId: "thr_one",
            label: "First thread",
          },
        },
        {
          start: 8,
          end: 19,
          resource: {
            kind: "thread",
            threadId: "thr_overlap",
            label: "Overlapping thread",
          },
        },
        {
          start: 24,
          end: 39,
          resource: {
            kind: "thread",
            threadId: "thr_two",
            label: "Second thread",
          },
        },
        {
          start: 100,
          end: 120,
          resource: {
            kind: "thread",
            threadId: "thr_out_of_bounds",
            label: "Out of bounds",
          },
        },
      ],
    };
    const editor = createTestEditor(initialValue);

    try {
      expect(promptEditorValueFromDoc(editor.state.doc)).toEqual({
        text: initialValue.text,
        mentions: [initialValue.mentions[0], initialValue.mentions[2]],
      });
    } finally {
      editor.destroy();
    }
  });
});
