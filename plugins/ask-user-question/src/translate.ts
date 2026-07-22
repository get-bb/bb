import {
  MAX_OPTION_PREVIEW_LENGTH,
  type InteractionAnswer,
  type InteractionPayload,
  type InteractionQuestion,
  type InteractionResponse,
  type ToolInput,
  type ToolResult,
  type ToolResultAnnotation,
} from "./contracts.js";
import {
  NOT_UNIQUE_MESSAGE,
  TOO_FEW_OPTIONS_MESSAGE,
} from "./tool-definition.js";

/**
 * The semantic rules Claude enforces outside its JSON schema, in Claude's own
 * order: option arity first (it carries the strongest steer), then uniqueness.
 * Returns Claude's verbatim message, or null when the input is acceptable.
 */
export function validateToolInput(input: ToolInput): string | null {
  if (input.questions.some((question) => question.options.length < 2)) {
    return TOO_FEW_OPTIONS_MESSAGE;
  }
  const prompts = input.questions.map((question) => question.question);
  if (new Set(prompts).size !== prompts.length) return NOT_UNIQUE_MESSAGE;
  for (const question of input.questions) {
    const labels = question.options.map((option) => option.label);
    if (new Set(labels).size !== labels.length) return NOT_UNIQUE_MESSAGE;
  }
  return null;
}

/**
 * `bb.ui.requestInput` rejects payloads over 64 KiB. Previews are the only
 * unbounded contributor, so the payload is measured before the request and the
 * model is told to shorten them rather than having the request fail opaquely.
 */
export const MAX_INTERACTION_PAYLOAD_BYTES = 60 * 1024;

export class PreviewTooLargeError extends Error {
  constructor(byteLength: number) {
    super(
      `The questions are too large to display (${byteLength} bytes of option previews, limit ${MAX_INTERACTION_PAYLOAD_BYTES}). Shorten or drop the option previews and call the tool again.`,
    );
    this.name = "PreviewTooLargeError";
  }
}

function questionId(index: number): string {
  return `q${index}`;
}

function optionValue(index: number, optionIndex: number): string {
  return `${questionId(index)}o${optionIndex}`;
}

/** Blank previews are dropped rather than forwarded as empty preview blocks. */
function normalizePreview(preview: string | undefined): string | undefined {
  if (preview === undefined) return undefined;
  const trimmed = preview.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, MAX_OPTION_PREVIEW_LENGTH);
}

export function buildInteractionPayload(input: ToolInput): InteractionPayload {
  return {
    questions: input.questions.map((question, index) => ({
      id: questionId(index),
      prompt: question.question,
      shortLabel: question.header,
      multiSelect: question.multiSelect,
      options: question.options.map((option, optionIndex) => {
        // Previews are single-select only, as the tool description states: with
        // several options selected there is no single artifact to show.
        const preview = question.multiSelect
          ? undefined
          : normalizePreview(option.preview);
        return {
          value: optionValue(index, optionIndex),
          label: option.label,
          description: option.description,
          ...(preview === undefined ? {} : { preview }),
        };
      }),
      // Always on, matching the native Claude path: "Users will always be able
      // to select 'Other' to provide custom text input".
      allowFreeText: true,
    })),
  };
}

export function assertInteractionPayloadFits(
  payload: InteractionPayload,
): void {
  const byteLength = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (byteLength > MAX_INTERACTION_PAYLOAD_BYTES) {
    throw new PreviewTooLargeError(byteLength);
  }
}

/**
 * Title for the composer form. The form renders each question's prompt as its
 * own heading, so the title carries the short label(s) instead of repeating the
 * prompt.
 */
export function buildInteractionTitle(payload: InteractionPayload): string {
  const [first] = payload.questions;
  if (payload.questions.length === 1 && first) return first.shortLabel;
  return `${payload.questions.length} questions`;
}

function selectedOptions(
  question: InteractionQuestion,
  answer: InteractionAnswer,
) {
  return answer.selected.flatMap((value) => {
    const option = question.options.find(
      (candidate) => candidate.value === value,
    );
    return option === undefined ? [] : [option];
  });
}

/**
 * One answer line, in the format the native Claude path produces: selected
 * labels joined with ", ", and free text appended after "; " when the user both
 * picked options and typed something.
 */
function buildAnswerText(
  question: InteractionQuestion,
  answer: InteractionAnswer,
): string {
  const labels = selectedOptions(question, answer).map(
    (option) => option.label,
  );
  if (labels.length > 0) {
    const selectedText = labels.join(", ");
    return answer.freeText
      ? `${selectedText}; ${answer.freeText}`
      : selectedText;
  }
  if (answer.freeText) return answer.freeText;
  return "";
}

function buildAnnotation(
  question: InteractionQuestion,
  answer: InteractionAnswer,
): ToolResultAnnotation | null {
  // `notes` only when free text accompanies a real selection — free text on its
  // own is already the whole answer, so repeating it would be noise.
  const notes =
    answer.selected.length > 0 && answer.freeText !== undefined
      ? answer.freeText
      : undefined;
  const previews = selectedOptions(question, answer).flatMap((option) =>
    option.preview === undefined ? [] : [option.preview],
  );
  const preview = previews.length > 0 ? previews.join("\n\n") : undefined;
  if (notes === undefined && preview === undefined) return null;
  return {
    ...(preview === undefined ? {} : { preview }),
    ...(notes === undefined ? {} : { notes }),
  };
}

export function buildToolResult(
  payload: InteractionPayload,
  response: InteractionResponse,
): ToolResult {
  const answers: Record<string, string> = {};
  const annotations: Record<string, ToolResultAnnotation> = {};
  /**
   * Claude's `response` field is "freeform text the user typed instead of
   * selecting a structured option" — a single string, so it is only meaningful
   * when one question was asked. `answers` still carries the same text, so
   * nothing is lost for multi-question calls.
   */
  let freeformResponse: string | undefined;
  for (const question of payload.questions) {
    const answer = response.answers[question.id];
    if (answer === undefined) continue;
    const text = buildAnswerText(question, answer);
    if (text.length === 0) continue;
    answers[question.prompt] = text;
    if (
      payload.questions.length === 1 &&
      answer.selected.length === 0 &&
      answer.freeText !== undefined
    ) {
      freeformResponse = answer.freeText;
    }
    const annotation = buildAnnotation(question, answer);
    if (annotation !== null) annotations[question.prompt] = annotation;
  }
  return {
    questions: payload.questions.map((question) => ({
      question: question.prompt,
      header: question.shortLabel,
      options: question.options.map((option) => ({
        label: option.label,
        description: option.description ?? option.label,
        ...(option.preview === undefined ? {} : { preview: option.preview }),
      })),
      multiSelect: question.multiSelect,
    })),
    answers,
    ...(freeformResponse === undefined ? {} : { response: freeformResponse }),
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
  };
}
