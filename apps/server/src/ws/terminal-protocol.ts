import {
  terminalClientMessageSchema,
  terminalServerMessageSchema,
} from "@bb/server-contract";
import {
  getTerminalWebsocketReauthorizePair,
  resolveTerminalWebsocketOpenAuthorization,
} from "../auth/terminal-websocket-authorization.js";
import { ApiError } from "../errors.js";
import type { ClientSocketSession } from "../request-context.js";
import type { AppDeps } from "../types.js";
import { decodeSocketPayload } from "./decode-payload.js";

type TerminalProtocolDeps = Pick<AppDeps, "terminalSessions" | "db">;

interface TerminalSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

/** Generic policy failure reason; never encodes terminal existence or role. */
export const TERMINAL_SOCKET_POLICY_CLOSE_REASON = "unauthorized";
export const TERMINAL_SOCKET_INVALID_MESSAGE_REASON = "invalid-message";

const DEFAULT_MEMBERSHIP_RECHECK_INTERVAL_MS = 10_000;
const MAX_MEMBERSHIP_RECHECK_INTERVAL_MS = 15_000;
// Leave headroom below the 15s revocation SLO when a 10s recheck begins but
// the policy backend does not answer (matches S2.1 client-socket budget).
const AUTHORIZATION_TIMEOUT_MS = 4_000;

type TimerHandle = ReturnType<typeof setTimeout>;

export type TerminalSocketClock = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

export type CreateTerminalSocketProtocolArgs = {
  readonly deps: TerminalProtocolDeps;
  /** Injected clock/timers for deterministic tests. Defaults to wall clock. */
  readonly clock?: Partial<TerminalSocketClock>;
  /**
   * Membership recheck interval for scoped terminal sockets. Production
   * default 10s; must be a positive integer no greater than 15_000.
   */
  readonly membershipRecheckIntervalMs?: number;
};

export type TerminalSocketProtocol = {
  /**
   * Bind one immutable client socket session and one path terminal id after
   * Origin validation. Scoped sockets authorize before attach; unrestricted
   * local-owner preserves stock attach/error behavior without timers.
   */
  open(
    socket: TerminalSocket,
    session: ClientSocketSession,
    terminalId: string,
  ): void;
  message(socket: TerminalSocket, raw: unknown): void;
  close(socket: TerminalSocket): void;
};

type SocketState = {
  active: boolean;
  readonly session: ClientSocketSession;
  readonly terminalId: string;
  attached: boolean;
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
      `terminal socket membershipRecheckIntervalMs must be an integer in 1..${MAX_MEMBERSHIP_RECHECK_INTERVAL_MS}`,
    );
  }
  return value;
}

function sendTerminalSocketError(args: {
  socket: TerminalSocket;
  code: string;
  message: string;
}): void {
  const payload = terminalServerMessageSchema.parse({
    type: "error",
    code: args.code,
    message: args.message,
  });
  args.socket.send(JSON.stringify(payload));
}

function closeTerminalSocketWithError(args: {
  socket: TerminalSocket;
  code: string;
  message: string;
}): void {
  try {
    sendTerminalSocketError(args);
  } catch {
    // Closing still wins if the error frame cannot be delivered.
  }
  try {
    args.socket.close(1008, args.code);
  } catch {
    // Socket may already be closed.
  }
}

/**
 * One manager per createApp for human browser terminal WebSockets. Captures
 * the upgrade-time principal session, authorizes scoped open before attach,
 * runs security deadlines independently of pending attach/daemon work, and
 * never re-resolves identity or retargets the path terminal id in-band.
 */
export function createTerminalSocketProtocol(
  args: CreateTerminalSocketProtocolArgs,
): TerminalSocketProtocol {
  const terminalSessions = args.deps.terminalSessions;
  const db = args.deps.db;
  const now = args.clock?.now ?? Date.now;
  const scheduleTimeout = args.clock?.setTimeout ?? setTimeout;
  const cancelTimeout = args.clock?.clearTimeout ?? clearTimeout;
  const membershipRecheckIntervalMs = readMembershipRecheckIntervalMs(
    args.membershipRecheckIntervalMs,
  );

  const states = new WeakMap<TerminalSocket, SocketState>();
  const boundSockets = new WeakSet<TerminalSocket>();
  const reauthorizePair = getTerminalWebsocketReauthorizePair();

  function detachIfAttached(state: SocketState, socket: TerminalSocket): void {
    if (!state.attached) {
      return;
    }
    state.attached = false;
    try {
      terminalSessions.detachBrowserTerminal({
        socket,
        terminalId: state.terminalId,
      });
    } catch {
      // Cleanup is best-effort once the socket is inactive.
    }
  }

  function releaseSocketState(
    state: SocketState,
    socket: TerminalSocket,
  ): void {
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
    detachIfAttached(state, socket);
  }

  function closeForPolicy(socket: TerminalSocket, state: SocketState): void {
    releaseSocketState(state, socket);
    try {
      socket.close(1008, TERMINAL_SOCKET_POLICY_CLOSE_REASON);
    } catch {
      // Socket may already be closed.
    }
  }

  function closeForInvalidMessage(
    socket: TerminalSocket,
    state: SocketState,
  ): void {
    releaseSocketState(state, socket);
    try {
      socket.close(1008, TERMINAL_SOCKET_INVALID_MESSAGE_REASON);
    } catch {
      // Socket may already be closed.
    }
  }

  function enqueue(
    socket: TerminalSocket,
    state: SocketState,
    operation: () => Promise<void> | void,
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

  function scheduleExpiry(socket: TerminalSocket, state: SocketState): void {
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
      // hung open authorization or pending attach.
      if (state.active && isExpired(state.session, now())) {
        closeForPolicy(socket, state);
      } else if (state.active) {
        scheduleExpiry(socket, state);
      }
    }, delayMs);
    unrefTimer(state.expiryTimer);
  }

  function scheduleRecheck(socket: TerminalSocket, state: SocketState): void {
    if (!state.active || state.session.clientRealtimeScope !== "scoped") {
      return;
    }
    if (state.recheckTimer !== null) {
      cancelTimeout(state.recheckTimer);
      state.recheckTimer = null;
    }
    state.recheckTimer = scheduleTimeout(() => {
      state.recheckTimer = null;
      // Rechecks run independently of open/authorize and daemon attach work.
      void runRecheck(socket, state);
    }, membershipRecheckIntervalMs);
    unrefTimer(state.recheckTimer);
  }

  async function runRecheck(
    socket: TerminalSocket,
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

  function attachStock(socket: TerminalSocket, state: SocketState): void {
    // Mark before calling the lifecycle so any partial register/send failure
    // is guaranteed to run detach cleanup.
    state.attached = true;
    try {
      terminalSessions.attachBrowserTerminal({
        socket,
        terminalId: state.terminalId,
        threadId: null,
      });
      if (!state.active) {
        // Close won the race after attach began: detach so daemon delivery
        // cannot continue for an inactive socket.
        try {
          terminalSessions.detachBrowserTerminal({
            socket,
            terminalId: state.terminalId,
          });
        } catch {
          // best-effort
        }
        return;
      }
    } catch (error) {
      if (!state.active) {
        return;
      }
      releaseSocketState(state, socket);
      if (error instanceof ApiError) {
        closeTerminalSocketWithError({
          socket,
          code: error.body.code,
          message: error.body.message,
        });
        return;
      }
      closeTerminalSocketWithError({
        socket,
        code: "terminal_socket_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function openScoped(
    socket: TerminalSocket,
    state: SocketState,
    terminalId: string,
  ): Promise<void> {
    if (!state.active) {
      return;
    }
    if (isExpired(state.session, now())) {
      closeForPolicy(socket, state);
      return;
    }

    const resolved = resolveTerminalWebsocketOpenAuthorization(db, terminalId);
    if (resolved.kind === "denied") {
      closeForPolicy(socket, state);
      return;
    }

    const allowed = await authorizeWithDeadline(
      state,
      resolved.action,
      resolved.resource,
    );

    // Recheck active + exact expiry before attach. An in-flight authorize
    // cannot attach after close, expiry, or policy denial.
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

    // The eligibility lookup is DB-derived authority. Re-read immediately
    // before the synchronous attach so a deleted/replaced terminal cannot use
    // an authorization issued for stale lineage.
    if (
      resolveTerminalWebsocketOpenAuthorization(db, terminalId).kind ===
      "denied"
    ) {
      closeForPolicy(socket, state);
      return;
    }

    attachStock(socket, state);
  }

  function handleParsedMessage(
    socket: TerminalSocket,
    state: SocketState,
    message: Parameters<
      typeof terminalSessions.handleBrowserTerminalMessage
    >[0]["message"],
  ): void {
    if (!state.attached) {
      closeForPolicy(socket, state);
      return;
    }
    try {
      terminalSessions.handleBrowserTerminalMessage({
        message,
        socket,
        terminalId: state.terminalId,
        threadId: null,
      });
    } catch (error) {
      if (!state.active) {
        return;
      }
      // Remove terminal delivery before attempting an error frame/close.
      releaseSocketState(state, socket);
      if (error instanceof ApiError) {
        closeTerminalSocketWithError({
          socket,
          code: error.body.code,
          message: error.body.message,
        });
        return;
      }
      closeTerminalSocketWithError({
        socket,
        code: "terminal_socket_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    open(socket, session, terminalId): void {
      if (boundSockets.has(socket)) {
        // One immutable binding per socket; refuse reuse.
        const existing = states.get(socket);
        if (existing !== undefined) {
          closeForPolicy(socket, existing);
        } else {
          try {
            socket.close(1008, TERMINAL_SOCKET_POLICY_CLOSE_REASON);
          } catch {
            // Socket may already be closed.
          }
        }
        return;
      }
      boundSockets.add(socket);

      const state: SocketState = {
        active: true,
        session,
        terminalId,
        attached: false,
        cancelPendingAuthorizations: new Set(),
        queue: Promise.resolve(),
        expiryTimer: null,
        recheckInFlight: false,
        recheckTimer: null,
      };
      states.set(socket, state);

      // Unrestricted local-owner: stock attach/error, no timers, no registry
      // gate. Still binds one upgrade-time session and path terminal forever.
      if (session.clientRealtimeScope === "unrestricted") {
        attachStock(socket, state);
        return;
      }

      if (
        session.expiresAtMs === null ||
        !Number.isSafeInteger(session.expiresAtMs) ||
        session.expiresAtMs <= now()
      ) {
        closeForPolicy(socket, state);
        return;
      }

      scheduleExpiry(socket, state);
      if (state.active) {
        scheduleRecheck(socket, state);
      }
      if (!state.active) {
        return;
      }

      // Authorize before attach; do not block security timers on this work.
      enqueue(socket, state, async () => {
        await openScoped(socket, state, terminalId);
      });
    },

    message(socket, raw): void {
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

      const result = terminalClientMessageSchema.safeParse(decoded);
      if (!result.success) {
        closeForInvalidMessage(socket, state);
        return;
      }

      // Valid early messages wait behind scoped open authorization. Security
      // expiry/recheck timers remain independent of this queue.
      enqueue(socket, state, () => {
        handleParsedMessage(socket, state, result.data);
      });
    },

    close(socket): void {
      const state = states.get(socket);
      if (state === undefined) {
        // A socket that never bound could never attach.
        return;
      }
      // Mark inactive immediately so in-flight authorize cannot attach and
      // later daemon delivery is cancelled via detach.
      releaseSocketState(state, socket);
      states.delete(socket);
    },
  };
}
