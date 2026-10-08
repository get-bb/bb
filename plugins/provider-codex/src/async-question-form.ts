import { z } from "zod";
import {
  codexAsyncQuestionSchema,
  type CodexAsyncQuestion,
} from "./extension-kinds.js";

export const CODEX_ASYNC_QUESTION_RENDERER_ID = "async-question";

export const asyncQuestionPayloadSchema = z.object({
  questions: z.array(codexAsyncQuestionSchema).min(1),
});
export type AsyncQuestionPayload = z.infer<typeof asyncQuestionPayloadSchema>;

const asyncQuestionAnswerSchema = z.object({
  selected: z.array(z.string().min(1)),
  freeText: z.string().min(1).optional(),
});
type AsyncQuestionAnswer = z.infer<typeof asyncQuestionAnswerSchema>;

export const asyncQuestionResponseSchema = z.object({
  answers: z.record(z.string().min(1), asyncQuestionAnswerSchema),
});
export type AsyncQuestionResponse = z.infer<typeof asyncQuestionResponseSchema>;

export interface AsyncQuestionFormQuestion {
  id: string;
  prompt: string;
  shortLabel: string;
  multiSelect: false;
  allowFreeText: true;
  options: { value: string; label: string }[];
}

export function buildAsyncQuestionFormQuestions(
  questions: readonly CodexAsyncQuestion[],
): AsyncQuestionFormQuestion[] {
  return questions.map((question, questionIndex) => ({
    id: `question-${questionIndex + 1}`,
    prompt: question.title,
    shortLabel: `Question ${questionIndex + 1}`,
    multiSelect: false,
    allowFreeText: true,
    options: (question.options ?? []).map((label, optionIndex) => ({
      value: `option-${optionIndex + 1}`,
      label,
    })),
  }));
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
}

function answerText(
  question: AsyncQuestionFormQuestion,
  answer: AsyncQuestionAnswer,
): string {
  const labels = question.options
    .filter((option) => answer.selected.includes(option.value))
    .map((option) => option.label);
  const freeText = answer.freeText?.trim();
  return [...labels, ...(freeText ? [freeText] : [])].join("\n");
}

export function formatAsyncQuestionAnswer(
  questions: readonly CodexAsyncQuestion[],
  response: AsyncQuestionResponse,
): string {
  return buildAsyncQuestionFormQuestions(questions)
    .map((question) => {
      const answer = response.answers[question.id] ?? { selected: [] };
      return `${quote(question.prompt)}\n\n${answerText(question, answer)}`;
    })
    .join("\n\n");
}
