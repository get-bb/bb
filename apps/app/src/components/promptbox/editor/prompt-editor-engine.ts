export {
  EditorContent,
  useEditor,
  type Editor,
  type JSONContent,
  type UseEditorOptions,
} from "@tiptap/react";
export { TextSelection } from "@tiptap/pm/state";
export type { Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";

export { promptEditorExtensions } from "./prompt-editor-extensions";
export * from "./prompt-editor-serialization";
export * from "./prompt-editor-blockquote";
export * from "./prompt-editor-heading";
export * from "./prompt-editor-list";
export * from "./prompt-editor-paragraph";
export * from "./prompt-editor-transaction";
export * from "./prompt-decoration-extension";
export * from "./prompt-mention-extension";
export * from "./prompt-mention-link";
export * from "@/components/promptbox/mentions/prompt-mention-clipboard";

export type PromptEditorEngine = typeof import("./prompt-editor-engine");
