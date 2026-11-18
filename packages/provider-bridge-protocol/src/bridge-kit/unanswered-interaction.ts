import type { ThreadDelta } from "../thread-delta.js";

export type UnansweredInteractionCause =
  | { kind: "unshowable-request"; detail: string }
  | { kind: "runtime-error"; message: string }
  | { kind: "unreadable-resolution" }
  | { kind: "unmappable-answer"; detail: string }
  | { kind: "withdrawn"; detail: string };

export type UnansweredInteractionAnswer =
  | { kind: "error" }
  | { kind: "value"; value: string };

export interface UnansweredInteractionWarningArgs {
  cause: UnansweredInteractionCause;
  answer: UnansweredInteractionAnswer;
}

export const UNANSWERED_INTERACTION_WARNING_SUMMARY =
  "bb answered the agent without you";

function sentence(text: string): string {
  return text.trim().replace(/[.\s]+$/u, "");
}

function causeText(cause: UnansweredInteractionCause): string {
  switch (cause.kind) {
    case "unshowable-request":
      return `it could not show the question: ${sentence(cause.detail)}`;
    case "runtime-error":
      return `it stopped waiting for your answer: ${sentence(cause.message)}`;
    case "unreadable-resolution":
      return "it could not read the answer it received";
    case "unmappable-answer":
      return `your answer did not fit the question: ${sentence(cause.detail)}`;
    case "withdrawn":
      return `it withdrew the question: ${sentence(cause.detail)}`;
  }
}

function agentCauseText(cause: UnansweredInteractionCause): string {
  switch (cause.kind) {
    case "unshowable-request":
      return `bb could not show the question (${sentence(cause.detail)})`;
    case "runtime-error":
      return `bb stopped waiting for the answer (${sentence(cause.message)})`;
    case "unreadable-resolution":
      return "bb could not read the answer it received";
    case "unmappable-answer":
      return `the answer did not fit the question (${sentence(cause.detail)})`;
    case "withdrawn":
      return `bb withdrew the question (${sentence(cause.detail)})`;
  }
}

export function unansweredInteractionErrorMessage(
  cause: UnansweredInteractionCause,
): string {
  return `The user did not answer: ${agentCauseText(cause)}.`;
}

export function unansweredInteractionWarning(
  args: UnansweredInteractionWarningArgs,
): Extract<ThreadDelta, { kind: "provider.warning" }> {
  const answer =
    args.answer.kind === "error"
      ? "an error"
      : JSON.stringify(args.answer.value);
  return {
    kind: "provider.warning",
    summary: UNANSWERED_INTERACTION_WARNING_SUMMARY,
    details: `bb answered the agent with ${answer} because ${causeText(args.cause)}.`,
    vouchedTurn: true,
  };
}
