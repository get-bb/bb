import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import type { AnyExtension } from "@tiptap/react";
import { PromptMentionExtension } from "./prompt-mention-extension";

export interface PromptEditorExtensionsOptions {
  /**
   * When true, the composer enables Markdown rich-text formatting (headings,
   * lists, bold/italic/inline code) with StarterKit's live input rules. When
   * false (the default user preference), those nodes/marks — and their input
   * rules — are disabled, so the prompt box stays plain text.
   */
  richTextEditing: boolean;
  /** Resolves the current placeholder text at render time. */
  getPlaceholder: () => string;
}

/**
 * Build the TipTap extension set for the prompt box.
 *
 * Markdown formatting is gated behind `richTextEditing`. Each gated node/mark
 * has a Markdown text representation in prompt-editor-serialization.ts so the
 * submitted prompt is plain Markdown regardless of the toggle. StarterKit ships
 * input rules for these (`# `, `- `, `1. `, `**`, `_`, `` ` ``), so when
 * enabled, typing applies formatting live; when disabled, the node/mark and its
 * input rule are removed and the same characters stay literal.
 *
 * `blockquote` is intentionally NOT gated: it predates the Markdown feature and
 * backs the quote-into-prompt flow (appendQuoteToDraftText writes `> ` lines
 * that the serializer parses back into blockquote nodes). It must stay in the
 * schema in both modes, or re-parsing a quoted draft would hit an unknown node
 * type. Code blocks/link/underline stay disabled: code blocks make multiline
 * prompt editing too sticky; underline isn't Markdown; links need authoring UI
 * we don't provide.
 */
export function promptEditorExtensions({
  richTextEditing,
  getPlaceholder,
}: PromptEditorExtensionsOptions): AnyExtension[] {
  return [
    StarterKit.configure({
      blockquote: {},
      bold: richTextEditing ? {} : false,
      bulletList: richTextEditing ? {} : false,
      code: richTextEditing ? {} : false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      heading: richTextEditing ? {} : false,
      horizontalRule: false,
      italic: richTextEditing ? {} : false,
      link: false,
      listItem: richTextEditing ? {} : false,
      orderedList: richTextEditing ? {} : false,
      strike: false,
      underline: false,
    }),
    Placeholder.configure({
      placeholder: () => getPlaceholder(),
    }),
    PromptMentionExtension,
  ];
}
