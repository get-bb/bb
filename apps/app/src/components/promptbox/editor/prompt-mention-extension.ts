import { mergeAttributes } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PromptMentionPillNodeView } from "./PromptMentionPillNodeView";
import { parsePromptEditorMentionAttrs } from "./prompt-editor-serialization";
import {
  PROMPT_MENTION_PILL_CLASS,
  promptMentionIconLabel,
  promptMentionTooltipLabel,
} from "@/components/promptbox/mentions/prompt-mention-display";
import { promptMentionClipboardDataAttributes } from "@/components/promptbox/mentions/prompt-mention-clipboard";
import { cn } from "@/lib/utils";

interface MentionRenderArgs {
  node: Pick<ProseMirrorNode, "attrs">;
}

type ParsedMentionAttrs = ReturnType<typeof parsePromptEditorMentionAttrs>;

function renderMentionText({ node }: MentionRenderArgs): string {
  const attrs = parsePromptEditorMentionAttrs(node.attrs);
  return attrs?.serializedText ?? "";
}

function renderMentionLabel(attrs: ParsedMentionAttrs): string {
  if (!attrs) return "@mention";
  return `${promptMentionIconLabel(attrs.resource)}: ${attrs.resource.label}`;
}

function renderMentionTitle(attrs: ParsedMentionAttrs): string {
  return attrs ? promptMentionTooltipLabel(attrs.resource) : "@mention";
}

function commandArgumentHint(attrs: ParsedMentionAttrs): string | null {
  if (attrs?.resource.kind !== "command") return null;
  const argumentHint = attrs.resource.argumentHint?.trim();
  return argumentHint ? argumentHint : null;
}

function commandArgumentHintWidgetPosition({
  doc,
  position,
  mentionName,
}: {
  doc: ProseMirrorNode;
  position: number;
  mentionName: string;
}): number | null {
  let widgetPosition = position;
  let hasContent = false;
  doc.nodesBetween(position, doc.content.size, (node, pos) => {
    if (hasContent) return false;
    if (node.isText) {
      const text = node.text ?? "";
      const startOffset = Math.max(position - pos, 0);
      const textAfterPosition = text.slice(startOffset);
      hasContent = /\S/u.test(textAfterPosition);
      widgetPosition = pos + startOffset + textAfterPosition.length;
      return !hasContent;
    }
    if (node.type.name === mentionName) {
      hasContent = true;
      return false;
    }
    if (node.isLeaf) {
      hasContent = true;
      return false;
    }
    return true;
  });
  return hasContent ? null : widgetPosition;
}

function createCommandArgumentHintWidget(argumentHint: string): HTMLElement {
  const element = document.createElement("span");
  element.className = cn(
    "select-none text-subtle-foreground/75",
    "pointer-events-none",
  );
  element.dataset.promptCommandArgumentPlaceholder = "true";
  element.setAttribute("aria-hidden", "true");
  element.textContent = argumentHint;
  return element;
}

export const PromptMentionExtension = Mention.extend({
  addAttributes() {
    const parentAttributes = this.parent?.() ?? {};
    return {
      ...parentAttributes,
      resource: {
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
  // Mention SVG icons never receive the browser's native `::selection` paint,
  // so a text selection that spans a pill highlights its label but not its
  // icon. Mark every mention node fully inside the selection so the node view
  // can paint the whole pill as one selected unit.
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

            state.doc.descendants((node, pos) => {
              if (node.type.name !== mentionName) return true;

              const attrs = parsePromptEditorMentionAttrs(node.attrs);
              const argumentHint = commandArgumentHint(attrs);
              if (!argumentHint) return false;

              const afterMentionPos = pos + node.nodeSize;
              const widgetPosition = commandArgumentHintWidgetPosition({
                doc: state.doc,
                position: afterMentionPos,
                mentionName,
              });
              if (widgetPosition === null) return false;

              decorations.push(
                // Render after leading whitespace so the caret stays to the
                // left of the hint when selection sits at the same position.
                Decoration.widget(
                  widgetPosition,
                  () => createCommandArgumentHintWidget(argumentHint),
                  {
                    key: `command-argument-placeholder-${pos}-${argumentHint}`,
                    side: 1,
                  },
                ),
              );
              return false;
            });

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
    const clipboardAttributes = attrs
      ? promptMentionClipboardDataAttributes(attrs)
      : { "data-prompt-mention": "true" };
    return [
      "span",
      mergeAttributes(options.HTMLAttributes, {
        class: cn(PROMPT_MENTION_PILL_CLASS, "bg-surface-raised"),
        ...clipboardAttributes,
        title: renderMentionTitle(attrs),
      }),
      renderMentionLabel(attrs),
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
