import { useCallback } from "react";
import { useStore } from "jotai";
import { useNavigate } from "react-router-dom";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  openNewThread,
  type NewThreadOptions,
} from "@/lib/split-layout/openNewThread";

export function useOpenNewThread(): (options?: NewThreadOptions) => void {
  const navigate = useNavigate();
  const store = useStore();
  const isCompact = useIsCompactViewport();
  return useCallback(
    (options?: NewThreadOptions) =>
      openNewThread({ navigate, store, isCompact, ...options }),
    [isCompact, navigate, store],
  );
}
