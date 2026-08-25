import type { NamePromptOptions } from "./name-prompt-types";

/**
 * Single-field name prompt (rename a thread, new section). iOS shows the
 * system alert with a text field (`name-prompt.ios.ts`); other platforms
 * have no native equivalent, so this returns `false` and the caller
 * presents its sheet form instead.
 */
export function promptName(_options: NamePromptOptions): boolean {
  return false;
}

export type { NamePromptOptions } from "./name-prompt-types";
