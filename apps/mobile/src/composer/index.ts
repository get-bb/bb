// The shared native composer (root compose + follow-up). Pure model under
// ./model (vitest); RN pieces here. Data hooks live in @/data/composer.
export { Composer, type ComposerHandle, type ComposerProps } from "./Composer";
export {
  type ComposerInputHandle,
  type ComposerInputProps,
} from "./ComposerInput";
export { type ExecutionControlsProps } from "./ExecutionControls";
export { type AttachmentChipsProps } from "./AttachmentChips";
export { type TypeaheadMenuProps } from "./TypeaheadMenu";
export {
  type ComposerScope,
  type TypeaheadMenuModel,
  type UseComposerTypeaheadArgs,
  type UseComposerTypeaheadResult,
} from "./useComposerTypeahead";
export {
  type ComposerAttachmentsController,
  type PendingAttachment,
  type UseComposerAttachmentsArgs,
} from "./useComposerAttachments";
export {
  type ComposerVoiceController,
  type UseComposerVoiceArgs,
} from "./useComposerVoice";
export { VoiceBar, type VoiceBarController } from "./VoiceBar";
export { type VoiceWaveformProps } from "./VoiceWaveform";
export * from "./model";
