import type { ServerProfile } from "../profiles/profile";
import { refetchQueriesRejectedBeforeSession } from "../query/session-invalidation";
import type { AppStateLike } from "../realtime/app-state";
import type {
  ProfileClient,
  ProfileClientRegistry,
} from "../sdk/client-registry";
import { connectProfileClient } from "../sdk/connect-profile-client";
import { bindSessionToAppState } from "../session/app-state";
import type {
  SessionScheduler,
  SessionState,
} from "../session/session-scheduler";

/** The live wiring for the profile the user is currently looking at. */
export interface ActiveProfileConnection {
  profile: ServerProfile;
  client: ProfileClient;
  /**
   * Connect-mode session state. Direct profiles have no auth, so they stay
   * `{ status: "idle" }` and the realtime socket is opened immediately.
   */
  session: SessionState;
}

export interface ActiveProfileConnector {
  /**
   * Make `profile` the live one: tear the previous profile's socket/session
   * down, build (or reuse) the client, and bring realtime up. Re-activating
   * the same profile with unchanged connection fields is a no-op apart from
   * refreshing the stored profile record (label edits).
   */
  activate(profile: ServerProfile | null): void;
  getSnapshot(): ActiveProfileConnection | null;
  subscribe(listener: () => void): () => void;
}

export interface CreateActiveProfileConnectorDeps {
  registry: ProfileClientRegistry;
  appState: AppStateLike;
  /** Built once per connect-mode activation; direct profiles never call it. */
  createSessionScheduler: () => SessionScheduler;
}

const IDLE_SESSION: SessionState = { status: "idle" };

/**
 * A failed `/ws` attempt that does not name an auth status (gate or tunnel
 * down, no network) still gets the session re-checked, but no more often
 * than this: the socket backs off up to 30s, so at most one extra gate call
 * per backoff tick while offline. Auth-flavored failures are checked at once.
 */
export const CONNECT_FAILURE_VERIFY_INTERVAL_MS = 30_000;
/**
 * Requests that were already in flight when a session was (re)minted still
 * come back 401: within this window after a mint or verification the
 * failure is attributed to the stale cookie and only the rejected queries
 * are fetched again, instead of minting once more.
 */
export const AUTH_FAILURE_VERIFY_DEBOUNCE_MS = 2000;
/**
 * Delay before refetching after such an attributed failure: the 401 is
 * reported when the response arrives, before TanStack has marked the query
 * as errored, and one timer covers a burst of rejected requests.
 */
export const AUTH_FAILURE_REFETCH_DELAY_MS = 250;
/**
 * Re-mints tolerated in one streak before the connector stops minting: bb
 * connect accepts the machine credential and hands out a session, yet the
 * next requests come back 401/403 again (outside the debounce window). That
 * is a session the device cannot use — a clock so far ahead of the gate that
 * the cookie arrives already expired, a cookie jar that drops it, a label
 * since claimed by another account — and minting once more will not fix it.
 * A streak ends when the socket opens (the gate accepted the cookie) or when
 * no auth failure follows a mint for {@link AUTH_FAILURE_STREAK_WINDOW_MS}.
 */
export const AUTH_FAILURE_MAX_REMINTS = 3;
export const AUTH_FAILURE_STREAK_WINDOW_MS = 60_000;
/**
 * Once the streak is spent the session is reported as an `error` (the
 * banner shows it) and auth failures are ignored for this long; then one
 * verification is tried again, and a further failure trips the breaker at
 * once instead of starting a new streak.
 */
export const AUTH_FAILURE_BREAKER_COOLDOWN_MS = 60_000;
const AUTH_FAILURE_BREAKER_DETAIL =
  "The session was minted but the server keeps rejecting it; check the device clock or pair again";

/** Fields whose change requires rebuilding the socket/session. */
function connectionIdentity(profile: ServerProfile): string {
  return profile.mode === "connect"
    ? `${profile.id}\0${profile.serverUrl}\0${profile.credential}`
    : `${profile.id}\0${profile.serverUrl}`;
}

/**
 * Owns "which profile is live" for the app: one realtime socket, one connect
 * session (when applicable), bound to AppState. Connect profiles open the
 * socket only after the desktop-session cookie is installed (the gate refuses
 * `/ws` without it) and close it again if the credential is rejected, so a
 * revoked machine does not sit in a reconnect loop. A session the gate keeps
 * refusing although the credential is accepted is re-minted a bounded number
 * of times, then reported as an error (see {@link AUTH_FAILURE_MAX_REMINTS}).
 */
export function createActiveProfileConnector(
  deps: CreateActiveProfileConnectorDeps,
): ActiveProfileConnector {
  const listeners = new Set<() => void>();
  let snapshot: ActiveProfileConnection | null = null;
  let identity: string | null = null;
  let teardown: (() => void) | null = null;

  function setSnapshot(next: ActiveProfileConnection | null): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function teardownCurrent(): void {
    const current = teardown;
    teardown = null;
    identity = null;
    current?.();
  }

  function activateDirect(profile: ServerProfile, client: ProfileClient): void {
    const disconnectRealtime = connectProfileClient(client, deps.appState);
    teardown = disconnectRealtime;
    setSnapshot({ profile, client, session: IDLE_SESSION });
  }

  function activateConnect(
    profile: Extract<ServerProfile, { mode: "connect" }>,
    client: ProfileClient,
  ): void {
    const scheduler = deps.createSessionScheduler();
    let disconnectRealtime: (() => void) | null = null;
    // The moment the session was last minted or verified: auth failures
    // inside the debounce window after it are blamed on requests that
    // started with the previous cookie (see below).
    let lastVerifyAt = -Infinity;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    // Circuit breaker for the re-mint cycle (see AUTH_FAILURE_MAX_REMINTS):
    // re-mints in the current streak, and the retry while tripped.
    let remints = 0;
    let breaker: {
      retryAt: number;
      timer: ReturnType<typeof setTimeout>;
    } | null = null;
    const publishSession = (session: SessionState): void => {
      if (snapshot?.client !== client) return;
      setSnapshot({
        ...snapshot,
        session:
          breaker !== null && session.status === "authenticated"
            ? {
                status: "error",
                detail: AUTH_FAILURE_BREAKER_DETAIL,
                retryAt: breaker.retryAt,
              }
            : session,
      });
    };
    const resetBreaker = (): void => {
      if (breaker === null) return;
      clearTimeout(breaker.timer);
      breaker = null;
    };
    const unsubscribe = scheduler.onStateChange((session) => {
      if (session.status === "authenticated") {
        lastVerifyAt = Date.now();
        // Queries started before this cookie existed hit the gate's 401
        // page (the screen renders as soon as the profile is active, while
        // the first mint is still in flight); fetch them again now.
        refetchQueriesRejectedBeforeSession(client.queryClient);
        if (disconnectRealtime === null) {
          disconnectRealtime = connectProfileClient(client, deps.appState);
        }
      } else if (
        session.status === "auth-required" &&
        disconnectRealtime !== null
      ) {
        disconnectRealtime();
        disconnectRealtime = null;
      }
      publishSession(session);
    });
    const unbindAppState = bindSessionToAppState(scheduler, deps.appState);

    // The gate answered 401/403 (a query, or the `/ws` upgrade), or the
    // socket keeps failing for another reason: re-check the session. A fresh
    // cookie fixes a lost/expired one (then a socket waiting out its backoff
    // is reconnected at once); a refusal flips the profile to auth-required.
    let verifying = false;
    const verifySession = (): void => {
      if (verifying) return;
      verifying = true;
      lastVerifyAt = Date.now();
      void scheduler
        .verifySession()
        .then((session) => {
          if (session.status === "authenticated") {
            client.realtime.probeOrReconnect();
          }
        })
        .finally(() => {
          verifying = false;
        });
    };
    const refetchRejectedSoon = (): void => {
      if (refetchTimer !== null) return;
      refetchTimer = setTimeout(() => {
        refetchTimer = null;
        refetchQueriesRejectedBeforeSession(client.queryClient);
      }, AUTH_FAILURE_REFETCH_DELAY_MS);
    };
    const tripBreaker = (): void => {
      const retryAt = Date.now() + AUTH_FAILURE_BREAKER_COOLDOWN_MS;
      breaker = {
        retryAt,
        timer: setTimeout(() => {
          breaker = null;
          publishSession(scheduler.getState());
          verifySession();
        }, AUTH_FAILURE_BREAKER_COOLDOWN_MS),
      };
      publishSession(scheduler.getState());
    };
    const unsubscribeAuthFailure = client.onAuthFailure(() => {
      if (breaker !== null) return; // tripped: the cooldown timer retries
      const sinceVerify = Date.now() - lastVerifyAt;
      if (sinceVerify < AUTH_FAILURE_VERIFY_DEBOUNCE_MS) {
        // The cookie was just (re)installed: this request started without
        // it. Fetch the rejected queries again instead of minting again.
        refetchRejectedSoon();
        return;
      }
      if (verifying) return;
      if (sinceVerify >= AUTH_FAILURE_STREAK_WINDOW_MS) remints = 0;
      if (remints >= AUTH_FAILURE_MAX_REMINTS) {
        tripBreaker();
        return;
      }
      remints += 1;
      verifySession();
    });
    const unsubscribeConnected = client.realtime.onConnected(() => {
      // The gate accepted the cookie for `/ws`: the session works, so the
      // streak is over, and a tripped breaker has nothing left to wait for.
      remints = 0;
      if (breaker === null) return;
      resetBreaker();
      publishSession(scheduler.getState());
      refetchQueriesRejectedBeforeSession(client.queryClient);
    });
    const unsubscribeConnectFailed = client.realtime.onConnectFailed(
      (event) => {
        if (event.authRejected) return; // already handled via onAuthFailure
        if (client.realtime.isSuspended()) return;
        if (Date.now() - lastVerifyAt < CONNECT_FAILURE_VERIFY_INTERVAL_MS) {
          return;
        }
        verifySession();
      },
    );

    teardown = () => {
      unsubscribe();
      unbindAppState();
      unsubscribeAuthFailure();
      unsubscribeConnectFailed();
      unsubscribeConnected();
      if (refetchTimer !== null) {
        clearTimeout(refetchTimer);
        refetchTimer = null;
      }
      resetBreaker();
      disconnectRealtime?.();
      disconnectRealtime = null;
      scheduler.stop();
    };
    setSnapshot({ profile, client, session: scheduler.getState() });
    void scheduler.start(profile);
  }

  return {
    activate(profile) {
      if (profile === null) {
        teardownCurrent();
        setSnapshot(null);
        return;
      }
      const nextIdentity = connectionIdentity(profile);
      if (identity === nextIdentity && snapshot) {
        if (snapshot.profile !== profile) setSnapshot({ ...snapshot, profile });
        return;
      }
      teardownCurrent();
      identity = nextIdentity;
      const client = deps.registry.getClientForProfile(profile);
      if (profile.mode === "connect") {
        activateConnect(profile, client);
      } else {
        activateDirect(profile, client);
      }
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
