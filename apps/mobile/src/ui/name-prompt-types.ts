// Shared by name-prompt.ts (Android / default) and name-prompt.ios.ts; a separate
// module because "./name-prompt" resolves to the .ios sibling on iOS.

export interface NamePromptOptions {
  title: string;
  message?: string;
  initialValue: string;
  /** The confirming button ("Rename", "Create"). */
  submitLabel: string;
  /** Receives the trimmed, non-empty name. */
  onSubmit: (name: string) => void;
  /** Runs when the prompt is cancelled or submitted empty. */
  onCancel?: () => void;
}
