import {
  bindRealtimeToAppState,
  type AppStateLike,
} from "../realtime/app-state";
import type { ProfileClient } from "./client-registry";

/**
 * Bring a profile's realtime socket up and tie it to the app lifecycle
 * (suspend in background, resume when active). Returns a teardown that
 * unbinds and disconnects; call it when another profile becomes active.
 * Connect-mode profiles must have an installed session cookie first (see
 * `createSessionScheduler`), or the `/ws` upgrade is refused by the gate.
 */
export function connectProfileClient(
  client: ProfileClient,
  appState: AppStateLike,
): () => void {
  client.realtime.connect();
  const unbind = bindRealtimeToAppState(client.realtime, appState);
  return () => {
    unbind();
    client.realtime.disconnect();
  };
}
