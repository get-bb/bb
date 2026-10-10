import { useCallback, useState } from "react";
import type { ThreadTimelineSessionOption } from "@bb/server-contract";
import type {
  SessionOptionChoice,
  SessionOptionChoices,
} from "@/components/pickers/SessionOptionsMenu";
import { useUpdateThread } from "@/hooks/mutations/thread-state-mutations";

type SessionOptions = readonly ThreadTimelineSessionOption[] | null;

interface OptimisticChoices {
  threadId: string;
  options: SessionOptions;
  choices: SessionOptionChoices;
}

const NO_CHOICES: SessionOptionChoices = {};

export function useThreadSessionOptionChoices(args: {
  threadId: string;
  options: SessionOptions;
}): {
  choices: SessionOptionChoices;
  choose: (optionId: string, value: SessionOptionChoice) => void;
} {
  const { threadId, options } = args;
  const { mutate } = useUpdateThread({
    errorMessage: "Failed to change the agent option.",
  });
  const [optimistic, setOptimistic] = useState<OptimisticChoices>({
    threadId,
    options,
    choices: NO_CHOICES,
  });
  const choices =
    optimistic.threadId === threadId && optimistic.options === options
      ? optimistic.choices
      : NO_CHOICES;

  const choose = useCallback(
    (optionId: string, value: SessionOptionChoice) => {
      setOptimistic({
        threadId,
        options,
        choices: { ...choices, [optionId]: value },
      });
      mutate(
        { id: threadId, sessionOptions: { [optionId]: value } },
        {
          onError: () => {
            setOptimistic((current) => {
              if (
                current.threadId !== threadId ||
                current.choices[optionId] !== value
              ) {
                return current;
              }
              const { [optionId]: _failed, ...rest } = current.choices;
              return { ...current, choices: rest };
            });
          },
        },
      );
    },
    [choices, mutate, options, threadId],
  );

  return { choices, choose };
}
