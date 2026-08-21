import { useEffect, useState, useSyncExternalStore } from "react";
import {
  CONNECTING_BANNER_GRACE_MS,
  deriveConnectionBanner,
  type ConnectionBannerKind,
} from "@/lib/connection";
import type { MobileRealtimeConnectionState } from "@/lib/realtime";
import { useProfiles } from "./ProfilesProvider";

/** Realtime socket state of the active profile (`connecting` when none). */
export function useRealtimeConnectionState(): MobileRealtimeConnectionState {
  const { connection } = useProfiles();
  const realtime = connection?.client.realtime ?? null;
  return useSyncExternalStore(
    (listener) => realtime?.onConnectionStateChange(listener) ?? (() => {}),
    () => realtime?.getConnectionState() ?? "connecting",
    () => "connecting",
  );
}

/**
 * What the connection banner should show for the active profile. The
 * initial-connect grace period is timed here (the pure derivation only sees
 * elapsed time).
 */
export function useConnectionBanner(): ConnectionBannerKind {
  const { connection } = useProfiles();
  const realtimeState = useRealtimeConnectionState();
  const clientKey = connection?.client.profileId ?? null;
  // The profile whose initial connect has outlived the grace period. Derived
  // (not reset) so the effect never sets state synchronously.
  const [graceElapsedFor, setGraceElapsedFor] = useState<string | null>(null);

  useEffect(() => {
    if (realtimeState !== "connecting" || clientKey === null) return;
    const timer = setTimeout(
      () => setGraceElapsedFor(clientKey),
      CONNECTING_BANNER_GRACE_MS,
    );
    return () => clearTimeout(timer);
  }, [realtimeState, clientKey]);

  if (!connection) return "hidden";
  return deriveConnectionBanner({
    session: connection.session,
    realtime: realtimeState,
    suspended: connection.client.realtime.isSuspended(),
    connectingForMs:
      graceElapsedFor === clientKey ? CONNECTING_BANNER_GRACE_MS : 0,
  });
}
