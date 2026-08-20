// Moved to @bb/client-core (shared with the native app); re-exported here so web imports keep resolving.
export {
  toProviderCommandSuggestion,
  compareCommandSuggestions,
  orderCommandSuggestions,
} from "@bb/client-core";
export type {
  PromptPathMentionSource,
  PromptPathMentionEntryKind,
  PromptMentionSuggestion,
  ProviderCommandSuggestion,
  ComposerCommandSuggestion,
  TypeaheadTrigger,
  ActiveTrigger,
  MentionMenuState,
  CommandMenuState,
  TypeaheadMenuState,
} from "@bb/client-core";
