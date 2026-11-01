import type { Editor } from "@tiptap/core";
import type { MarkdownStorage } from "tiptap-markdown";

export function markdownStorage(editor: Editor): MarkdownStorage {
  return (editor.storage as unknown as { markdown: MarkdownStorage }).markdown;
}
