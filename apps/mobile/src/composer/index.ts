// The shared native composer (root compose + follow-up). Pure model under
// ./model (vitest); RN pieces here. Data hooks live in @/data/composer.
export { Composer, type ComposerHandle, type ComposerProps } from "./Composer";
export {
  ComposerInput,
  type ComposerInputHandle,
  type ComposerInputProps,
} from "./ComposerInput";
export {
  ExecutionControls,
  type ExecutionControlsProps,
} from "./ExecutionControls";
export { AttachmentChips, type AttachmentChipsProps } from "./AttachmentChips";
export { TypeaheadMenu, type TypeaheadMenuProps } from "./TypeaheadMenu";
export {
  useComposerTypeahead,
  type ComposerScope,
  type TypeaheadMenuModel,
  type UseComposerTypeaheadArgs,
  type UseComposerTypeaheadResult,
} from "./useComposerTypeahead";
export {
  useComposerAttachments,
  type ComposerAttachmentsController,
  type PendingAttachment,
  type UseComposerAttachmentsArgs,
} from "./useComposerAttachments";
export {
  useComposerVoice,
  type ComposerVoiceController,
  type UseComposerVoiceArgs,
} from "./useComposerVoice";
export { VoiceBar, type VoiceBarController } from "./VoiceBar";
export { VoiceWaveform, type VoiceWaveformProps } from "./VoiceWaveform";
export { meteringToAmplitude } from "./voice-waveform-model";
export { useComposerDraft, type ComposerDraft } from "@/data/composer";
export * from "./model";
