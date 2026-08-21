import {
  PROMPT_HISTORY_ENTRY_LIMIT,
  takeVisiblePromptHistoryEntries,
  type PromptHistoryEntry,
} from "@bb/domain";
import {
  arePromptDraftStatesEqual,
  isPromptDraftEmpty,
  promptInputToDraft,
  type PromptDraftState,
} from "@bb/client-core";

export function promptHistoryEntriesToDrafts(
  entries: readonly PromptHistoryEntry[],
): PromptDraftState[] {
  const drafts: PromptDraftState[] = [];

  for (const entry of entries) {
    const draft = promptInputToDraft(entry.input);
    if (isPromptDraftEmpty(draft)) {
      continue;
    }

    const previousDraft = drafts[drafts.length - 1];
    if (previousDraft && arePromptDraftStatesEqual(previousDraft, draft)) {
      continue;
    }

    drafts.push(draft);
  }

  return drafts;
}

export function prependPromptHistoryEntry(
  entries: readonly PromptHistoryEntry[] | undefined,
  entry: PromptHistoryEntry,
): PromptHistoryEntry[] {
  return takeVisiblePromptHistoryEntries({
    entries: [entry, ...(entries ?? [])],
    limit: PROMPT_HISTORY_ENTRY_LIMIT,
  });
}
