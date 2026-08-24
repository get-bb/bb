// Status shape shared by the rpc results, the realtime "connect" channel,
// and the panel. Kept in one module so the frontend imports the same type
// the backend serializes.

export type ConnectStateName =
  | "disconnected"
  | "pairing"
  | "connected"
  | "reconnecting";

interface ConnectShareStatus {
  hostId: string;
  hostName: string;
  port: number;
  createdAt: number;
  url: string;
  /** Present only when url is empty because this share cannot resolve now. */
  unavailableReason?: string;
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
  /**
   * Routing label of the paired server (subdomain). Equal to the account
   * handle for the primary bb; a distinct label when an additional bb is
   * paired. Null when unpaired.
   */
  handle: string | null;
  /** Public URL, e.g. https://<label>.getbb.app; null when not paired. */
  url: string | null;
  /**
   * getbb.app dashboard URL to mint connect codes — derived from the paired
   * base domain (or the connect apex when unpaired), never a frontend
   * literal, so staging/self-hosted gates point at their own dashboard.
   */
  dashboardUrl: string;
  /**
   * Human transport error for the reconnecting state (e.g. "can't reach
   * getbb.app — connection refused"); null when connected or never failed.
   */
  lastError: string | null;
  /**
   * Epoch ms of the next scheduled reconnect attempt while reconnecting;
   * null when connected/disconnected or no retry is pending. Drives the
   * "retrying in Ns" hint.
   */
  nextRetryAt: number | null;
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
