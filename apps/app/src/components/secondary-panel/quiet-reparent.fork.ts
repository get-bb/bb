// bb-fork(quiet-reparent): persisted UI preference for quiet reparenting
import { useCallback, useState } from "react";

const STORAGE_KEY = "bb.thread-parent-quiet-reparent";

export function useQuietReparentPreference(): readonly [
  boolean,
  (next: boolean) => void,
] {
  const [quietReparent, setQuietReparent] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const updateQuietReparent = useCallback((next: boolean) => {
    setQuietReparent(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      return;
    }
  }, []);
  return [quietReparent, updateQuietReparent] as const;
}
