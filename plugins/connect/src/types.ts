// Status shape shared by the rpc results, the realtime "connect" channel,
// and the panel. Kept in one module so the frontend imports the same type
// the backend serializes.

export type ConnectStateName =
  | "disconnected"
  | "pairing"
  | "connected"
  | "reconnecting";

export interface ConnectShareStatus {
  port: number;
  url: string;
}

export interface ConnectStatus {
  /**
   * disconnected — no credential stored ("not paired", a healthy state);
   * pairing — a pair() call is redeeming a code right now;
   * connected — the tunnel socket to the gate is open;
   * reconnecting — paired but the tunnel is down (dialing with backoff).
   */
  state: ConnectStateName;
  paired: boolean;
  handle: string | null;
  /** Public URL, e.g. https://<handle>.getbb.app; null when not paired. */
  url: string | null;
  lastError: string | null;
  /** Epoch ms when the current state was entered. */
  since: number;
  /**
   * Count of currently-open tunneled WS streams whose path is the bb app's
   * realtime socket (`/ws…`) and that have no share target — i.e. remote
   * viewers of this bb through the bare handle URL.
   */
  remoteClients: number;
  /** Epoch ms of the last relayed tunnel frame of any kind; null if none yet. */
  lastRemoteActivityAt: number | null;
  /** Currently registered port shares (URL requires a pairing). */
  shares: ConnectShareStatus[];
}

export const CONNECT_REALTIME_CHANNEL = "connect";

/** Window during which recent remote activity keeps instructions active. */
export const REMOTE_ACTIVITY_INSTRUCTIONS_MS = 5 * 60 * 1000;
