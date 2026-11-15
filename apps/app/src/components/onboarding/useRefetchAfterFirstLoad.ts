import { useCallback, useEffect, useRef, useState } from "react";
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
  const [deferredRefetches, setDeferredRefetches] = useState(0);
  const issuedDeferredRefetchesRef = useRef(0);
  if (freshAfter === Number.POSITIVE_INFINITY && loaded) {
    setFreshAfter(settledAt);
    setDeferredRefetches((count) => count + 1);
  }
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
    if (issuedDeferredRefetchesRef.current === deferredRefetches) return;
    issuedDeferredRefetchesRef.current = deferredRefetches;
    refetch({ cancelRefetch: true });
  }, [deferredRefetches, refetch]);
  return {
    refetch: refetchOrDefer,
    settledAt: freshAfter !== null && settledAt <= freshAfter ? 0 : settledAt,
  };
}
