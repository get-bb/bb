import { useCallback, useEffect, useMemo, useState } from "react";
import { QuestionForm } from "./question-form.js";
import type { Question } from "./question-form-state.js";
import {
  QuestionFormHostProvider,
  type QuestionFormHost,
} from "./question-form-host.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/QuestionForm",
};

const QUESTIONS: readonly Question[] = [
  {
    id: "environment",
    prompt: "Which environment should this run against?",
    shortLabel: "Environment",
    multiSelect: false,
    allowFreeText: false,
    options: [
      { value: "staging", label: "Staging", description: "Safe to break" },
      { value: "production", label: "Production", description: "Customer-facing" },
    ],
  },
  {
    id: "notify",
    prompt: "Who should be notified when this finishes?",
    shortLabel: "Notify",
    multiSelect: true,
    allowFreeText: true,
    options: [
      { value: "me", label: "Just me" },
      { value: "team", label: "#platform-team" },
    ],
  },
];

function useDemoQuestionFormHost(): QuestionFormHost {
  const [handler, setHandler] = useState<((index: number) => boolean) | null>(
    null,
  );
  const shortcuts = useMemo(
    () =>
      new Map([
        ["0", { label: "1", ariaKeyshortcuts: "1" }],
        ["1", { label: "2", ariaKeyshortcuts: "2" }],
      ]),
    [],
  );
  const registerChoiceHandler = useCallback(
    (next: (index: number) => boolean) => {
      setHandler(() => next);
      return () => setHandler(null);
    },
    [],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const index = Number(event.key) - 1;
      if (!Number.isNaN(index)) handler?.(index);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handler]);

  return { shortcuts, registerChoiceHandler };
}

function AskUserQuestionDemo() {
  const host = useDemoQuestionFormHost();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <QuestionFormHostProvider value={host}>
      <div className="w-96">
        {result ? (
          <p className="text-sm text-muted-foreground">{result}</p>
        ) : (
          <QuestionForm
            questions={QUESTIONS}
            disabled={busy}
            cancelDisabled={busy}
            onSubmit={(answers) => {
              setBusy(true);
              setTimeout(() => {
                setBusy(false);
                setResult(`Submitted: ${JSON.stringify(answers)}`);
              }, 400);
            }}
            onCancel={() => setResult("Cancelled")}
          />
        )}
      </div>
    </QuestionFormHostProvider>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Question form with number-key shortcuts"
        hint="plugins/ask-user-question/app.tsx + apps/app ThreadQuestionFormHost.tsx — host-provided number-key shortcuts"
      >
        <AskUserQuestionDemo />
      </StoryRow>
    </StoryCard>
  );
}
