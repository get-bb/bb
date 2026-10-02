// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PendingInteractionUserQuestionQuestion } from "@bb/domain";
import { threadPendingInteractionsQueryKey } from "@/hooks/queries/query-keys";
import { UserQuestionAnswerForm } from "./UserQuestionInteractionContent";

const mocks = vi.hoisted(() => ({
  reset: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/hooks/mutations/thread-interaction-mutations", () => ({
  useResolveThreadPendingInteraction: () => ({
    error: new Error("Pending interaction pint_stale is already interrupted"),
    isPending: false,
    mutateAsync: vi.fn(),
    reset: mocks.reset,
  }),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useStopThread: () => ({
    isPending: false,
    mutate: mocks.stop,
  }),
}));

const questions: PendingInteractionUserQuestionQuestion[] = [
  {
    id: "q1",
    prompt: "Which path should we use?",
    shortLabel: "Path",
    multiSelect: false,
    options: [
      { value: "q1:option-1", label: "Staging" },
      { value: "q1:option-2", label: "Production" },
    ],
    allowFreeText: true,
  },
];

describe("UserQuestionAnswerForm", () => {
  it("offers a recoverable refresh action for a stale submission", () => {
    const queryClient = new QueryClient();
    const pendingKey = threadPendingInteractionsQueryKey("thr_stale");
    queryClient.setQueryData(pendingKey, []);

    render(
      <QueryClientProvider client={queryClient}>
        <UserQuestionAnswerForm
          interactionId="pint_stale"
          isResolving={false}
          questions={questions}
          threadId="thr_stale"
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/expired or been resolved elsewhere/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh question state" }),
    );

    expect(mocks.reset).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(pendingKey)?.isInvalidated).toBe(true);
    queryClient.clear();
  });
});
