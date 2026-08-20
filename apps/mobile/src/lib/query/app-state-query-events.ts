import type { AppStateLike } from "../realtime/app-state";

/** The slice of TanStack's `focusManager` we drive. */
export interface FocusManagerLike {
  setEventListener(
    setup: (setFocused: (focused?: boolean) => void) => () => void,
  ): void;
  setFocused(focused?: boolean): void;
}

export interface InstallAppStateQueryEventsArgs {
  AppState: AppStateLike;
  focusManager: FocusManagerLike;
}

/**
 * Drive TanStack Query's focus state from React Native's AppState so
 * `refetchOnWindowFocus` fires when the app returns to the foreground.
 * `inactive` is treated as unfocused-but-not-blurred: it does not change the
 * focus flag, so a brief interruption does not trigger a refetch storm.
 *
 * Install once per app (not per profile). Returns an uninstall function that
 * detaches the AppState listener and leaves the manager focused.
 */
export function installAppStateQueryEvents({
  AppState,
  focusManager,
}: InstallAppStateQueryEventsArgs): () => void {
  let subscription: { remove(): void } | null = null;
  focusManager.setEventListener((setFocused) => {
    setFocused(AppState.currentState === "active");
    subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setFocused(true);
      else if (state === "background") setFocused(false);
    });
    return () => {
      subscription?.remove();
      subscription = null;
    };
  });
  return () => {
    focusManager.setEventListener(() => () => {});
    focusManager.setFocused(true);
  };
}
