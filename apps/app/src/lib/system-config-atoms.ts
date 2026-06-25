import { atom } from "jotai";
import { defaultAppTheme } from "@bb/domain";
import type { WorkspaceOpenTarget } from "@bb/host-daemon-contract";
import type { HostDaemonStatusSnapshot } from "./api-host-daemon";
import type { SystemConfigResponse } from "@bb/server-contract";
import { apiClient } from "./api-server";
import { fetchHostStatus, fetchWorkspaceOpenTargets } from "./api-host-daemon";
import { wsManager } from "./ws";

// Offline/unavailable app behavior should fail closed independently of server defaults.
const unavailableSystemConfig: SystemConfigResponse = {
  experiments: {
    claudeCodeMockCliTraffic: false,
    popoutChat: false,
    popoutChatHotkey: "Alt+Space",
    uiForking: false,
  },
  appearance: defaultAppTheme,
  customThemes: [],
  featureFlags: { placeholder: false },
  hostDaemonPort: null,
  voiceTranscriptionEnabled: false,
  dataDir: "",
};

type SystemConfigLoadStatus = "failed" | "succeeded" | null;
type Milliseconds = number;

interface FetchHostStatusWithRetryArgs {
  port: number;
  retryDelaysMs: readonly Milliseconds[];
}

const LOCAL_HOST_STATUS_RETRY_DELAYS_MS: readonly Milliseconds[] = [
  100, 250, 500, 1_000,
];

let lastSystemConfigLoadStatus: SystemConfigLoadStatus = null;

function markSystemConfigLoadFailed(): void {
  lastSystemConfigLoadStatus = "failed";
}

function markSystemConfigLoadSucceeded(): void {
  lastSystemConfigLoadStatus = "succeeded";
}

function didLastSystemConfigLoadFail(): boolean {
  return lastSystemConfigLoadStatus === "failed";
}

async function loadSystemConfig(): Promise<SystemConfigResponse> {
  try {
    const res = await apiClient.system.config.$get();
    if (!res.ok) {
      markSystemConfigLoadFailed();
      return unavailableSystemConfig;
    }
    markSystemConfigLoadSucceeded();
    return (await res.json()) as SystemConfigResponse;
  } catch {
    markSystemConfigLoadFailed();
    return unavailableSystemConfig;
  }
}

function sleep(milliseconds: Milliseconds): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

// The host daemon's local API is bound to 127.0.0.1 and only sends CORS headers
// for loopback app origins. Opened from another device — or from this machine
// via a Tailscale name — every probe is a blocked cross-origin / mixed-content
// request, so we only reach for the daemon when the page itself is loopback.
export function isLoopbackOrigin(): boolean {
  if (typeof window === "undefined") return false;
  const { hostname } = window.location;
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

async function fetchHostStatusWithRetry({
  port,
  retryDelaysMs,
}: FetchHostStatusWithRetryArgs): Promise<HostDaemonStatusSnapshot | null> {
  const firstStatus = await fetchHostStatus(port);
  if (firstStatus) {
    return firstStatus;
  }

  for (const delayMs of retryDelaysMs) {
    await sleep(delayMs);
    const status = await fetchHostStatus(port);
    if (status) {
      return status;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// System config — fetched from the server on startup and re-fetched on
// reconnects. The first websocket connection only refreshes when the initial
// load failed, so a healthy startup doesn't immediately duplicate the request.
// ---------------------------------------------------------------------------

const systemConfigRefreshTickAtom = atom(0);
systemConfigRefreshTickAtom.onMount = (setRefreshTick) => {
  const unsubscribeConnected = wsManager.onConnected(({ reconnected }) => {
    if (!reconnected && !didLastSystemConfigLoadFail()) {
      return;
    }
    setRefreshTick((count) => count + 1);
  });
  const unsubscribeChanged = wsManager.onChanged((message) => {
    if (
      message.entity === "system" &&
      message.changes.includes("config-changed")
    ) {
      setRefreshTick((count) => count + 1);
    }
  });
  return () => {
    unsubscribeConnected();
    unsubscribeChanged();
  };
};

export const systemConfigAtom = atom(async (get) => {
  get(systemConfigRefreshTickAtom);
  return loadSystemConfig();
});

// ---------------------------------------------------------------------------
// Local host daemon status — probed from the host daemon on startup. Re-probes
// on server connects/reconnects and host status changes while some UI is
// subscribed to it. No-daemon is a normal state (e.g., mobile browser).
// ---------------------------------------------------------------------------

const localHostStatusRefreshTickAtom = atom(0);
localHostStatusRefreshTickAtom.onMount = (setRefreshTick) => {
  const refresh = () => {
    setRefreshTick((count) => count + 1);
  };

  const unsubscribeConnected = wsManager.onConnected(() => {
    refresh();
  });
  const unsubscribeChanged = wsManager.onChanged((message) => {
    if (message.entity === "host") {
      refresh();
    }
  });

  return () => {
    unsubscribeConnected();
    unsubscribeChanged();
  };
};

/** The local daemon status, or null if no daemon is reachable. */
export const localHostStatusAtom = atom<
  Promise<HostDaemonStatusSnapshot | null>
>(async (get) => {
  get(localHostStatusRefreshTickAtom);
  const port = await get(hostDaemonPortAtom);
  if (!port) return null;
  return fetchHostStatusWithRetry({
    port,
    retryDelaysMs: LOCAL_HOST_STATUS_RETRY_DELAYS_MS,
  });
});

/** Whether the local host daemon API is reachable. */
export const localHostDaemonReachableAtom = atom<Promise<boolean>>(
  async (get) => {
    const localHostStatus = await get(localHostStatusAtom);
    return localHostStatus !== null;
  },
);

/** The host ID reported by the local daemon, even before its server session opens. */
export const localHostDaemonHostIdAtom = atom<Promise<string | null>>(
  async (get) => {
    const localHostStatus = await get(localHostStatusAtom);
    return localHostStatus?.hostId ?? null;
  },
);

/** The local machine's connected host ID, or null if no daemon session is open. */
export const localHostIdAtom = atom<Promise<string | null>>(async (get) => {
  const localHostStatus = await get(localHostStatusAtom);
  if (!localHostStatus?.connected) {
    return null;
  }
  return localHostStatus.hostId;
});

/** Workspace open targets available through the local host daemon. */
export const localWorkspaceOpenTargetsAtom = atom<
  Promise<WorkspaceOpenTarget[]>
>(async (get) => {
  const localHostStatus = await get(localHostStatusAtom);
  if (!localHostStatus) {
    return [];
  }

  const port = await get(hostDaemonPortAtom);
  if (!port) {
    return [];
  }

  return fetchWorkspaceOpenTargets(port);
});

// ---------------------------------------------------------------------------
// Derived: host daemon port (sync access after config resolves)
// ---------------------------------------------------------------------------

/**
 * The host daemon port to probe from this browser, or null when unreachable —
 * either unconfigured by the server, or the page isn't a loopback origin (see
 * isLoopbackOrigin). The single chokepoint for whether we touch the daemon.
 */
export const hostDaemonPortAtom = atom<Promise<number | null>>(async (get) => {
  if (!isLoopbackOrigin()) return null;
  const config = await get(systemConfigAtom);
  return config.hostDaemonPort;
});
