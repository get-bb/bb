import {
  USER_QUESTION_MAX_OPTIONS,
  USER_QUESTION_MAX_PREVIEW_LENGTH,
  USER_QUESTION_MAX_QUESTIONS,
  userQuestionPendingInteractionResolutionSchema,
} from "@bb/domain";
import { z } from "zod";
import type {
  AcpElicitationPlan,
  AcpElicitationResponse,
} from "./elicitation.js";

const nonBlankString = (label: string) =>
  z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, {
      message: `${label} cannot be blank`,
    });

const grokQuestionOptionSchema = z
  .object({
    label: nonBlankString("Grok question option labels"),
    description: nonBlankString("Grok question option descriptions").optional(),
    preview: nonBlankString("Grok question option previews")
      .max(
        USER_QUESTION_MAX_PREVIEW_LENGTH,
        `Grok question option previews cannot exceed ${USER_QUESTION_MAX_PREVIEW_LENGTH} characters`,
      )
      .optional(),
  })
  .passthrough();

const grokQuestionSchema = z
  .object({
    question: nonBlankString("Grok questions"),
    options: z
      .array(grokQuestionOptionSchema)
      .min(1, "Grok questions require at least one option")
      .max(
        USER_QUESTION_MAX_OPTIONS,
        `Grok questions cannot include more than ${USER_QUESTION_MAX_OPTIONS} options`,
      ),
    multiSelect: z.boolean(),
  })
  .passthrough()
  .superRefine((question, context) => {
    const labels = new Set<string>();
    question.options.forEach((option, index) => {
      if (labels.has(option.label)) {
        context.addIssue({
          code: "custom",
          message: "Grok question option labels must be unique",
          path: ["options", index, "label"],
        });
      }
      labels.add(option.label);
    });
  });

const grokQuestionRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    toolCallId: z.string().min(1),
    questions: z
      .array(grokQuestionSchema)
      .min(1, "Grok question requests require at least one question")
      .max(
        USER_QUESTION_MAX_QUESTIONS,
        `Grok question requests cannot include more than ${USER_QUESTION_MAX_QUESTIONS} questions`,
      ),
    mode: z.string().optional(),
  })
  .passthrough();

export type GrokQuestionRequest = z.infer<typeof grokQuestionRequestSchema>;
export type GrokQuestion = GrokQuestionRequest["questions"][number];

export function decodeGrokQuestionRequest(
  params: unknown,
): GrokQuestionRequest {
  return grokQuestionRequestSchema.parse(params);
}

function questionId(index: number): string {
  return `question-${index + 1}`;
}

function otherOptionLabel(question: GrokQuestion): string | undefined {
  return question.options.find((option) =>
    option.label.toLowerCase().startsWith("other"),
  )?.label;
}

function selectedWithFreeText(
  question: GrokQuestion,
  selected: readonly string[],
  freeText: string | undefined,
): string[] {
  const text = freeText?.trim();
  if (text === undefined || text.length === 0) return [...selected];
  const other = otherOptionLabel(question);
  if (other === undefined) return [...selected];
  if (!question.multiSelect) {
    return selected.length === 0 ? [other] : [...selected];
  }
  return selected.includes(other) ? [...selected] : [...selected, other];
}

export function buildGrokQuestionPlan(
  request: GrokQuestionRequest,
): AcpElicitationPlan {
  return {
    kind: "questions",
    payload: {
      kind: "user_question",
      questions: request.questions.map((question, index) => ({
        id: questionId(index),
        prompt: question.question,
        shortLabel: `Question ${index + 1}`,
        multiSelect: question.multiSelect,
        options: question.options.map((option) => ({
          value: option.label,
          label: option.label,
          ...(option.description !== undefined
            ? { description: option.description }
            : {}),
          ...(option.preview !== undefined ? { preview: option.preview } : {}),
        })),
        allowFreeText: question.options.some((option) =>
          option.label.toLowerCase().startsWith("other"),
        ),
        required: true,
      })),
    },
    toResponse(resolution) {
      return { action: "accept", content: resolution.answers };
    },
  };
}

export function grokQuestionResponse(
  request: GrokQuestionRequest,
  response: AcpElicitationResponse,
): Record<string, unknown> {
  if (response.action === "decline") {
    return { outcome: "chat_about_this" };
  }
  if (response.action === "cancel") {
    return { outcome: "skip_interview" };
  }

  const resolution = userQuestionPendingInteractionResolutionSchema.parse({
    kind: "user_answer",
    answers: response.content,
  });
  const answers: Record<string, string | string[]> = {};
  const annotations: Record<string, { notes?: string; preview?: string }> = {};

  request.questions.forEach((question, index) => {
    const answer = resolution.answers[questionId(index)] ?? { selected: [] };
    const selected = selectedWithFreeText(
      question,
      answer.selected,
      answer.freeText,
    );
    answers[question.question] = question.multiSelect
      ? selected
      : (selected[0] ?? "");

    const annotation: { notes?: string; preview?: string } = {};
    const notes = answer.freeText?.trim();
    if (notes !== undefined && notes.length > 0) {
      annotation.notes = notes;
    }
    const preview = selected
      .map(
        (value) =>
          question.options.find((option) => option.label === value)?.preview,
      )
      .find((value) => value !== undefined);
    if (preview !== undefined) {
      annotation.preview = preview;
    }
    if (annotation.notes !== undefined || annotation.preview !== undefined) {
      annotations[question.question] = annotation;
    }
  });

  return {
    outcome: "accepted",
    answers,
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
  };
}
