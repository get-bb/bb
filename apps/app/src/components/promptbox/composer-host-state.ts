import type {
  ExperimentalComposerAttachments,
  ExperimentalComposerSubmission,
  ExperimentalComposerVoice,
} from "@get-bb/plugin-sdk";
import type { ComposerEditorState } from "@get-bb/plugin-sdk/internal/composer-handle";

export type ComposerHostState = Omit<ComposerEditorState, "layout">;

export interface ComposerHostStateInput {
  submission: Pick<
    ExperimentalComposerSubmission,
    "isRunning" | "isSubmitting" | "disabled" | "disabledReason" | "enter"
  >;
  attachments: Pick<ExperimentalComposerAttachments, "isAttaching" | "error">;
  voiceState: ExperimentalComposerVoice["state"] | null;
  hasInput: boolean;
}

function blockedReason({
  submission,
  attachments,
  voiceState,
  hasInput,
}: ComposerHostStateInput): string | null {
  const isAttaching = attachments.isAttaching === true;
  const isSubmitting = submission.isSubmitting === true;
  const voiceActive =
    voiceState === "recording" || voiceState === "transcribing";
  const blocked =
    isAttaching ||
    isSubmitting ||
    voiceActive ||
    submission.disabled === true ||
    (submission.enter.requiresInput && !hasInput);
  if (!blocked) return null;
  if (isAttaching) return "Uploading attachments...";
  if (submission.disabledReason !== undefined) return submission.disabledReason;
  if (voiceActive) return "Finish voice input first.";
  if (isSubmitting) return "Submitting...";
  return hasInput
    ? "This composer can't submit right now."
    : "Type a message first.";
}

export function composerHostState(
  input: ComposerHostStateInput,
): ComposerHostState {
  const reason = blockedReason(input);
  return {
    isRunning: input.submission.isRunning ?? false,
    isSubmitting: input.submission.isSubmitting ?? false,
    isSubmittingBlocked: reason !== null,
    submittingBlockedReason: reason,
    isAttaching: input.attachments.isAttaching ?? false,
    attachmentError: input.attachments.error ?? null,
  };
}
