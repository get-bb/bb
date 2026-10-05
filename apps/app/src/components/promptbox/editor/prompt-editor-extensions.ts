import { Placeholder } from "@tiptap/extensions/placeholder";
import Blockquote from "@tiptap/extension-blockquote";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions/undo-redo";
import { TrailingNode } from "@tiptap/extensions/trailing-node";
import type { AnyExtension } from "@tiptap/react";
import {
  PromptDecorationExtension,
  type PromptDecorationExtensionOptions,
} from "./prompt-decoration-extension";
import { PromptMentionExtension } from "./prompt-mention-extension";

interface PromptEditorExtensionsOptions extends PromptDecorationExtensionOptions {
  getPlaceholder: () => string;
}

export function promptEditorExtensions({
  getPlaceholder,
  getDecorationSources,
  getDraftObservers,
  draftObserverDebounceMs,
  onRuleError,
}: PromptEditorExtensionsOptions): AnyExtension[] {
  return [
    Blockquote,
    Document,
    HardBreak,
    UndoRedo,
    Paragraph,
    Text,
    TrailingNode,
    Placeholder.configure({
      placeholder: () => getPlaceholder(),
    }),
    PromptMentionExtension,
    PromptDecorationExtension.configure({
      ...(getDecorationSources !== undefined ? { getDecorationSources } : {}),
      ...(getDraftObservers !== undefined ? { getDraftObservers } : {}),
      ...(draftObserverDebounceMs !== undefined
        ? { draftObserverDebounceMs }
        : {}),
      ...(onRuleError !== undefined ? { onRuleError } : {}),
    }),
  ];
}
