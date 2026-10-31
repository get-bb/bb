import type { PromptInput } from "@bb/domain";

const CONTINUE_TURN_TEXT = "Please continue.";

export function continueTurnInput(): PromptInput[] {
  return [
    {
      type: "text",
      text: CONTINUE_TURN_TEXT,
      mentions: [],
      visibility: "agent-only",
    },
  ];
}
