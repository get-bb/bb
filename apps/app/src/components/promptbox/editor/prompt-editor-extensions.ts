import { Placeholder } from "@tiptap/extensions/placeholder";
import Blockquote from "@tiptap/extension-blockquote";
import Bold from "@tiptap/extension-bold";
import Code from "@tiptap/extension-code";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Heading from "@tiptap/extension-heading";
import Italic from "@tiptap/extension-italic";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { BulletList } from "@tiptap/extension-list/bullet-list";
import { ListItem } from "@tiptap/extension-list/item";
import { ListKeymap } from "@tiptap/extension-list/keymap";
import { OrderedList } from "@tiptap/extension-list/ordered-list";
import { UndoRedo } from "@tiptap/extensions/undo-redo";
import { TrailingNode } from "@tiptap/extensions/trailing-node";
import type { AnyExtension } from "@tiptap/react";
import {
  PromptDecorationExtension,
  type PromptDecorationExtensionOptions,
} from "./prompt-decoration-extension";
import { PromptMentionExtension } from "./prompt-mention-extension";

interface PromptEditorExtensionsOptions extends PromptDecorationExtensionOptions {
  richTextEditing: boolean;
  getPlaceholder: () => string;
}

export function promptEditorExtensions({
  richTextEditing,
  getPlaceholder,
  getDecorationSources,
  getDraftObservers,
  draftObserverDebounceMs,
  onRuleError,
}: PromptEditorExtensionsOptions): AnyExtension[] {
  const extensions: (AnyExtension | false)[] = [
    richTextEditing && Bold,
    Blockquote,
    richTextEditing && BulletList,
    richTextEditing && Code,
    Document,
    HardBreak,
    richTextEditing && Heading,
    UndoRedo,
    richTextEditing && Italic,
    richTextEditing && ListItem,
    ListKeymap,
    richTextEditing && OrderedList,
    Paragraph,
    Text,
    TrailingNode,
  ];
  return [
    ...extensions.filter(
      (extension): extension is AnyExtension => extension !== false,
    ),
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
