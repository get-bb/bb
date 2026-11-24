import { useMemo } from "react";
import { atom, useStore } from "jotai";
import type { ExperimentalThreadRequests } from "@get-bb/plugin-sdk";

export const threadRequestsAtom = atom<ExperimentalThreadRequests | null>(null);

export function bindThreadRequests(
  store: () => ReturnType<typeof useStore>,
): ExperimentalThreadRequests {
  const requests = () => {
    const current = store().get(threadRequestsAtom);
    if (current === null) {
      throw new Error(
        "Thread requests are unavailable outside ThreadActionsProvider",
      );
    }
    return current;
  };
  return {
    requestArchive: async (threadIds) => requests().requestArchive(threadIds),
    requestDelete: async (threadIds) => requests().requestDelete(threadIds),
  };
}

export function useThreadRequests(): ExperimentalThreadRequests {
  const store = useStore();
  return useMemo(() => bindThreadRequests(() => store), [store]);
}
