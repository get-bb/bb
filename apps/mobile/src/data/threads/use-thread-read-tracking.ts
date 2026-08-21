import { focusManager } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  createThreadReadTracker,
  type MarkThreadReadFn,
  type ThreadReadTrackingThread,
} from "./read-tracking";

interface UseThreadReadTrackingArgs {
  thread: ThreadReadTrackingThread | undefined;
  /** The screen is the visible one in the stack (`useIsFocused()`). */
  isScreenFocused: boolean;
  /** `useMarkThreadRead().mutate` (stable across renders). */
  markThreadRead: MarkThreadReadFn;
}

/**
 * Whether the app is in the foreground. TanStack's focus manager is already
 * driven by AppState (`installAppStateQueryEvents`), so this needs no
 * react-native import and stays consistent with query refetch-on-focus.
 */
function useAppIsForeground(): boolean {
  return useSyncExternalStore(
    (onChange) => focusManager.subscribe(() => onChange()),
    () => focusManager.isFocused(),
    () => true,
  );
}

/**
 * Mark the open thread read while it is visible: on open, when new attention
 * arrives, and when the app returns to the foreground (see
 * `createThreadReadTracker` for the exact policy).
 */
export function useThreadReadTracking({
  thread,
  isScreenFocused,
  markThreadRead,
}: UseThreadReadTrackingArgs): void {
  const isForeground = useAppIsForeground();
  const [tracker] = useState(createThreadReadTracker);

  useEffect(() => {
    tracker.update({
      thread,
      isVisible: isForeground && isScreenFocused,
      markRead: markThreadRead,
    });
  }, [tracker, thread, isForeground, isScreenFocused, markThreadRead]);
}
