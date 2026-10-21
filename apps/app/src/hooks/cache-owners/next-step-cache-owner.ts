import type { NextStep } from "@bb/domain";
import type { QueryClient } from "@tanstack/react-query";

export const nextStepQueryKey = (threadId: string | undefined) =>
  ["threads", threadId, "next-step"] as const;

export function applyNextStep(args: {
  queryClient: QueryClient;
  threadId: string;
  suggestion: NextStep | null;
}): void {
  args.queryClient.setQueryData(
    nextStepQueryKey(args.threadId),
    args.suggestion,
  );
}
