import type {
  PendingInteractionUserAnswer,
  PendingInteractionUserQuestionQuestion,
} from "@bb/domain";
import type { TimelineQuestionViewWorkRow } from "@bb/thread-view";
import { formatPendingInteractionUserQuestionOptionLabel } from "@bb/core-ui";

interface QuestionWorkRowBodyProps {
  row: TimelineQuestionViewWorkRow;
}

interface AnsweredQuestionRowProps {
  question: PendingInteractionUserQuestionQuestion;
  answer: PendingInteractionUserAnswer | null;
}

export function QuestionWorkRowBody({ row }: QuestionWorkRowBodyProps) {
  // `resolving` and `answered` both have a recorded answer set — the
  // projection wires `row.answers` from the resolution as soon as the user
  // submits. Pending and interrupted states are fully described by
  // the row title (see `mapQuestionTitle` in @bb/thread-view), so their body
  // collapses out and the row renders title-only like web-search/web-fetch.
  if (row.lifecycle !== "answered" && row.lifecycle !== "resolving") {
    return null;
  }
  return (
    <div className="space-y-2 text-xs leading-snug">
      {row.questions.map((question) => (
        <AnsweredQuestionRow
          key={question.id}
          question={question}
          answer={row.answers?.[question.id] ?? null}
        />
      ))}
    </div>
  );
}

// Full question prompt with the answer beneath, rather than a short-label /
// value row — the prompt is the point, and it rarely fits a narrow label column.
function AnsweredQuestionRow({ question, answer }: AnsweredQuestionRowProps) {
  const selectedLabels =
    answer?.selected.map((value) =>
      formatPendingInteractionUserQuestionOptionLabel({ question, value }),
    ) ?? [];
  const freeText = answer?.freeText ?? null;
  const hasContent = selectedLabels.length > 0 || freeText !== null;

  return (
    <div>
      {/* The agent's prompt reads as a quiet label; the user's answer sits in a
          faint "paper" reply card below it so the two are clearly
          differentiated (echoing the raised user-content surface). */}
      <div className="font-medium text-muted-foreground">{question.prompt}</div>
      {hasContent ? (
        <div className="mt-1 rounded-md bg-surface-raised px-2.5 py-1.5 text-foreground">
          {selectedLabels.length > 0 ? (
            <div>{selectedLabels.join(", ")}</div>
          ) : null}
          {freeText ? (
            <div className="whitespace-pre-wrap">{freeText}</div>
          ) : null}
        </div>
      ) : (
        <div className="mt-1 text-subtle-foreground">No answer</div>
      )}
    </div>
  );
}
