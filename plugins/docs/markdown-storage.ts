import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownStorage } from "tiptap-markdown";

export interface MarkdownToken {
  level: number;
  nesting: number;
  map: [number, number] | null;
}

export interface MarkdownEditorStorage extends MarkdownStorage {
  parser: {
    md: {
      parse(source: string, env: Record<string, unknown>): MarkdownToken[];
    };
    parse(source: string): string;
  };
  serializer: {
    serialize(node: ProseMirrorNode): string;
  };
}

export function markdownStorage(editor: Editor): MarkdownEditorStorage {
  return (editor.storage as unknown as { markdown: MarkdownEditorStorage })
    .markdown;
}
