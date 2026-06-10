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
    <div className="space-y-3 text-xs leading-snug">
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
      {/* Differentiate by bb's foreground tiers (color), not weight: the prompt
          recedes to subtle-foreground while the answer is full foreground. The
          two-tier gap (vs muted) is what keeps them distinguishable in dark
          mode, where foreground and muted-foreground nearly coincide. */}
      <div className="text-subtle-foreground">{question.prompt}</div>
      {hasContent ? (
        <div className="mt-0.5 text-foreground">
          {selectedLabels.length > 0 ? (
            <div>{selectedLabels.join(", ")}</div>
          ) : null}
          {freeText ? (
            <div className="whitespace-pre-wrap">{freeText}</div>
          ) : null}
        </div>
      ) : (
        <div className="mt-0.5 text-subtle-foreground">No answer</div>
      )}
    </div>
  );
}
