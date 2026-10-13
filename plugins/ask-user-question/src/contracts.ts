import { z } from "zod";
import { TOO_FEW_OPTIONS_MESSAGE } from "./tool-definition.js";

export const ASK_USER_QUESTION_RENDERER_ID = "ask-user-question";

const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 4;
const MAX_SELECTED = MAX_OPTIONS;
const MAX_FREE_TEXT_LENGTH = 4096;
export const MAX_OPTION_PREVIEW_LENGTH = 4096;

const nonBlank = (value: string) => value.trim().length > 0;

const interactionOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  preview: z.string().min(1).optional(),
});

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

const toolOptionSchema = z.strictObject({
  label: z
    .string()
    .min(1)
    .refine(nonBlank, "Option labels cannot be blank")
    .describe(
      "The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.",
    ),
  description: z
    .string()
    .min(1)
    .refine(nonBlank, "Option descriptions cannot be blank")
    .describe(
      "Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.",
    ),
  preview: z
    .string()
    .max(MAX_OPTION_PREVIEW_LENGTH)
    .optional()
    .describe(
      "Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options. See the tool description for the expected content format.",
    ),
});

const toolQuestionSchema = z.strictObject({
  question: z
    .string()
    .min(1)
    .refine(nonBlank, "Questions cannot be blank")
    .describe(
      'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"',
    ),
  header: z
    .string()
    .min(1)
    .refine(nonBlank, "Headers cannot be blank")
    .describe(
      'Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach".',
    ),
  options: z
    .array(toolOptionSchema)
    .min(2, TOO_FEW_OPTIONS_MESSAGE)
    .max(MAX_OPTIONS)
    .describe(
      "The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically.",
    ),
  multiSelect: z
    .boolean()
    .default(false)
    .describe(
      "Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
    ),
});

export const toolInputSchema = z.strictObject({
  questions: z
    .array(toolQuestionSchema)
    .min(1)
    .max(MAX_QUESTIONS)
    .describe("Questions to ask the user (1-4 questions)"),
});
export type ToolInput = z.infer<typeof toolInputSchema>;

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

export interface ToolResult {
  questions: ToolResultQuestion[];
  answers: Record<string, string>;
  response?: string;
  annotations?: Record<string, ToolResultAnnotation>;
}
