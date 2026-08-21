const CONNECT_SESSION_RENEWAL_LEAD_MS = 5 * 60 * 1000;
const CONNECT_SESSION_MIN_RENEWAL_DELAY_MS = 30 * 1000;

export type ConnectSessionAuthenticateResult =
  | { expiresAt: number; ok: true }
  | { detail: string; ok: false };

/**
 * Mint and install a session cookie for `remoteServerUrl`.
 *
 * `isCurrent` reports whether that server is still the app's target. A slow
 * authentication must consult it before any expensive fallback, because the
 * user can switch targets while it runs.
 */
type ConnectSessionAuthenticate = (
  remoteServerUrl: string,
  isCurrent: () => boolean,
) => Promise<ConnectSessionAuthenticateResult>;

interface CreateConnectSessionRenewalArgs {
  authenticate: ConnectSessionAuthenticate;
  clearTimeoutFn?: (handle: unknown) => void;
  log?: (message: string) => void;
  now?: () => number;
  setTimeoutFn?: (handler: () => void, timeout: number) => unknown;
}

export interface ConnectSessionRenewal {
  /** Renew now when the session is spent or nearly spent. */
  renewIfDue(): void;
  /** Renew now, coalescing with a renewal already in flight. */
  renewNow(): Promise<void>;
  /** Track a fresh session for this server, and renew it before it expires. */
  start(args: { expiresAt: number; remoteServerUrl: string }): void;
  /** Forget the current session: a target switch, or quit. */
  stop(): void;
}

/**
 * Keep a Connect session cookie alive.
 *
 * The gate issues a one-hour cookie, and the app can hold one remote target far
 * longer than that. So it re-mints ahead of expiry, and on demand when the app
 * becomes active — a sleeping Mac holds timers, and waking must not land on a
 * dead session.
 *
 * Every session gets a generation. `stop()` and `start()` both retire the
 * current one, so a renewal that finishes after the user left its target
 * neither reschedules itself nor revives that target.
 */
export function createConnectSessionRenewal(
  args: CreateConnectSessionRenewalArgs,
): ConnectSessionRenewal {
  const leadMs = CONNECT_SESSION_RENEWAL_LEAD_MS;
  const minDelayMs = CONNECT_SESSION_MIN_RENEWAL_DELAY_MS;
  const now = args.now ?? Date.now;
  const setTimeoutFn =
    args.setTimeoutFn ??
    ((handler: () => void, timeout: number) => {
      const handle = setTimeout(handler, timeout);
      handle.unref();
      return handle;
    });
  const clearTimeoutFn =
    args.clearTimeoutFn ??
    ((handle: unknown) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });

  let generation = 0;
  let expiresAt: number | null = null;
  let serverUrl: string | null = null;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;

  function retire(): void {
    generation += 1;
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    expiresAt = null;
    serverUrl = null;
  }

  function start(session: {
    expiresAt: number;
    remoteServerUrl: string;
  }): void {
    retire();
    const startedGeneration = generation;
    expiresAt = session.expiresAt;
    serverUrl = session.remoteServerUrl;
    timer = setTimeoutFn(
      () => {
        if (generation !== startedGeneration) {
          return;
        }
        timer = null;
        void renewNow();
      },
      Math.max(minDelayMs, session.expiresAt - now() - leadMs),
    );
  }

  async function runRenewal(
    remoteServerUrl: string,
    startedGeneration: number,
  ): Promise<void> {
    const isCurrent = (): boolean => generation === startedGeneration;
    const result = await args.authenticate(remoteServerUrl, isCurrent);
    if (!isCurrent()) {
      // The user left this server while the call ran. Scheduling again here
      // would resurrect a target they already dropped.
      return;
    }
    if (result.ok) {
      start({ expiresAt: result.expiresAt, remoteServerUrl });
      return;
    }
    args.log?.(
      `could not renew the bb Connect session: ${result.detail} — retrying`,
    );
    // Retry on the same cadence rather than giving up: the window still shows
    // the remote server, and the next attempt may find the gate reachable.
    start({ expiresAt: now() + leadMs, remoteServerUrl });
  }

  function renewNow(): Promise<void> {
    const remoteServerUrl = serverUrl;
    if (remoteServerUrl === null) {
      return Promise.resolve();
    }
    if (inFlight !== null) {
      return inFlight;
    }
    inFlight = runRenewal(remoteServerUrl, generation).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    renewIfDue(): void {
      if (expiresAt === null || expiresAt - now() > leadMs) {
        return;
      }
      void renewNow();
    },
    renewNow,
    start,
    stop: retire,
  };
}
