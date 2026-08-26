// Shared by rename-machine-prompt.ts (Android / default) and its .ios sibling; a
// separate module because "./rename-machine-prompt" resolves to the .ios file on iOS.

export interface RenameMachinePromptOptions {
  currentName: string;
  /** Receives the trimmed, non-empty, changed name. */
  onSubmit: (name: string) => void;
}
