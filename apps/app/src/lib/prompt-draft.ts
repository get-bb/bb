// Moved to @bb/client-core (shared with the native app); re-exported here so web imports keep resolving.
export {
  emptyPromptDraftState,
  appendQuoteToDraftText,
  appendQuoteAndAttachmentsToDraft,
  isPromptDraftEmpty,
  parsePromptDraftStorage,
  serializePromptDraftStorage,
  arePromptDraftStatesEqual,
  promptDraftToInput,
  promptInputToDraft,
  getProjectStoredPromptAttachmentPaths,
} from "@bb/client-core";
export type { PromptDraftAttachment, PromptDraftState } from "@bb/client-core";
