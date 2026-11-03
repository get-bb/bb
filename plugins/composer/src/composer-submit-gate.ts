export interface ComposerSubmitGateInput {
  canSubmit: boolean;
  hasSubmittableInput: boolean;
  isAttaching: boolean;
  isSubmitting: boolean;
  voiceActive: boolean;
  submitDisabledReason: string | undefined;
}

export function composerSubmittingBlockedReason({
  canSubmit,
  hasSubmittableInput,
  isAttaching,
  isSubmitting,
  voiceActive,
  submitDisabledReason,
}: ComposerSubmitGateInput): string | null {
  if (canSubmit) return null;
  if (isAttaching) return "Uploading attachments...";
  if (submitDisabledReason !== undefined) return submitDisabledReason;
  if (voiceActive) return "Finish voice input first.";
  if (isSubmitting) return "Submitting...";
  return hasSubmittableInput
    ? "This composer can't submit right now."
    : "Type a message first.";
}

export function hasSubmittableComposerInput(draft: {
  text: string;
  attachments: readonly unknown[];
}): boolean {
  return draft.text.trim().length > 0 || draft.attachments.length > 0;
}
