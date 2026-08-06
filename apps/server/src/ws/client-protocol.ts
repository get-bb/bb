import {
  clientMessageSchema,
  realtimeSubscriptionTargetKey,
  type RealtimeSubscriptionTarget,
} from "@bb/domain";
import type { DbConnection } from "@bb/db";
import {
  getClientWebsocketReauthorizePair,
  resolveClientWebsocketSubscribeAuthorization,
} from "../auth/client-websocket-authorization.js";
import type { ClientSocketSession } from "../request-context.js";
import { decodeSocketPayload } from "./decode-payload.js";
import type { ClientDeliveryMode, NotificationHub } from "./hub.js";
import type { WatchInterestCoordinator } from "./watch-interests.js";

interface ClientSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

/** Generic policy failure reason; never encodes target existence or role. */
export const CLIENT_SOCKET_POLICY_CLOSE_REASON = "unauthorized";
export const CLIENT_SOCKET_INVALID_MESSAGE_REASON = "invalid-message";

const DEFAULT_MEMBERSHIP_RECHECK_INTERVAL_MS = 10_000;
const MAX_MEMBERSHIP_RECHECK_INTERVAL_MS = 15_000;
// Leave headroom below the 15s revocation SLO when a 10s recheck begins but
// the policy backend does not answer.
const AUTHORIZATION_TIMEOUT_MS = 4_000;

type TimerHandle = ReturnType<typeof setTimeout>;

export type ClientSocketClock = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

export type CreateClientSocketProtocolArgs = {
  readonly hub: NotificationHub;
  readonly watchInterests: Pick<
    WatchInterestCoordinator,
    "subscribe" | "unsubscribe" | "releaseSocket"
  >;
  readonly db: DbConnection;
  /** Injected clock/timers for deterministic tests. Defaults to wall clock. */
  readonly clock?: Partial<ClientSocketClock>;
  /**
   * Membership recheck interval for scoped sockets. Production default 10s;
   * must be a positive integer no greater than 15_000.
   */
  readonly membershipRecheckIntervalMs?: number;
};

export type ClientSocketProtocol = {
  /**
   * Bind one immutable client socket session captured at `/ws` upgrade and
   * register the socket with hub delivery mode from policy metadata.
   */
  open(socket: ClientSocket, session: ClientSocketSession): void;
  message(socket: ClientSocket, raw: unknown): void;
  close(socket: ClientSocket): void;
};

type SocketState = {
  active: boolean;
  readonly session: ClientSocketSession;
  readonly authorizedTargets: Map<string, RealtimeSubscriptionTarget>;
  readonly cancelPendingAuthorizations: Set<() => void>;
  queue: Promise<void>;
  expiryTimer: TimerHandle | null;
  recheckInFlight: boolean;
  recheckTimer: TimerHandle | null;
};

function unrefTimer(handle: TimerHandle): void {
  if (
    typeof handle === "object" &&
    handle !== null &&
    "unref" in handle &&
    typeof (handle as { unref?: unknown }).unref === "function"
  ) {
    (handle as { unref: () => void }).unref();
  }
}

function readMembershipRecheckIntervalMs(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_MEMBERSHIP_RECHECK_INTERVAL_MS;
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_MEMBERSHIP_RECHECK_INTERVAL_MS
  ) {
    throw new Error(
      `client socket membershipRecheckIntervalMs must be an integer in 1..${MAX_MEMBERSHIP_RECHECK_INTERVAL_MS}`,
    );
  }
  return value;
}

/**
 * One manager per createApp. Binds immutable principal sessions at upgrade,
 * serializes client messages per socket while security deadlines/rechecks run
 * independently, and never re-resolves identity from in-band messages.
 */
export function createClientSocketProtocol(
  args: CreateClientSocketProtocolArgs,
): ClientSocketProtocol {
  const hub = args.hub;
  const watchInterests = args.watchInterests;
  const db = args.db;
  const now = args.clock?.now ?? Date.now;
  const scheduleTimeout = args.clock?.setTimeout ?? setTimeout;
  const cancelTimeout = args.clock?.clearTimeout ?? clearTimeout;
  const membershipRecheckIntervalMs = readMembershipRecheckIntervalMs(
    args.membershipRecheckIntervalMs,
  );

  const states = new WeakMap<ClientSocket, SocketState>();
  const boundSockets = new WeakSet<ClientSocket>();
  const reauthorizePair = getClientWebsocketReauthorizePair();

  function releaseSocketState(state: SocketState, socket: ClientSocket): void {
    if (!state.active) {
      return;
    }
    state.active = false;
    if (state.expiryTimer !== null) {
      cancelTimeout(state.expiryTimer);
      state.expiryTimer = null;
    }
    if (state.recheckTimer !== null) {
      cancelTimeout(state.recheckTimer);
      state.recheckTimer = null;
    }
    for (const cancel of [...state.cancelPendingAuthorizations]) {
      cancel();
    }
    state.authorizedTargets.clear();
    try {
      watchInterests.releaseSocket(socket);
    } catch {
      // Cleanup is best-effort, but hub delivery must always be removed.
    }
    try {
      hub.unregisterClient(socket);
    } catch {
      // The socket is already inactive even if an injected dependency fails.
    }
  }

  function closeForPolicy(socket: ClientSocket, state: SocketState): void {
    releaseSocketState(state, socket);
    try {
      socket.close(1008, CLIENT_SOCKET_POLICY_CLOSE_REASON);
    } catch {
      // Socket may already be closed.
    }
  }

  function closeForInvalidMessage(
    socket: ClientSocket,
    state: SocketState,
  ): void {
    releaseSocketState(state, socket);
    try {
      socket.close(1008, CLIENT_SOCKET_INVALID_MESSAGE_REASON);
    } catch {
      // Socket may already be closed.
    }
  }

  function enqueue(
    socket: ClientSocket,
    state: SocketState,
    operation: () => Promise<void>,
  ): void {
    state.queue = state.queue
      .then(async () => {
        if (!state.active) {
          return;
        }
        await operation();
      })
      .catch(() => {
        if (state.active) {
          closeForPolicy(socket, state);
        }
      });
  }

  function authorizeWithDeadline(
    state: SocketState,
    action: Parameters<ClientSocketSession["authorize"]>[0],
    resource: Parameters<ClientSocketSession["authorize"]>[1],
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timeout: TimerHandle | null = null;

      const finish = (allowed: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout !== null) {
          cancelTimeout(timeout);
          timeout = null;
        }
        state.cancelPendingAuthorizations.delete(cancel);
        resolve(allowed);
      };
      const cancel = (): void => finish(false);

      state.cancelPendingAuthorizations.add(cancel);
      timeout = scheduleTimeout(() => finish(false), AUTHORIZATION_TIMEOUT_MS);
      unrefTimer(timeout);

      void Promise.resolve()
        .then(() => state.session.authorize(action, resource))
        .then(
          (decision) => {
            try {
              finish(decision.allowed === true);
            } catch {
              finish(false);
            }
          },
          () => finish(false),
        );
    });
  }

  function isExpired(session: ClientSocketSession, atMs: number): boolean {
    return session.expiresAtMs !== null && session.expiresAtMs <= atMs;
  }

  function scheduleExpiry(socket: ClientSocket, state: SocketState): void {
    const expiresAtMs = state.session.expiresAtMs;
    if (expiresAtMs === null) {
      return;
    }
    const delayMs = expiresAtMs - now();
    if (delayMs <= 0) {
      closeForPolicy(socket, state);
      return;
    }
    if (state.expiryTimer !== null) {
      cancelTimeout(state.expiryTimer);
    }
    state.expiryTimer = scheduleTimeout(() => {
      state.expiryTimer = null;
      // Expiry is an independent security deadline. Never queue it behind a
      // hung subscribe or reauthorization call.
      if (state.active && isExpired(state.session, now())) {
        closeForPolicy(socket, state);
      } else if (state.active) {
        // Defensive against an injected/non-monotonic clock or an early timer.
        scheduleExpiry(socket, state);
      }
    }, delayMs);
    unrefTimer(state.expiryTimer);
  }

  function scheduleRecheck(socket: ClientSocket, state: SocketState): void {
    if (!state.active || state.session.clientRealtimeScope !== "scoped") {
      return;
    }
    if (state.recheckTimer !== null) {
      cancelTimeout(state.recheckTimer);
      state.recheckTimer = null;
    }
    state.recheckTimer = scheduleTimeout(() => {
      state.recheckTimer = null;
      // Rechecks run independently of the client-message queue so a hung
      // subscribe cannot postpone membership revocation.
      void runRecheck(socket, state);
    }, membershipRecheckIntervalMs);
    unrefTimer(state.recheckTimer);
  }

  async function runRecheck(
    socket: ClientSocket,
    state: SocketState,
  ): Promise<void> {
    if (!state.active || state.recheckInFlight) {
      return;
    }
    state.recheckInFlight = true;
    try {
      if (isExpired(state.session, now())) {
        closeForPolicy(socket, state);
        return;
      }
      const allowed = await authorizeWithDeadline(
        state,
        reauthorizePair.action,
        reauthorizePair.resource,
      );
      if (!state.active) {
        return;
      }
      if (isExpired(state.session, now()) || !allowed) {
        closeForPolicy(socket, state);
      }
    } finally {
      state.recheckInFlight = false;
      if (state.active) {
        scheduleRecheck(socket, state);
      }
    }
  }

  async function handleSubscribe(
    socket: ClientSocket,
    state: SocketState,
    target: RealtimeSubscriptionTarget,
  ): Promise<void> {
    if (!state.active) {
      return;
    }
    if (isExpired(state.session, now())) {
      closeForPolicy(socket, state);
      return;
    }

    const key = realtimeSubscriptionTargetKey(target);
    // Duplicate subscribe is idempotent before authorize/register.
    if (state.authorizedTargets.has(key)) {
      return;
    }

    // Unrestricted local-owner: allow-all, no registry gate, no timers. Still
    // binds one upgrade-time session and never re-resolves identity in-band.
    if (state.session.clientRealtimeScope === "unrestricted") {
      if (!state.active) {
        return;
      }
      hub.subscribe(socket, target);
      try {
        watchInterests.subscribe(socket, target);
      } catch (error) {
        hub.unsubscribe(socket, target);
        throw error;
      }
      state.authorizedTargets.set(key, target);
      return;
    }

    const resolved = resolveClientWebsocketSubscribeAuthorization(db, target);
    if (resolved.kind === "denied") {
      closeForPolicy(socket, state);
      return;
    }

    const allowed = await authorizeWithDeadline(
      state,
      resolved.action,
      resolved.resource,
    );

    // Recheck active + exact expiry before hub/watch registration. An
    // in-flight authorize cannot register after close.
    if (!state.active) {
      return;
    }
    if (isExpired(state.session, now())) {
      closeForPolicy(socket, state);
      return;
    }
    if (!allowed) {
      closeForPolicy(socket, state);
      return;
    }
    if (state.authorizedTargets.has(key)) {
      return;
    }

    hub.subscribe(socket, resolved.target);
    try {
      watchInterests.subscribe(socket, resolved.target);
    } catch (error) {
      hub.unsubscribe(socket, resolved.target);
      throw error;
    }
    state.authorizedTargets.set(key, resolved.target);
  }

  function handleUnsubscribe(
    socket: ClientSocket,
    state: SocketState,
    target: RealtimeSubscriptionTarget,
  ): void {
    if (!state.active) {
      return;
    }
    const key = realtimeSubscriptionTargetKey(target);
    if (!state.authorizedTargets.has(key)) {
      // Unknown/forged unsubscribe is a no-op and never authorizes/adds.
      return;
    }
    state.authorizedTargets.delete(key);
    hub.unsubscribe(socket, target);
    watchInterests.unsubscribe(socket, target);
  }

  return {
    open(socket: ClientSocket, session: ClientSocketSession): void {
      if (boundSockets.has(socket)) {
        // One immutable binding per socket; refuse reuse.
        const existing = states.get(socket);
        if (existing !== undefined) {
          closeForPolicy(socket, existing);
        } else {
          try {
            socket.close(1008, CLIENT_SOCKET_POLICY_CLOSE_REASON);
          } catch {
            // Socket may already be closed.
          }
        }
        return;
      }
      boundSockets.add(socket);

      const deliveryMode: ClientDeliveryMode = session.clientRealtimeScope;
      const state: SocketState = {
        active: true,
        session,
        authorizedTargets: new Map(),
        cancelPendingAuthorizations: new Set(),
        queue: Promise.resolve(),
        expiryTimer: null,
        recheckInFlight: false,
        recheckTimer: null,
      };
      states.set(socket, state);

      if (session.clientRealtimeScope === "scoped") {
        if (
          session.expiresAtMs === null ||
          !Number.isSafeInteger(session.expiresAtMs) ||
          session.expiresAtMs <= now()
        ) {
          closeForPolicy(socket, state);
          return;
        }
      }

      // Register with hub using policy delivery mode before any message work.
      try {
        hub.registerClient(socket, deliveryMode);
      } catch {
        closeForPolicy(socket, state);
        return;
      }

      if (session.clientRealtimeScope === "scoped") {
        scheduleExpiry(socket, state);
        if (state.active) {
          scheduleRecheck(socket, state);
        }
      }
    },

    message(socket: ClientSocket, raw: unknown): void {
      const state = states.get(socket);
      if (state === undefined || !state.active) {
        return;
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(decodeSocketPayload(raw));
      } catch {
        closeForInvalidMessage(socket, state);
        return;
      }

      const result = clientMessageSchema.safeParse(decoded);
      if (!result.success) {
        closeForInvalidMessage(socket, state);
        return;
      }
      const parsed = result.data;

      switch (parsed.type) {
        case "subscribe":
          enqueue(socket, state, async () => {
            await handleSubscribe(socket, state, parsed.target);
          });
          break;
        case "unsubscribe":
          enqueue(socket, state, async () => {
            handleUnsubscribe(socket, state, parsed.target);
          });
          break;
        default: {
          const _exhaustive: never = parsed;
          throw new Error(`Unhandled client message: ${_exhaustive}`);
        }
      }
    },

    close(socket: ClientSocket): void {
      const state = states.get(socket);
      if (state === undefined) {
        watchInterests.releaseSocket(socket);
        hub.unregisterClient(socket);
        return;
      }
      // Mark inactive immediately so in-flight authorize cannot register.
      releaseSocketState(state, socket);
      states.delete(socket);
    },
  };
}
