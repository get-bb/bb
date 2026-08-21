/** Default base delay before the first reconnect attempt (1s). */
export const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
/** Cap on exponential reconnect delay (30s). */
export const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;
/**
 * A connection that stayed open more than this long resets the attempt
 * counter (so a brief blip after a stable session does not jump to long delays).
 * Equality with the threshold does not reset — the comparison is strict `>`.
 */
const DEFAULT_STABLE_CONNECTION_MS = 10_000;

export interface ReconnectBackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  stableConnectionMs?: number;
}

/**
 * Capped exponential backoff for tunnel reconnects.
 *
 * Matches the historical ConnectTunnel schedule: delay = min(base * 2^attempt,
 * max), with attempt reset after a connection that was open longer than the
 * stable threshold.
 */
export class ReconnectBackoff {
  private attempt = 0;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly stableConnectionMs: number;

  constructor(options: ReconnectBackoffOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS;
    this.stableConnectionMs =
      options.stableConnectionMs ?? DEFAULT_STABLE_CONNECTION_MS;
  }

  reset(): void {
    this.attempt = 0;
  }

  /**
   * Record a socket close after `stableMs` of uptime and return the delay
   * (ms) before the next dial.
   */
  nextDelayAfterClose(stableMs: number): number {
    this.attempt = stableMs > this.stableConnectionMs ? 0 : this.attempt + 1;
    return Math.min(this.baseDelayMs * 2 ** this.attempt, this.maxDelayMs);
  }
}
