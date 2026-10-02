import type { PromptEditorEngine } from "./prompt-editor-engine";

let enginePromise: Promise<PromptEditorEngine> | null = null;
let loadedEngine: PromptEditorEngine | null = null;

export function loadPromptEditorEngine(): Promise<PromptEditorEngine> {
  enginePromise ??= import("./prompt-editor-engine").then((engine) => {
    loadedEngine = engine;
    return engine;
  });
  return enginePromise;
}

export function peekPromptEditorEngine(): PromptEditorEngine | null {
  return loadedEngine;
}
