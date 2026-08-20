import type { MobileRealtime } from "./mobile-realtime";

/** The slice of React Native's `AppState` the lifecycle bindings use. */
export type AppStateStatusLike =
  | "active"
  | "background"
  | "inactive"
  | "unknown"
  | "extension";

export interface AppStateSubscriptionLike {
  remove(): void;
}

export interface AppStateLike {
  readonly currentState: AppStateStatusLike;
  addEventListener(
    type: "change",
    handler: (state: AppStateStatusLike) => void,
  ): AppStateSubscriptionLike;
}

/**
 * Suspend the realtime socket in the background and resume it when the app is
 * active again. `inactive` (iOS transient: control center, incoming call,
 * app switcher) is ignored so brief interruptions do not drop the socket.
 * Returns an unbind function.
 */
export function bindRealtimeToAppState(
  realtime: MobileRealtime,
  appState: AppStateLike,
): () => void {
  const apply = (state: AppStateStatusLike): void => {
    if (state === "active") realtime.resume();
    else if (state === "background") realtime.suspend();
  };
  apply(appState.currentState);
  const subscription = appState.addEventListener("change", apply);
  return () => subscription.remove();
}
