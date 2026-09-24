import type { HostDaemonSessionRow } from "@bb/db";
import {
  HOST_OFFLINE_DISPLAY_DELAY_MS,
  HOST_RECONNECT_GRACE_MS,
} from "../../constants.js";

export type HostDisconnectDisplay =
  | { kind: "hidden" }
  | { kind: "reconnecting"; graceExpiresAt: number }
  | { kind: "offline" };

export function resolveHostDisconnectDisplay(
  latestClosedSession: HostDaemonSessionRow | null,
  now: number,
): HostDisconnectDisplay {
  if (latestClosedSession === null || latestClosedSession.closedAt === null) {
    return { kind: "offline" };
  }
  const { closeReason, closedAt } = latestClosedSession;
  if (
    closeReason === "daemon-disconnect" &&
    closedAt + HOST_OFFLINE_DISPLAY_DELAY_MS > now
  ) {
    return { kind: "hidden" };
  }
  const graceExpiresAt = closedAt + HOST_RECONNECT_GRACE_MS;
  if (
    (closeReason === "daemon-disconnect" || closeReason === "expired") &&
    graceExpiresAt > now
  ) {
    return { kind: "reconnecting", graceExpiresAt };
  }
  return { kind: "offline" };
}
