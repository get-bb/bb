import type { PromptInput } from "@bb/domain";

export function textPrompt(text: string): PromptInput {
  return { type: "text", text, mentions: [] };
}

export function textInput(text: string): PromptInput[] {
  return [textPrompt(text)];
}
