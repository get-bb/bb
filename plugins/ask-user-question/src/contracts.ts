import { z } from "zod";

/**
 * Limits mirrored from Claude Code's own `AskUserQuestion` tool so a model
 * that has learned the native tool hits the same walls here. `header` has no
 * hard cap on either side — Claude's schema documents "max 12 chars" in prose
 * without enforcing it, and rejecting a 13-character chip label would be a
 * worse failure than rendering it.
 */
export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 4;
export const MAX_SELECTED = MAX_OPTIONS;
export const MAX_FREE_TEXT_LENGTH = 4096;
/**
 * Per-option preview cap. Previews are freeform (mockups, diffs, snippets) and
 * every one of them rides the 64 KiB `bb.ui.requestInput` payload, so the cap
 * keeps a single question from exhausting that budget on its own.
 */
export const MAX_OPTION_PREVIEW_LENGTH = 4096;

const nonBlank = (value: string) => value.trim().length > 0;

// ---------------------------------------------------------------------------
// Tool input — the shape the model sends.
// ---------------------------------------------------------------------------

export const toolOptionSchema = z.object({
  label: z.string().min(1).refine(nonBlank, "Option labels cannot be blank"),
  description: z
    .string()
    .min(1)
    .refine(nonBlank, "Option descriptions cannot be blank"),
  preview: z.string().max(MAX_OPTION_PREVIEW_LENGTH).optional(),
});

export const toolQuestionSchema = z.object({
  question: z.string().min(1).refine(nonBlank, "Questions cannot be blank"),
  header: z.string().min(1).refine(nonBlank, "Headers cannot be blank"),
  // Deliberately looser than the advertised `minItems: 2`. Claude rejects a
  // one-option question with a specific steering message (see
  // TOO_FEW_OPTIONS_MESSAGE) that is far more useful than a schema error, so
  // the arity is enforced in `validateToolInput` where that text can be
  // returned. The advertised schema still says 2-4.
  options: z.array(toolOptionSchema).min(1).max(MAX_OPTIONS),
  // Optional-with-default rather than required: Claude's schema marks it
  // required *and* documents `default: false`, and a cross-provider model that
  // omits it should get a single-select question, not a validation error. The
  // advertised schema (TOOL_INPUT_JSON_SCHEMA) still lists it as required.
  multiSelect: z.boolean().default(false),
});

export const toolInputSchema = z.object({
  questions: z.array(toolQuestionSchema).min(1).max(MAX_QUESTIONS),
});
export type ToolInput = z.infer<typeof toolInputSchema>;

// ---------------------------------------------------------------------------
// Interaction payload — server → the plugin's composer form.
// ---------------------------------------------------------------------------

export const interactionOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  preview: z.string().min(1).optional(),
});
export type InteractionOption = z.infer<typeof interactionOptionSchema>;

export const interactionQuestionSchema = z.object({
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

export const interactionAnswerSchema = z.object({
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

// ---------------------------------------------------------------------------
// Tool result — what the model reads back.
// ---------------------------------------------------------------------------

export interface ToolResultQuestion {
  question: string;
  header: string;
  options: Array<{ label: string; description: string; preview?: string }>;
  multiSelect: boolean;
}

export interface ToolResultAnnotation {
  preview?: string;
  notes?: string;
}

/**
 * Claude Code's own `AskUserQuestion` output schema: the questions that were
 * asked, answers keyed by question text (multi-select comma-separated),
 * optional freeform `response` for text typed instead of choosing an option,
 * and optional per-question annotations. Reproduced field-for-field so a model
 * reads an identical result on every provider.
 */
export interface ToolResult {
  questions: ToolResultQuestion[];
  answers: Record<string, string>;
  response?: string;
  annotations?: Record<string, ToolResultAnnotation>;
}
