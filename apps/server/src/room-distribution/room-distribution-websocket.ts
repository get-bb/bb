import type { ClientSocketSession } from "../request-context.js";
import { issueRoomDistributionAuthorization } from "../auth/room-distribution-authorization.js";
import type {
  RoomDistributionContextV1,
  RoomDistributionSubscriptionV1,
  WorkTogetherRoomDistributionV1,
} from "./room-distribution-port.js";

interface RoomDistributionSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export type RoomDistributionSocketClock = {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
};

export type RoomDistributionSocketProtocol = {
  open(
    socket: RoomDistributionSocket,
    session: ClientSocketSession,
    bindingId: string,
    cursor: string | null,
    childAttachmentId: string | null,
  ): void;
  message(socket: RoomDistributionSocket): void;
  close(socket: RoomDistributionSocket): void;
};

export const ROOM_DISTRIBUTION_POLICY_CLOSE_REASON = "unauthorized";
export const ROOM_DISTRIBUTION_MESSAGE_CLOSE_REASON = "invalid-message";

const DEFAULT_RECHECK_INTERVAL_MS = 10_000;
const MAX_RECHECK_INTERVAL_MS = 15_000;
const AUTHORIZATION_TIMEOUT_MS = 4_000;

type SocketState = {
  active: boolean;
  readonly context: RoomDistributionContextV1;
  expiryTimer: TimerHandle | null;
  recheckTimer: TimerHandle | null;
  subscription: RoomDistributionSubscriptionV1 | null;
};

function unrefTimer(handle: TimerHandle): void {
  if (
    typeof handle === "object" &&
    handle !== null &&
    "unref" in handle &&
    typeof (handle as { unref?: unknown }).unref === "function"
  ) {
    (handle as { unref(): void }).unref();
  }
}

function resolveRecheckInterval(value: unknown): number {
  if (value === undefined) return DEFAULT_RECHECK_INTERVAL_MS;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_RECHECK_INTERVAL_MS
  ) {
    throw new Error(
      `Room distribution recheck interval must be in 1..${MAX_RECHECK_INTERVAL_MS}`,
    );
  }
  return value;
}

/**
 * Bind each Room stream to one immutable Principal and binding path. The only
 * accepted client message is no message: all retargeting is transport-level
 * invalid and closes the socket.
 */
export function createRoomDistributionSocketProtocol(args: {
  readonly distribution: WorkTogetherRoomDistributionV1;
  readonly clock?: Partial<RoomDistributionSocketClock>;
  readonly membershipRecheckIntervalMs?: number;
}): RoomDistributionSocketProtocol {
  const now = args.clock?.now ?? Date.now;
  const scheduleTimeout = args.clock?.setTimeout ?? setTimeout;
  const cancelTimeout = args.clock?.clearTimeout ?? clearTimeout;
  const recheckIntervalMs = resolveRecheckInterval(
    args.membershipRecheckIntervalMs,
  );
  const states = new WeakMap<RoomDistributionSocket, SocketState>();
  const bound = new WeakSet<RoomDistributionSocket>();

  function release(state: SocketState): void {
    if (!state.active) return;
    state.active = false;
    if (state.expiryTimer !== null) cancelTimeout(state.expiryTimer);
    if (state.recheckTimer !== null) cancelTimeout(state.recheckTimer);
    state.expiryTimer = null;
    state.recheckTimer = null;
    try {
      state.subscription?.close();
    } catch {
      // Cleanup is best-effort after the stream loses authority.
    }
    state.subscription = null;
  }

  function closeWith(
    socket: RoomDistributionSocket,
    state: SocketState,
    reason: string,
  ): void {
    release(state);
    try {
      socket.close(1008, reason);
    } catch {
      // Socket may already be closed.
    }
  }

  async function authorizeWithDeadline(
    state: SocketState,
    operation: "subscribe" | "reauthorize",
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timeout: TimerHandle | null = null;
      const finish = (allowed: boolean): void => {
        if (settled) return;
        settled = true;
        if (timeout !== null) cancelTimeout(timeout);
        resolve(allowed);
      };
      timeout = scheduleTimeout(() => finish(false), AUTHORIZATION_TIMEOUT_MS);
      unrefTimer(timeout);
      void state.context.authorize(operation).then(
        (decision) => finish(decision.allowed),
        () => finish(false),
      );
    });
  }

  function scheduleRecheck(
    socket: RoomDistributionSocket,
    state: SocketState,
  ): void {
    if (!state.active) return;
    state.recheckTimer = scheduleTimeout(() => {
      state.recheckTimer = null;
      void (async () => {
        if (!state.active) return;
        if (!(await authorizeWithDeadline(state, "reauthorize"))) {
          closeWith(socket, state, ROOM_DISTRIBUTION_POLICY_CLOSE_REASON);
          return;
        }
        scheduleRecheck(socket, state);
      })();
    }, recheckIntervalMs);
    unrefTimer(state.recheckTimer);
  }

  return Object.freeze({
    open(socket, session, bindingId, cursor, childAttachmentId): void {
      if (bound.has(socket)) {
        const existing = states.get(socket);
        if (existing) release(existing);
        try {
          socket.close(1008, ROOM_DISTRIBUTION_POLICY_CLOSE_REASON);
        } catch {
          // Socket may already be closed.
        }
        return;
      }
      bound.add(socket);

      const context: RoomDistributionContextV1 = Object.freeze({
        bindingId,
        principal: session.principal,
        authorize: async (operation) => {
          const pair = issueRoomDistributionAuthorization({
            bindingId,
            operation,
          });
          return session.authorize(pair.action, pair.resource);
        },
      });
      const state: SocketState = {
        active: true,
        context,
        expiryTimer: null,
        recheckTimer: null,
        subscription: null,
      };
      states.set(socket, state);

      if (
        session.clientRealtimeScope !== "scoped" ||
        session.expiresAtMs === null ||
        session.expiresAtMs <= now()
      ) {
        closeWith(socket, state, ROOM_DISTRIBUTION_POLICY_CLOSE_REASON);
        return;
      }
      state.expiryTimer = scheduleTimeout(() => {
        state.expiryTimer = null;
        closeWith(socket, state, ROOM_DISTRIBUTION_POLICY_CLOSE_REASON);
      }, session.expiresAtMs - now());
      unrefTimer(state.expiryTimer);

      void (async () => {
        if (!(await authorizeWithDeadline(state, "subscribe"))) {
          closeWith(socket, state, ROOM_DISTRIBUTION_POLICY_CLOSE_REASON);
          return;
        }
        if (!state.active) return;
        scheduleRecheck(socket, state);
        let subscription: RoomDistributionSubscriptionV1;
        try {
          subscription = await args.distribution.subscribe(
            context,
            { childAttachmentId, cursor },
            (event) => {
              if (!state.active) return;
              try {
                socket.send(JSON.stringify(event));
              } catch {
                closeWith(socket, state, ROOM_DISTRIBUTION_POLICY_CLOSE_REASON);
              }
            },
          );
        } catch {
          closeWith(socket, state, ROOM_DISTRIBUTION_POLICY_CLOSE_REASON);
          return;
        }
        if (!state.active) {
          subscription.close();
          return;
        }
        state.subscription = subscription;
      })();
    },

    message(socket): void {
      const state = states.get(socket);
      if (state?.active) {
        closeWith(socket, state, ROOM_DISTRIBUTION_MESSAGE_CLOSE_REASON);
      }
    },

    close(socket): void {
      const state = states.get(socket);
      if (state) release(state);
    },
  });
}
