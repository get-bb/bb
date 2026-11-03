import { mergeAttributes } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PromptMentionPillNodeView } from "./PromptMentionPillNodeView";
import { parsePromptEditorMentionAttrs } from "./prompt-editor-serialization";
import {
  experimental_describePromptMention as describePromptMention,
  experimental_promptMentionClipboardAttributes as promptMentionClipboardAttributes,
} from "@get-bb/plugin-sdk/app";

interface MentionRenderArgs {
  node: Pick<ProseMirrorNode, "attrs">;
}

function renderMentionText({ node }: MentionRenderArgs): string {
  const attrs = parsePromptEditorMentionAttrs(node.attrs);
  return attrs?.serializedText ?? "";
}

export const PromptMentionExtension = Mention.extend({
  addAttributes() {
    const parentAttributes = this.parent?.() ?? {};
    return {
      ...parentAttributes,
      mention: {
        default: null,
      },
      serializedText: {
        default: null,
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(PromptMentionPillNodeView);
  },
  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() ?? [];
    const mentionName = this.name;
    return [
      ...parentPlugins,
      new Plugin({
        props: {
          decorations(state) {
            const { selection } = state;
            const decorations: Decoration[] = [];
            if (!selection.empty) {
              state.doc.nodesBetween(
                selection.from,
                selection.to,
                (node, pos) => {
                  if (
                    node.type.name === mentionName &&
                    pos >= selection.from &&
                    pos + node.nodeSize <= selection.to
                  ) {
                    decorations.push(
                      Decoration.node(
                        pos,
                        pos + node.nodeSize,
                        {},
                        { mentionSelected: true },
                      ),
                    );
                  }
                },
              );
            }

            return decorations.length > 0
              ? DecorationSet.create(state.doc, decorations)
              : null;
          },
        },
      }),
    ];
  },
}).configure({
  deleteTriggerWithBackspace: true,
  renderText: renderMentionText,
  renderHTML({ node, options }) {
    const attrs = parsePromptEditorMentionAttrs(node.attrs);
    if (!attrs) {
      return [
        "span",
        mergeAttributes(options.HTMLAttributes, {
          "data-prompt-mention": "true",
          title: "@mention",
        }),
        "@mention",
      ];
    }
    const presentation = describePromptMention(attrs.mention);
    return [
      "span",
      mergeAttributes(options.HTMLAttributes, {
        class: presentation.className,
        ...promptMentionClipboardAttributes(
          attrs.mention,
          attrs.serializedText,
        ),
        title: presentation.title,
      }),
      presentation.text,
    ];
  },
  suggestion: {
    char: "@",
    items: () => [],
    render: () => ({
      onStart: () => undefined,
      onUpdate: () => undefined,
      onExit: () => undefined,
    }),
  },
});
