import { useEffect, useRef, useState } from "react";
import type { Question } from "@ai-ecoverse/gpu-ask.js";
import { detectAgentQuestions } from "./agent-questions.js";
import type { ThreadTimelineAddToChatHandler } from "./types.js";

interface AgentQuestionChoicesProps {
  text: string;
  onAddToChat?: ThreadTimelineAddToChatHandler;
}

export function AgentQuestionChoices({
  text,
  onAddToChat,
}: AgentQuestionChoicesProps) {
  const marker = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const [result, setResult] = useState<{
    text: string;
    questions: Question[];
  } | null>(null);
  useEffect(() => {
    const target = marker.current?.parentElement;
    if (
      target === undefined ||
      target === null ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void detectAgentQuestions(text).then((questions) => {
      if (active) setResult({ text, questions });
    });
    return () => {
      active = false;
    };
  }, [text, visible]);

  const questions = result?.text === text ? result.questions : [];
  return (
    <div
      ref={marker}
      className={
        questions.length > 0
          ? "mt-3 space-y-3 border-l-2 border-primary pl-3"
          : undefined
      }
      aria-label={questions.length > 0 ? "Questions from agent" : undefined}
    >
      {questions.map((question, index) => (
        <div key={`${question.span[0]}-${index}`} className="space-y-1.5">
          <p className="font-medium text-foreground">{question.prompt}</p>
          {question.options.length > 0 || question.kind === "yes_no" ? (
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label={`Answers to ${question.prompt}`}
            >
              {(question.options.length > 0
                ? question.options
                : ["Yes", "No"]
              ).map((option, optionIndex) => (
                <button
                  key={`${optionIndex}-${option}`}
                  type="button"
                  aria-label={`Add ${option} to chat`}
                  disabled={onAddToChat === undefined}
                  className="rounded-md border border-border-seam bg-surface-recessed px-2.5 py-1 text-left text-sm text-foreground transition-colors enabled:hover:bg-state-hover enabled:focus-visible:outline-none enabled:focus-visible:ring-2 enabled:focus-visible:ring-ring disabled:cursor-default"
                  onClick={() => onAddToChat?.(option)}
                >
                  {option}
                  {question.default === optionIndex ? (
                    <span className="ml-1 text-muted-foreground">
                      Recommended
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
