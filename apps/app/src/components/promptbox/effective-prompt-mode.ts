// Moved to @bb/client-core (shared with the native app); re-exported here so web imports keep resolving.
export {
  isClaudePlanModePrompt,
  permissionDisplayForPromptMode,
  permissionDisplayForActivePromptMode,
  shouldDisablePermissionPickerForPromptMode,
  shouldDisablePermissionPickerForActivePromptMode,
} from "@bb/client-core";
export type {
  PromptModeInput,
  PermissionDisplayOverride,
} from "@bb/client-core";
