export const TOOL_DESCRIPTION = `Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.

Usage notes:
- This call returns as soon as the question is on screen. The answer is NOT the result of the call: it arrives later as a separate user message. After calling this tool, end your turn with one short line saying what you are waiting for, and continue when the answer arrives.
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Reserve this for decisions where the user's answer changes what you do next — not for choices with a conventional default or facts you can verify in the codebase yourself. In those cases pick the obvious option, mention it in your response, and proceed.

Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. The preview is revealed beneath an option once it is selected. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
`;

export const TOO_FEW_OPTIONS_MESSAGE =
  "This call included a question with fewer than 2 options, so it was rejected and the person never saw it. A question with a single option has no decision in it. Do not retry this call and do not invent a filler second option. Instead, state the one path you were going to offer as the approach you are taking, then continue with the task. If this call also contained questions with 2 to 4 options (each with distinct labels), you may re-ask those questions alone in a new call. Ask a question only when the person has at least two genuinely distinct choices.";

export const NOT_UNIQUE_MESSAGE =
  "Question texts must be unique, option labels must be unique within each question";

export const QUESTION_POSTED_MESSAGE =
  "The question is now in front of the user. Their answer is not the result of this call: it arrives as a separate user message, either during this turn or as the next one. Do not ask it again, do not guess it, and do not start work that depends on it. End your turn now with one short line saying what you are waiting for.";

export const DISMISSED_MESSAGE =
  "The user dismissed the question without answering. Proceed with your best judgement, or ask again in your reply.";

export const UNREADABLE_ANSWER_MESSAGE =
  "The user's answer could not be read. Ask the question again in your reply instead.";

export const NO_ANSWERS_MESSAGE =
  "The user submitted no answers. Proceed with your best judgement, or ask again in your reply.";

export function buildUnavailableMessage(detail: string): string {
  return `The question could not be shown (${detail}). Only one prompt can await the user at a time — put all of your questions in a single AskUserQuestion call, or continue with your best judgement.`;
}

export function buildTimeoutMessage(elapsedMs: number): string {
  return `No response after ${Math.round(elapsedMs / 1000)}s — the user may be away from keyboard. Proceed using your best judgment based on the context so far; you can re-ask this question later if it's still relevant.`;
}
