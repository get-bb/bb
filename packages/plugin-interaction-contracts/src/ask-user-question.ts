import { z } from "zod";

/**
 * Pending-interaction contract of the bundled `ask-user-question` plugin
 * (`plugins/ask-user-question`): the payload the plugin's server puts on
 * `bb.ui.requestInput({ rendererId: "ask-user-question", payload })` and the
 * response value its form submits back. Shared between the plugin and the
 * native app (which renders the form without the plugin's React DOM bundle).
 *
 * Limits mirror Claude Code's own `AskUserQuestion` tool so a model that has
 * learned the native tool hits the same walls here. `header` has no hard cap
 * on either side — Claude's schema documents "max 12 chars" in prose without
 * enforcing it, and rejecting a 13-character chip label would be a worse
 * failure than rendering it.
 */
export const ASK_USER_QUESTION_RENDERER_ID = "ask-user-question";

export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 4;
const MAX_SELECTED = MAX_OPTIONS;
const MAX_FREE_TEXT_LENGTH = 4096;
/**
 * Per-option preview cap. Previews are freeform (mockups, diffs, snippets) and
 * every one of them rides the 64 KiB `bb.ui.requestInput` payload, so the cap
 * keeps a single question from exhausting that budget on its own.
 */
export const MAX_OPTION_PREVIEW_LENGTH = 4096;

const nonBlank = (value: string) => value.trim().length > 0;

// ---------------------------------------------------------------------------
// Interaction payload — server → the form.
// ---------------------------------------------------------------------------

const interactionOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  preview: z.string().min(1).optional(),
});
export type InteractionOption = z.infer<typeof interactionOptionSchema>;

const interactionQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  shortLabel: z.string().min(1),
  multiSelect: z.boolean(),
  options: z.array(interactionOptionSchema).max(MAX_OPTIONS),
  allowFreeText: z.boolean(),
});
export type InteractionQuestion = z.infer<typeof interactionQuestionSchema>;

export const interactionPayloadSchema = z.object({
  questions: z.array(interactionQuestionSchema).min(1).max(MAX_QUESTIONS),
});
export type InteractionPayload = z.infer<typeof interactionPayloadSchema>;

// ---------------------------------------------------------------------------
// Interaction response — the form → server.
// ---------------------------------------------------------------------------

const interactionAnswerSchema = z.object({
  selected: z.array(z.string().min(1)).max(MAX_SELECTED),
  freeText: z
    .string()
    .min(1)
    .max(MAX_FREE_TEXT_LENGTH)
    .refine(nonBlank, "Free text cannot be blank")
    .optional(),
});
export type InteractionAnswer = z.infer<typeof interactionAnswerSchema>;

export const interactionResponseSchema = z.object({
  answers: z.record(z.string().min(1), interactionAnswerSchema),
});
export type InteractionResponse = z.infer<typeof interactionResponseSchema>;
