// Status shape shared by the rpc results, the realtime "connect" channel,
// and the panel. Kept in one module so the frontend imports the same type
// the backend serializes.

export type ConnectStateName =
  | "disconnected"
  | "pairing"
  | "connected"
  | "reconnecting";

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
}

export const CONNECT_REALTIME_CHANNEL = "connect";
