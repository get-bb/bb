import type { AppStateLike } from "../realtime/app-state";
import type { SessionScheduler } from "./session-scheduler";

/**
 * Renew the connect session when the app returns to the foreground: JS
 * timers do not run in the background, so a phone that slept through the
 * renewal window would otherwise resume on a dead cookie. Returns an unbind.
 */
export function bindSessionToAppState(
  scheduler: SessionScheduler,
  appState: AppStateLike,
): () => void {
  const subscription = appState.addEventListener("change", (state) => {
    if (state === "active") scheduler.renewIfDue();
  });
  return () => subscription.remove();
}
