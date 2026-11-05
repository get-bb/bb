import type { PromptInput } from "@bb/domain";

export const CONTINUE_TURN_TEXT = "Please continue.";

export function continueTurnInput(text: string): PromptInput[] {
  return [
    {
      type: "text",
      text,
      mentions: [],
      visibility: "agent-only",
    },
  ];
}
