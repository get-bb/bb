import { useEffect, useRef } from "react";
import type { SystemProviderState } from "@bb/server-contract";

export function useRefetchOnUpdateNeeded({
  states,
  refetch,
}: {
  states: readonly SystemProviderState[] | undefined;
  refetch: () => void;
}): void {
  const seenRef = useRef<ReadonlySet<string>>(new Set());
  const needingUpdate =
    states === undefined
      ? null
      : states
          .filter((state) => state.status === "unsupported_version")
          .map((state) => state.providerId)
          .sort()
          .join("\n");
  useEffect(() => {
    if (needingUpdate === null) return;
    const ids = new Set(needingUpdate === "" ? [] : needingUpdate.split("\n"));
    const seen = seenRef.current;
    seenRef.current = ids;
    if ([...ids].some((id) => !seen.has(id))) refetch();
  }, [needingUpdate, refetch]);
}
