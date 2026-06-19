import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "./browser-storage";

export const RICH_TEXT_EDITING_STORAGE_KEY = "bb.promptbox.rich-text-editing";

/**
 * Default OFF: the prompt box behaves as a plain-text editor. When ON, typing
 * Markdown (`# `, `- `, `1. `, `**`, `_`, `` ` ``) live-formats into headings,
 * lists, bold, italic, and inline code in the composer (see
 * {@link promptEditorExtensions}). The submitted prompt is plain Markdown text
 * either way — this only controls the live editing experience. Blockquotes
 * (`> `, used by the quote-into-prompt feature) are unaffected by this setting.
 */
export const RICH_TEXT_EDITING_DEFAULT = false;

const richTextEditingStorage = createJsonLocalStorage<boolean>();

export const richTextEditingPreferenceAtom = atomWithStorage<boolean>(
  RICH_TEXT_EDITING_STORAGE_KEY,
  RICH_TEXT_EDITING_DEFAULT,
  richTextEditingStorage,
  { getOnInit: true },
);

export function useRichTextEditingPreference() {
  return useAtom(richTextEditingPreferenceAtom);
}
