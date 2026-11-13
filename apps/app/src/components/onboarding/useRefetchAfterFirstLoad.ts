import { useCallback, useEffect, useState } from "react";
import type { RefetchProviderStates } from "./useAgentSignIns";

export function useRefetchAfterFirstLoad({
  loaded,
  settledAt,
  refetch,
}: {
  loaded: boolean;
  settledAt: number;
  refetch: RefetchProviderStates;
}): { refetch: RefetchProviderStates; settledAt: number } {
  const [freshAfter, setFreshAfter] = useState<number | null>(null);
  const deferred = freshAfter === Number.POSITIVE_INFINITY;
  const refetchOrDefer = useCallback<RefetchProviderStates>(
    (options) => {
      if (loaded) {
        refetch(options);
      } else {
        setFreshAfter(Number.POSITIVE_INFINITY);
      }
    },
    [loaded, refetch],
  );
  useEffect(() => {
    if (!deferred || !loaded) return;
    setFreshAfter(Date.now());
    refetch({ cancelRefetch: true });
  }, [deferred, loaded, refetch]);
  return {
    refetch: refetchOrDefer,
    settledAt: freshAfter !== null && settledAt <= freshAfter ? 0 : settledAt,
  };
}
