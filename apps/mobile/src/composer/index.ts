// The shared native composer (root compose + follow-up). Pure model under
// ./model (vitest); RN pieces here. Data hooks live in @/data/composer.
export { Composer, type ComposerHandle } from "./Composer";
export { type ExecutionControlsProps } from "./ExecutionControls";
export { VoiceBar, type VoiceBarController } from "./VoiceBar";
export * from "./model";
