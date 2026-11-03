import type { MobileRealtime } from "./mobile-realtime";

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
  readonly currentState: string | null | undefined;
  addEventListener(
    type: "change",
    handler: (state: AppStateStatusLike) => void,
  ): AppStateSubscriptionLike;
}

export function bindRealtimeToAppState(
  realtime: MobileRealtime,
  appState: AppStateLike,
): () => void {
  const apply = (state: string | null | undefined): void => {
    if (state === "active") realtime.resume();
    else if (state === "background") realtime.suspend();
  };
  apply(appState.currentState);
  const subscription = appState.addEventListener("change", apply);
  return () => subscription.remove();
}
