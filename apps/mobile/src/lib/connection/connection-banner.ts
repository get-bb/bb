import type { MobileRealtimeConnectionState } from "../realtime/mobile-realtime";
import type { SessionState } from "../session/session-scheduler";

/**
 * What the persistent connection banner should say. `hidden` is the normal
 * connected state; everything else is a degraded state worth surfacing.
 */
export type ConnectionBannerKind =
  | "hidden"
  /** First socket not open yet (past the grace period). */
  | "connecting"
  /** Was connected before; the socket dropped and is backing off. */
  | "reconnecting"
  /** Connect mode: the machine credential was rejected; the profile must re-pair. */
  | "auth-required"
  /** Connect mode: session mint failed transiently; a retry is scheduled. */
  | "auth-error";

export interface ConnectionBannerInput {
  session: SessionState;
  realtime: MobileRealtimeConnectionState;
  /** Realtime is suspended (app in background): nothing to show. */
  suspended: boolean;
  /** How long realtime has been in `connecting` without ever connecting. */
  connectingForMs: number;
}

/** Initial connects shorter than this are not worth a banner flash. */
export const CONNECTING_BANNER_GRACE_MS = 1500;

/**
 * Precedence: auth problems beat socket state (the socket cannot come up
 * without a session), reconnecting beats connecting, and the first connect is
 * silent for {@link CONNECTING_BANNER_GRACE_MS}.
 */
export function deriveConnectionBanner(
  input: ConnectionBannerInput,
): ConnectionBannerKind {
  if (input.suspended) return "hidden";
  switch (input.session.status) {
    case "auth-required":
      return "auth-required";
    case "error":
      return "auth-error";
    // `authenticating` also covers the hourly renewal while the socket is up,
    // so it defers to the realtime state rather than flashing "connecting".
    case "authenticating":
    case "idle":
    case "authenticated":
      break;
  }
  switch (input.realtime) {
    case "connected":
      return "hidden";
    case "reconnecting":
      return "reconnecting";
    case "connecting":
      return input.connectingForMs >= CONNECTING_BANNER_GRACE_MS
        ? "connecting"
        : "hidden";
  }
}
