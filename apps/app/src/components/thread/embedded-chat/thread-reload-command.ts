import type { PromptDraftState } from "@bb/client-core";

export function isExactThreadReloadCommand(draft: PromptDraftState): boolean {
  return (
    draft.text === "/reload" &&
    draft.mentions.length === 0 &&
    draft.attachments.length === 0
  );
}
