import { useEffect, useState } from "react";
import type { Host } from "@bb/domain";

export const HOST_WAIT_FAILURE_MS = 30_000;

export type HostWaitFailure = "no_host" | "host_unavailable";

export function useReadyHost({
  hostsLoaded,
  primaryHost,
}: {
  hostsLoaded: boolean;
  primaryHost: Host | null;
}): { readyHost: Host | null; hostWaitFailure: HostWaitFailure | null } {
  const [connectedHostId, setConnectedHostId] = useState<string | null>(null);
  if (
    primaryHost?.status === "connected" &&
    connectedHostId !== primaryHost.id
  ) {
    setConnectedHostId(primaryHost.id);
  }
  const readyHost =
    primaryHost !== null &&
    (primaryHost.status === "connected" || primaryHost.id === connectedHostId)
      ? primaryHost
      : null;
  const waiting = hostsLoaded && readyHost === null;
  const [waitExpired, setWaitExpired] = useState(false);
  if (!waiting && waitExpired) {
    setWaitExpired(false);
  }
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(
      () => setWaitExpired(true),
      HOST_WAIT_FAILURE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [waiting]);
  return {
    readyHost,
    hostWaitFailure:
      waiting && waitExpired
        ? primaryHost === null
          ? "no_host"
          : "host_unavailable"
        : null,
  };
}
