import { z } from "zod";
import {
  MAX_OPTION_PREVIEW_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTIONS,
} from "@bb/plugin-interaction-contracts";

// The interaction payload/response contract (what the server hands the form
// and what the form submits back) lives in @bb/plugin-interaction-contracts so
// clients that cannot run this plugin's React DOM bundle (the native app) can
// render the same form. Re-exported here so the plugin's own modules keep one
// import path; the tool input/result shapes below stay plugin-private.
export {
  ASK_USER_QUESTION_RENDERER_ID,
  MAX_OPTION_PREVIEW_LENGTH,
  interactionPayloadSchema,
  interactionResponseSchema,
  type InteractionAnswer,
  type InteractionOption,
  type InteractionPayload,
  type InteractionQuestion,
  type InteractionResponse,
} from "@bb/plugin-interaction-contracts";

const nonBlank = (value: string) => value.trim().length > 0;

// ---------------------------------------------------------------------------
// Tool input — the shape the model sends.
// ---------------------------------------------------------------------------

const toolOptionSchema = z.object({
  label: z.string().min(1).refine(nonBlank, "Option labels cannot be blank"),
  description: z
    .string()
    .min(1)
    .refine(nonBlank, "Option descriptions cannot be blank"),
  preview: z.string().max(MAX_OPTION_PREVIEW_LENGTH).optional(),
});

const toolQuestionSchema = z.object({
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
// Tool result — what the model reads back.
// ---------------------------------------------------------------------------

interface ToolResultQuestion {
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
