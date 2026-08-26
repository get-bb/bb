import type { RenameMachinePromptOptions } from "./rename-machine-prompt-types";

/**
 * Opens the system rename prompt when the platform has one. Android /
 * default: none (returns `false`; the caller presents `MachineRenameSheet`).
 * `rename-machine-prompt.ios.ts` shows `Alert.prompt`.
 */
export function promptRenameMachine(
  _options: RenameMachinePromptOptions,
): boolean {
  return false;
}

export type { RenameMachinePromptOptions } from "./rename-machine-prompt-types";
