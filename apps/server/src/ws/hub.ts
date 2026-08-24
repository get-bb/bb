import { Buffer } from "node:buffer";
import {
  realtimeSubscriptionTargetKey as subscriptionKey,
  type RealtimeSubscriptionTarget,
  type ChangedMessage,
  type EnvironmentChangeKind,
  type HostChangeKind,
  type ProjectChangeKind,
  type SystemChangeKind,
  type ThreadChangeKind,
  type ThreadChangeMetadata,
  type ThreadEventType,
} from "@bb/domain";
import type { DbNotifier } from "@bb/db";
import type {
  HostPlatform,
  HostDaemonOnlineRpcRequestMessage,
  HostDaemonOnlineRpcResponseMessage,
  HostDaemonServerWsMessage,
  HostDaemonSessionCloseReason,
} from "@bb/host-daemon-contract";
import {
  pluginSignalSchema,
  serverMessageSchema,
  terminalServerMessageSchema,
  threadOpenSignalSchema,
  threadPaneActionSignalSchema,
  type ThreadPaneAction,
  type ThreadOpenFile,
  type ThreadOpenSplit,
  type TerminalServerMessage,
} from "@bb/server-contract";

const TERMINAL_SOCKET_HIGH_WATER_BYTES = 1024 * 1024;
// A 16 MiB raw burst expands to about 21.4 MiB as base64 + JSON. Keep
// enough bounded headroom for that workload while preventing unbounded growth.
const TERMINAL_SOCKET_MAX_QUEUE_BYTES = 32 * 1024 * 1024;
// App realtime messages are small invalidation hints and ephemeral signals; a
// socket that cannot flush 1 MiB of them is wedged (a suspended phone, a dead
// network), and letting its buffers grow just leaks server memory. Queue a
// short burst, then drop the socket: clients reconnect and catch up via the
// watermark.
const APP_SOCKET_HIGH_WATER_BYTES = 1024 * 1024;
const APP_SOCKET_MAX_QUEUE_BYTES = 4 * 1024 * 1024;
const SOCKET_DRAIN_POLL_MS = 10;
/**
 * A streaming turn appends events ~10 times a second. A client that only
 * subscribes to the thread list (every open app window, for every thread it
 * is not viewing) uses `events-appended` for nothing more than a stale mark
 * on cached timeline/search queries, so it gets the first notification at
 * once and then at most one coalesced notification per window per thread.
 * Detail subscribers keep receiving every notification.
 */
const THREAD_LIST_EVENTS_APPENDED_COALESCE_MS = 1_000;
/**
 * Event types the thread-list client path reacts to individually (prompt
 * history recall, pull-request refresh), so they bypass coalescing.
 */
const LIST_RELEVANT_THREAD_EVENT_TYPES: ReadonlySet<ThreadEventType> =
  new Set<ThreadEventType>(["client/turn/requested", "turn/completed"]);

/**
 * The plugin-signal envelope minus the payload: `notifyPluginSignal` embeds
 * the publish site's already-serialized payload verbatim, so only the fields
 * it splices into the frame go through the outgoing schema.
 */
const pluginSignalEnvelopeSchema = pluginSignalSchema.omit({ payload: true });

interface HubSocket {
  close(code?: number, reason?: string): void;
  raw?: { bufferedAmount: number };
  send(data: string): void;
}

interface SocketSendQueue {
  bytes: number;
  payloads: string[];
  timeout: ReturnType<typeof setTimeout> | null;
}

/**
 * One backpressured send path. The hub runs two: the terminal lane (large
 * ordered output bursts, generous queue) and the app lane (small realtime
 * notifications, tight queue). Both share the same mechanics — send directly
 * below the socket high water, queue and poll-drain above it, and hand the
 * socket to `drop` when a send throws or the queue budget overflows.
 */
interface SocketSendLane {
  drop: (socket: HubSocket, reason: string) => void;
  dropReasons: { queueOverflow: string; sendFailed: string };
  highWaterBytes: number;
  maxQueueBytes: number;
  queues: Map<HubSocket, SocketSendQueue>;
}

type ChangedMessageListener = (message: ChangedMessage) => void;

interface PendingThreadListEventsAppended {
  eventTypes: Set<ThreadEventType>;
  merged: boolean;
  timeout: ReturnType<typeof setTimeout>;
}

type ThreadChangedMessage = Extract<ChangedMessage, { entity: "thread" }>;

/**
 * True when thread-list subscribers need the change now: any change kind
 * other than `events-appended`, or metadata the list path reads directly.
 */
function isThreadListRelevantChange(
  message: Pick<ThreadChangedMessage, "changes" | "metadata">,
): boolean {
  if (message.changes.some((change) => change !== "events-appended")) {
    return true;
  }
  const metadata = message.metadata;
  if (metadata === undefined) {
    return false;
  }
  return (
    metadata.backgroundActivityChanged === true ||
    metadata.hasPendingInteraction !== undefined ||
    metadata.projectId !== undefined ||
    (metadata.eventTypes?.some((eventType) =>
      LIST_RELEVANT_THREAD_EVENT_TYPES.has(eventType),
    ) ??
      false)
  );
}

function subscriptionKeysForMessage(message: ChangedMessage): string[] {
  switch (message.entity) {
    case "thread":
      return message.id
        ? [
            subscriptionKey({ kind: "thread-list" }),
            subscriptionKey({ kind: "thread-detail", threadId: message.id }),
          ]
        : [subscriptionKey({ kind: "thread-list" })];
    case "project":
      return message.id
        ? [
            subscriptionKey({ kind: "project-list" }),
            subscriptionKey({ kind: "project-detail", projectId: message.id }),
          ]
        : [subscriptionKey({ kind: "project-list" })];
    case "environment":
      return message.id
        ? [
            subscriptionKey({ kind: "environment-list" }),
            subscriptionKey({
              kind: "environment-detail",
              environmentId: message.id,
            }),
          ]
        : [subscriptionKey({ kind: "environment-list" })];
    case "host":
      return message.id
        ? [
            subscriptionKey({ kind: "host-list" }),
            subscriptionKey({ kind: "host-detail", hostId: message.id }),
          ]
        : [subscriptionKey({ kind: "host-list" })];
    case "system":
      return [subscriptionKey({ kind: "system" })];
  }
}

interface ThreadEventWaiter {
  resolve: (notified: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface DaemonRegistrationWaiter {
  resolve: (registered: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface HostOnlineRpcWaiter {
  reject: (reason?: Error) => void;
  resolve: (message: HostDaemonOnlineRpcResponseMessage) => void;
  sessionId: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface RecordHostOnlineRpcResponseArgs {
  message: HostDaemonOnlineRpcResponseMessage;
  sessionId: string;
}

type HostOnlineRpcResponseDisposition =
  | { handled: true }
  | { handled: false; reason: "stale" }
  | {
      expectedSessionId: string;
      handled: false;
      reason: "session_mismatch";
    };

export class HostOnlineRpcTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for host RPC response");
    this.name = "HostOnlineRpcTimeoutError";
  }
}

export class HostOnlineRpcUnavailableError extends Error {
  constructor() {
    super("Host daemon is not connected");
    this.name = "HostOnlineRpcUnavailableError";
  }
}

export class NotificationHub implements DbNotifier {
  private readonly clientKeysBySocket = new Map<HubSocket, Set<string>>();
  private readonly clientSocketsByKey = new Map<string, Set<HubSocket>>();
  private readonly daemonSessions = new Map<
    string,
    {
      hostId: string;
      localApiPort: number | null;
      platform: HostPlatform;
      socket: HubSocket;
    }
  >();
  private readonly daemonSessionLocalApiPortsBySessionId = new Map<
    string,
    number | null
  >();
  private readonly daemonSessionPlatformsBySessionId = new Map<
    string,
    HostPlatform
  >();
  private readonly daemonRegistrationWaiters = new Map<
    string,
    Set<DaemonRegistrationWaiter>
  >();
  private readonly daemonSessionIdsByHost = new Map<string, string>();
  private readonly hostOnlineRpcWaiters = new Map<
    string,
    HostOnlineRpcWaiter
  >();
  private readonly hostProtocolUpdateRetryRequests = new Set<string>();
  private readonly changedMessageListeners = new Set<ChangedMessageListener>();
  private readonly pendingDaemonDisconnects = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly pendingDaemonActiveWorkDisconnects = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly terminalClientSocketsById = new Map<
    string,
    Set<HubSocket>
  >();
  private readonly terminalSendLane: SocketSendLane = {
    drop: (socket, reason) => this.dropTerminalSocket(socket, reason),
    dropReasons: {
      queueOverflow: "terminal-backpressure",
      sendFailed: "terminal-send-failed",
    },
    highWaterBytes: TERMINAL_SOCKET_HIGH_WATER_BYTES,
    maxQueueBytes: TERMINAL_SOCKET_MAX_QUEUE_BYTES,
    queues: new Map<HubSocket, SocketSendQueue>(),
  };
  private readonly appSendLane: SocketSendLane = {
    drop: (socket, reason) => this.dropAppSocket(socket, reason),
    dropReasons: {
      queueOverflow: "app-backpressure",
      sendFailed: "app-send-failed",
    },
    highWaterBytes: APP_SOCKET_HIGH_WATER_BYTES,
    maxQueueBytes: APP_SOCKET_MAX_QUEUE_BYTES,
    queues: new Map<HubSocket, SocketSendQueue>(),
  };
  private readonly terminalIdsByClientSocket = new Map<
    HubSocket,
    Set<string>
  >();
  private readonly terminalResizeOwnerById = new Map<string, HubSocket>();
  private readonly threadEventWaiters = new Map<
    string,
    Set<ThreadEventWaiter>
  >();
  private readonly pendingThreadListEventsAppendedByThread = new Map<
    string,
    PendingThreadListEventsAppended
  >();

  registerClient(socket: HubSocket): void {
    if (!this.clientKeysBySocket.has(socket)) {
      this.clientKeysBySocket.set(socket, new Set());
    }
  }

  unregisterClient(socket: HubSocket): void {
    this.unregisterTerminalClientSocket(socket);
    this.clearSocketSendQueue(this.appSendLane, socket);
    const keys = this.clientKeysBySocket.get(socket);
    if (!keys) {
      return;
    }

    for (const key of keys) {
      const sockets = this.clientSocketsByKey.get(key);
      if (!sockets) {
        continue;
      }
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.clientSocketsByKey.delete(key);
      }
    }

    this.clientKeysBySocket.delete(socket);
  }

  onChangedMessage(listener: ChangedMessageListener): () => void {
    this.changedMessageListeners.add(listener);
    return () => {
      this.changedMessageListeners.delete(listener);
    };
  }

  registerTerminalClient(terminalId: string, socket: HubSocket): void {
    const sockets =
      this.terminalClientSocketsById.get(terminalId) ?? new Set<HubSocket>();
    sockets.add(socket);
    this.terminalClientSocketsById.set(terminalId, sockets);

    const terminalIds =
      this.terminalIdsByClientSocket.get(socket) ?? new Set<string>();
    terminalIds.add(terminalId);
    this.terminalIdsByClientSocket.set(socket, terminalIds);
  }

  claimTerminalResizeOwnership(terminalId: string, socket: HubSocket): void {
    this.terminalResizeOwnerById.set(terminalId, socket);
  }

  isTerminalResizeOwner(terminalId: string, socket: HubSocket): boolean {
    return this.terminalResizeOwnerById.get(terminalId) === socket;
  }

  unregisterTerminalClient(terminalId: string, socket: HubSocket): void {
    const sockets = this.terminalClientSocketsById.get(terminalId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.terminalClientSocketsById.delete(terminalId);
      }
    }
    this.releaseTerminalResizeOwnership(terminalId, socket, sockets);

    const terminalIds = this.terminalIdsByClientSocket.get(socket);
    if (!terminalIds) {
      return;
    }
    terminalIds.delete(terminalId);
    if (terminalIds.size === 0) {
      this.terminalIdsByClientSocket.delete(socket);
      this.clearSocketSendQueue(this.terminalSendLane, socket);
    }
  }

  unregisterTerminalClientSocket(socket: HubSocket): void {
    const terminalIds = this.terminalIdsByClientSocket.get(socket);
    if (!terminalIds) {
      return;
    }

    for (const terminalId of terminalIds) {
      const sockets = this.terminalClientSocketsById.get(terminalId);
      if (!sockets) {
        continue;
      }
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.terminalClientSocketsById.delete(terminalId);
      }
      this.releaseTerminalResizeOwnership(terminalId, socket, sockets);
    }

    this.terminalIdsByClientSocket.delete(socket);
    this.clearSocketSendQueue(this.terminalSendLane, socket);
  }

  private releaseTerminalResizeOwnership(
    terminalId: string,
    socket: HubSocket,
    sockets: Set<HubSocket> | undefined,
  ): void {
    if (this.terminalResizeOwnerById.get(terminalId) !== socket) {
      return;
    }
    let replacement: HubSocket | undefined;
    for (const candidate of sockets ?? []) {
      replacement = candidate;
    }
    if (replacement === undefined) {
      this.terminalResizeOwnerById.delete(terminalId);
    } else {
      this.terminalResizeOwnerById.set(terminalId, replacement);
    }
  }

  sendTerminalSocketMessage(
    socket: HubSocket,
    message: TerminalServerMessage,
  ): void {
    this.sendWithBackpressure(
      this.terminalSendLane,
      socket,
      JSON.stringify(terminalServerMessageSchema.parse(message)),
    );
  }

  sendTerminalClientMessage(
    terminalId: string,
    message: TerminalServerMessage,
  ): void {
    const sockets = this.terminalClientSocketsById.get(terminalId);
    if (!sockets) {
      return;
    }

    const payload = JSON.stringify(terminalServerMessageSchema.parse(message));
    for (const socket of [...sockets]) {
      this.sendWithBackpressure(this.terminalSendLane, socket, payload);
    }
  }

  /**
   * Send on a lane, queueing above the socket high water and dropping the
   * socket when a send throws or the queue budget overflows — one bad socket
   * can neither stall the loop nor grow without bound. Returns false when the
   * socket was dropped instead of sent/queued to.
   */
  private sendWithBackpressure(
    lane: SocketSendLane,
    socket: HubSocket,
    payload: string,
  ): boolean {
    const existingQueue = lane.queues.get(socket);
    if (
      !existingQueue &&
      (socket.raw?.bufferedAmount ?? 0) <= lane.highWaterBytes
    ) {
      try {
        socket.send(payload);
        return true;
      } catch {
        lane.drop(socket, lane.dropReasons.sendFailed);
        return false;
      }
    }

    const queue = existingQueue ?? {
      bytes: 0,
      payloads: [],
      timeout: null,
    };
    const payloadBytes = Buffer.byteLength(payload, "utf8");
    if (queue.bytes + payloadBytes > lane.maxQueueBytes) {
      lane.drop(socket, lane.dropReasons.queueOverflow);
      return false;
    }
    queue.payloads.push(payload);
    queue.bytes += payloadBytes;
    lane.queues.set(socket, queue);
    this.scheduleSocketDrain(lane, socket, queue);
    return true;
  }

  private scheduleSocketDrain(
    lane: SocketSendLane,
    socket: HubSocket,
    queue: SocketSendQueue,
  ): void {
    if (queue.timeout !== null) {
      return;
    }
    queue.timeout = setTimeout(() => {
      queue.timeout = null;
      this.flushSocketQueue(lane, socket, queue);
    }, SOCKET_DRAIN_POLL_MS);
  }

  private flushSocketQueue(
    lane: SocketSendLane,
    socket: HubSocket,
    queue: SocketSendQueue,
  ): void {
    if (lane.queues.get(socket) !== queue) {
      return;
    }
    while (
      queue.payloads.length > 0 &&
      (socket.raw?.bufferedAmount ?? 0) <= lane.highWaterBytes
    ) {
      const payload = queue.payloads[0];
      if (payload === undefined) {
        break;
      }
      try {
        socket.send(payload);
      } catch {
        lane.drop(socket, lane.dropReasons.sendFailed);
        return;
      }
      queue.payloads.shift();
      queue.bytes -= Buffer.byteLength(payload, "utf8");
    }
    if (queue.payloads.length === 0) {
      this.clearSocketSendQueue(lane, socket);
      return;
    }
    this.scheduleSocketDrain(lane, socket, queue);
  }

  private dropTerminalSocket(socket: HubSocket, reason: string): void {
    this.unregisterTerminalClientSocket(socket);
    try {
      socket.close(1013, reason);
    } catch {
      // The socket is already unusable; registration and queue state are gone.
    }
  }

  /**
   * Unregister first (which also clears the socket's queues) so the rest of
   * the current fan-out and all later ones skip the socket; the client
   * reconnects and catches up via the watermark.
   */
  private dropAppSocket(socket: HubSocket, reason: string): void {
    this.unregisterClient(socket);
    try {
      socket.close(1013, reason);
    } catch {
      // The socket is already unusable; registration and queue state are gone.
    }
  }

  private clearSocketSendQueue(lane: SocketSendLane, socket: HubSocket): void {
    const queue = lane.queues.get(socket);
    if (!queue) {
      return;
    }
    if (queue.timeout !== null) {
      clearTimeout(queue.timeout);
    }
    lane.queues.delete(socket);
  }

  subscribe(socket: HubSocket, target: RealtimeSubscriptionTarget): void {
    this.registerClient(socket);
    const key = subscriptionKey(target);
    this.clientKeysBySocket.get(socket)?.add(key);

    const sockets = this.clientSocketsByKey.get(key) ?? new Set<HubSocket>();
    sockets.add(socket);
    this.clientSocketsByKey.set(key, sockets);
  }

  unsubscribe(socket: HubSocket, target: RealtimeSubscriptionTarget): void {
    const key = subscriptionKey(target);
    this.clientKeysBySocket.get(socket)?.delete(key);

    const sockets = this.clientSocketsByKey.get(key);
    if (!sockets) {
      return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.clientSocketsByKey.delete(key);
    }
  }

  recordDaemonSessionPlatform(sessionId: string, platform: HostPlatform): void {
    this.daemonSessionPlatformsBySessionId.set(sessionId, platform);
  }

  recordDaemonSessionLocalApiPort(
    sessionId: string,
    localApiPort: number | null,
  ): void {
    this.daemonSessionLocalApiPortsBySessionId.set(sessionId, localApiPort);
  }

  registerDaemon(sessionId: string, hostId: string, socket: HubSocket): void {
    this.cancelPendingDaemonDisconnect(sessionId);
    const existingSessionId = this.daemonSessionIdsByHost.get(hostId);
    if (existingSessionId && existingSessionId !== sessionId) {
      this.cancelPendingDaemonDisconnect(existingSessionId);
      this.unregisterDaemon(existingSessionId);
    }
    this.daemonSessions.set(sessionId, {
      hostId,
      localApiPort:
        this.daemonSessionLocalApiPortsBySessionId.get(sessionId) ?? null,
      platform:
        this.daemonSessionPlatformsBySessionId.get(sessionId) ?? "unknown",
      socket,
    });
    this.daemonSessionIdsByHost.set(hostId, sessionId);
    this.resolveDaemonRegistrationWaiters(hostId);
    // Broadcast only now that the socket is registered: host status derives
    // from this registration, so any earlier host-connected (e.g. at session
    // open) races clients into refetching a still-"disconnected" /hosts and
    // caching it as fresh.
    this.notifyHost(hostId, ["host-connected"]);
  }

  unregisterDaemon(sessionId: string): void {
    const entry = this.daemonSessions.get(sessionId);
    if (!entry) {
      return;
    }
    this.daemonSessions.delete(sessionId);
    this.daemonSessionLocalApiPortsBySessionId.delete(sessionId);
    this.daemonSessionPlatformsBySessionId.delete(sessionId);
    this.rejectHostOnlineRpcWaitersForSession(sessionId);
    if (this.daemonSessionIdsByHost.get(entry.hostId) === sessionId) {
      this.daemonSessionIdsByHost.delete(entry.hostId);
    }
  }

  hasDaemonForHost(hostId: string): boolean {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    return sessionId !== undefined && this.daemonSessions.has(sessionId);
  }

  getDaemonSessionIdForHost(hostId: string): string | null {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    if (!sessionId || !this.daemonSessions.has(sessionId)) {
      return null;
    }
    return sessionId;
  }

  getDaemonPlatformForHost(hostId: string): HostPlatform | null {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    if (!sessionId) {
      return null;
    }
    return this.daemonSessions.get(sessionId)?.platform ?? null;
  }

  listDaemonLocalApiPorts(): number[] {
    const ports = new Set<number>();
    for (const session of this.daemonSessions.values()) {
      if (session.localApiPort !== null) {
        ports.add(session.localApiPort);
      }
    }
    return [...ports].sort((left, right) => left - right);
  }

  async waitForDaemonForHost(
    hostId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    if (this.hasDaemonForHost(hostId)) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const waiter: DaemonRegistrationWaiter = {
        resolve,
        timeout: setTimeout(() => {
          this.deleteDaemonRegistrationWaiter(hostId, waiter);
          resolve(false);
        }, timeoutMs),
      };
      const waiters =
        this.daemonRegistrationWaiters.get(hostId) ??
        new Set<DaemonRegistrationWaiter>();
      waiters.add(waiter);
      this.daemonRegistrationWaiters.set(hostId, waiters);
    });
  }

  closeDaemonSession(
    sessionId: string,
    reason: HostDaemonSessionCloseReason,
  ): void {
    const entry = this.daemonSessions.get(sessionId);
    if (entry) {
      entry.socket.send(JSON.stringify({ type: "session-close", reason }));
    }
    this.closeDaemonSessionSocket(sessionId, reason);
  }

  closeDaemonSessionSocket(
    sessionId: string,
    reason: HostDaemonSessionCloseReason,
  ): void {
    this.cancelPendingDaemonDisconnect(sessionId);
    const entry = this.daemonSessions.get(sessionId);
    if (!entry) {
      return;
    }
    entry.socket.close(1000, reason);
    this.unregisterDaemon(sessionId);
  }

  scheduleDaemonDisconnect(
    sessionId: string,
    delayMs: number,
    callback: () => void,
  ): void {
    this.cancelPendingDaemonDisconnectGrace(sessionId);
    const timeout = setTimeout(() => {
      this.pendingDaemonDisconnects.delete(sessionId);
      callback();
    }, delayMs);
    this.pendingDaemonDisconnects.set(sessionId, timeout);
  }

  scheduleDaemonActiveWorkDisconnect(
    sessionId: string,
    delayMs: number,
    callback: () => void,
  ): void {
    this.cancelPendingDaemonActiveWorkDisconnect(sessionId);
    const timeout = setTimeout(() => {
      this.pendingDaemonActiveWorkDisconnects.delete(sessionId);
      callback();
    }, delayMs);
    this.pendingDaemonActiveWorkDisconnects.set(sessionId, timeout);
  }

  private cancelPendingDaemonDisconnectGrace(sessionId: string): void {
    const timeout = this.pendingDaemonDisconnects.get(sessionId);
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    this.pendingDaemonDisconnects.delete(sessionId);
  }

  private cancelPendingDaemonActiveWorkDisconnect(sessionId: string): void {
    const timeout = this.pendingDaemonActiveWorkDisconnects.get(sessionId);
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    this.pendingDaemonActiveWorkDisconnects.delete(sessionId);
  }

  cancelPendingDaemonDisconnect(sessionId: string): void {
    this.cancelPendingDaemonDisconnectGrace(sessionId);
    this.cancelPendingDaemonActiveWorkDisconnect(sessionId);
  }

  requestHostOnlineRpc(args: {
    hostId: string;
    message: HostDaemonOnlineRpcRequestMessage;
    timeoutMs: number;
  }): Promise<HostDaemonOnlineRpcResponseMessage> {
    const sessionId = this.daemonSessionIdsByHost.get(args.hostId);
    if (!sessionId) {
      return Promise.reject(new HostOnlineRpcUnavailableError());
    }
    const session = this.daemonSessions.get(sessionId);
    if (!session) {
      return Promise.reject(new HostOnlineRpcUnavailableError());
    }

    return new Promise<HostDaemonOnlineRpcResponseMessage>(
      (resolve, reject) => {
        const waiter: HostOnlineRpcWaiter = {
          reject,
          resolve,
          sessionId,
          timeout: setTimeout(() => {
            this.deleteHostOnlineRpcWaiter(args.message.requestId, waiter);
            reject(new HostOnlineRpcTimeoutError());
          }, args.timeoutMs),
        };
        this.hostOnlineRpcWaiters.set(args.message.requestId, waiter);
        try {
          session.socket.send(JSON.stringify(args.message));
        } catch (error) {
          this.deleteHostOnlineRpcWaiter(args.message.requestId, waiter);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
  }

  recordHostOnlineRpcResponse(
    args: RecordHostOnlineRpcResponseArgs,
  ): HostOnlineRpcResponseDisposition {
    const waiter = this.hostOnlineRpcWaiters.get(args.message.requestId);
    if (!waiter) {
      return { handled: false, reason: "stale" };
    }
    if (waiter.sessionId !== args.sessionId) {
      return {
        expectedSessionId: waiter.sessionId,
        handled: false,
        reason: "session_mismatch",
      };
    }
    this.deleteHostOnlineRpcWaiter(args.message.requestId, waiter);
    waiter.resolve(args.message);
    return { handled: true };
  }

  registerThreadEventWaiter(
    threadId: string,
    timeoutMs: number,
  ): { promise: Promise<boolean>; cancel: () => void } {
    let waiter: ThreadEventWaiter;
    const promise = new Promise<boolean>((resolve) => {
      waiter = {
        resolve: (notified) => resolve(notified),
        timeout: setTimeout(() => {
          this.deleteThreadEventWaiter(threadId, waiter);
          resolve(false);
        }, timeoutMs),
      };
      const waiters =
        this.threadEventWaiters.get(threadId) ?? new Set<ThreadEventWaiter>();
      waiters.add(waiter);
      this.threadEventWaiters.set(threadId, waiters);
    });
    const cancel = () => {
      this.deleteThreadEventWaiter(threadId, waiter!);
    };
    return { promise, cancel };
  }

  notifyThread(
    threadId: string,
    changes: ThreadChangeKind[],
    metadata?: ThreadChangeMetadata,
  ): void {
    const message: ThreadChangedMessage = {
      type: "changed",
      entity: "thread",
      id: threadId,
      ...(metadata ? { metadata } : {}),
      changes,
    };
    if (isThreadListRelevantChange(message)) {
      this.notifyClients(message);
    } else {
      this.notifyThreadEventsAppendedCoalesced(threadId, message);
    }

    const threadEventWaiters = this.threadEventWaiters.get(threadId);
    if (threadEventWaiters) {
      for (const waiter of threadEventWaiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve(true);
      }
      this.threadEventWaiters.delete(threadId);
    }
  }

  /**
   * Broadcast an ephemeral thread-open signal to every connected client.
   * Nothing is persisted. Returns how many clients the signal reached.
   */
  notifyThreadOpen(
    thread: { projectId: string; threadId: string },
    request: { split: ThreadOpenSplit; file: ThreadOpenFile | null },
  ): number {
    const payload = JSON.stringify(
      threadOpenSignalSchema.parse({
        type: "thread-open",
        projectId: thread.projectId,
        threadId: thread.threadId,
        split: request.split,
        file: request.file,
      }),
    );
    return this.broadcastToAppSockets(payload);
  }

  /** Broadcast an ephemeral pane presentation request to every app client. */
  notifyThreadPaneAction(
    thread: { projectId: string; threadId: string },
    action: ThreadPaneAction,
  ): number {
    const payload = JSON.stringify(
      threadPaneActionSignalSchema.parse({
        type: "thread-pane-action",
        projectId: thread.projectId,
        threadId: thread.threadId,
        action,
      }),
    );
    return this.broadcastToAppSockets(payload);
  }

  /**
   * Broadcast an ephemeral plugin realtime signal (`bb.realtime.publish`) to
   * every connected client. V1 broadcasts to all clients — per-channel
   * subscriptions arrive with the plugin frontend runtime. Returns how many
   * clients the signal reached.
   *
   * `serializedPayload` is the publish site's single JSON serialization of
   * the payload, embedded verbatim in the wire frame so the fan-out never
   * parses or re-stringifies it. The envelope fields still pass the strict
   * outgoing schema.
   */
  notifyPluginSignal(
    pluginId: string,
    channel: string,
    serializedPayload: string,
  ): number {
    const envelope = pluginSignalEnvelopeSchema.parse({
      type: "plugin-signal",
      pluginId,
      channel,
    });
    const message = `{"type":"plugin-signal","pluginId":${JSON.stringify(
      envelope.pluginId,
    )},"channel":${JSON.stringify(envelope.channel)},"payload":${serializedPayload}}`;
    return this.broadcastToAppSockets(message);
  }

  /** Ephemeral broadcast to every app socket; returns how many accepted it. */
  private broadcastToAppSockets(payload: string): number {
    let delivered = 0;
    // Snapshot: dropping a socket mutates the live registration map.
    for (const socket of [...this.clientKeysBySocket.keys()]) {
      if (this.sendWithBackpressure(this.appSendLane, socket, payload)) {
        delivered += 1;
      }
    }
    return delivered;
  }

  notifyProject(projectId: string, changes: ProjectChangeKind[]): void {
    this.notifyClients({
      type: "changed",
      entity: "project",
      id: projectId,
      changes,
    });
  }

  notifyEnvironment(
    environmentId: string,
    changes: EnvironmentChangeKind[],
  ): void {
    this.notifyClients({
      type: "changed",
      entity: "environment",
      id: environmentId,
      changes,
    });
  }

  notifyHost(hostId: string, changes: HostChangeKind[]): void {
    this.notifyClients({
      type: "changed",
      entity: "host",
      id: hostId,
      changes,
    });
  }

  requestHostProtocolUpdateRetry(hostId: string): void {
    this.hostProtocolUpdateRetryRequests.add(hostId);
  }

  takeHostProtocolUpdateRetry(hostId: string): boolean {
    if (!this.hostProtocolUpdateRetryRequests.has(hostId)) {
      return false;
    }
    this.hostProtocolUpdateRetryRequests.delete(hostId);
    return true;
  }

  notifySystem(changes: SystemChangeKind[]): void {
    this.notifyClients({
      type: "changed",
      entity: "system",
      changes,
    });
  }

  private deleteThreadEventWaiter(
    threadId: string,
    waiter: ThreadEventWaiter,
  ): void {
    const waiters = this.threadEventWaiters.get(threadId);
    if (!waiters) {
      return;
    }
    clearTimeout(waiter.timeout);
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.threadEventWaiters.delete(threadId);
    }
  }

  private deleteHostOnlineRpcWaiter(
    requestId: string,
    waiter: HostOnlineRpcWaiter,
  ): void {
    clearTimeout(waiter.timeout);
    if (this.hostOnlineRpcWaiters.get(requestId) === waiter) {
      this.hostOnlineRpcWaiters.delete(requestId);
    }
  }

  private rejectHostOnlineRpcWaitersForSession(sessionId: string): void {
    for (const [requestId, waiter] of this.hostOnlineRpcWaiters) {
      if (waiter.sessionId !== sessionId) {
        continue;
      }
      this.deleteHostOnlineRpcWaiter(requestId, waiter);
      waiter.reject(new HostOnlineRpcUnavailableError());
    }
  }

  private deleteDaemonRegistrationWaiter(
    hostId: string,
    waiter: DaemonRegistrationWaiter,
  ): void {
    clearTimeout(waiter.timeout);
    const waiters = this.daemonRegistrationWaiters.get(hostId);
    if (!waiters) {
      return;
    }
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.daemonRegistrationWaiters.delete(hostId);
    }
  }

  private resolveDaemonRegistrationWaiters(hostId: string): void {
    const waiters = this.daemonRegistrationWaiters.get(hostId);
    if (!waiters) {
      return;
    }
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(true);
    }
    this.daemonRegistrationWaiters.delete(hostId);
  }

  /**
   * Plain `events-appended`: detail subscribers of the thread get it now;
   * sockets that only hold the thread-list subscription get the first one
   * now and the rest merged into one notification when the window closes.
   */
  private notifyThreadEventsAppendedCoalesced(
    threadId: string,
    message: ThreadChangedMessage,
  ): void {
    const parseResult = serverMessageSchema.safeParse(message);
    if (!parseResult.success) {
      console.error("Skipping invalid realtime broadcast", parseResult.error);
      return;
    }
    const payload = JSON.stringify(parseResult.data);
    const detailSockets = this.clientSocketsByKey.get(
      subscriptionKey({ kind: "thread-detail", threadId }),
    );
    if (detailSockets) {
      this.notifyClientsByKeySet(detailSockets, payload);
    }
    this.notifyChangedMessageListeners(message);

    const eventTypes = message.metadata?.eventTypes ?? [];
    const pending = this.pendingThreadListEventsAppendedByThread.get(threadId);
    if (pending) {
      for (const eventType of eventTypes) {
        pending.eventTypes.add(eventType);
      }
      pending.merged = true;
      return;
    }

    this.notifyThreadListOnlySockets(threadId, payload);
    const timeout = setTimeout(() => {
      this.flushPendingThreadListEventsAppended(threadId);
    }, THREAD_LIST_EVENTS_APPENDED_COALESCE_MS);
    timeout.unref?.();
    this.pendingThreadListEventsAppendedByThread.set(threadId, {
      eventTypes: new Set(eventTypes),
      merged: false,
      timeout,
    });
  }

  private flushPendingThreadListEventsAppended(threadId: string): void {
    const pending = this.pendingThreadListEventsAppendedByThread.get(threadId);
    if (!pending) {
      return;
    }
    this.pendingThreadListEventsAppendedByThread.delete(threadId);
    if (!pending.merged) {
      return;
    }
    const message: ThreadChangedMessage = {
      type: "changed",
      entity: "thread",
      id: threadId,
      ...(pending.eventTypes.size > 0
        ? { metadata: { eventTypes: [...pending.eventTypes] } }
        : {}),
      changes: ["events-appended"],
    };
    const parseResult = serverMessageSchema.safeParse(message);
    if (!parseResult.success) {
      console.error("Skipping invalid realtime broadcast", parseResult.error);
      return;
    }
    this.notifyThreadListOnlySockets(
      threadId,
      JSON.stringify(parseResult.data),
    );
  }

  /** Sockets subscribed to the thread list but not to this thread's detail. */
  private notifyThreadListOnlySockets(threadId: string, payload: string): void {
    const listSockets = this.clientSocketsByKey.get(
      subscriptionKey({ kind: "thread-list" }),
    );
    if (!listSockets) {
      return;
    }
    const detailKey = subscriptionKey({ kind: "thread-detail", threadId });
    for (const socket of [...listSockets]) {
      if (this.clientKeysBySocket.get(socket)?.has(detailKey)) {
        continue;
      }
      this.sendWithBackpressure(this.appSendLane, socket, payload);
    }
  }

  private notifyClients(message: ChangedMessage): void {
    const sockets = new Set<HubSocket>();
    for (const key of subscriptionKeysForMessage(message)) {
      const specificSockets = this.clientSocketsByKey.get(key);
      if (!specificSockets) {
        continue;
      }
      for (const socket of specificSockets) {
        sockets.add(socket);
      }
    }

    const parseResult = serverMessageSchema.safeParse(message);
    if (!parseResult.success) {
      console.error("Skipping invalid realtime broadcast", parseResult.error);
      return;
    }
    const payload = JSON.stringify(parseResult.data);
    this.notifyClientsByKeySet(sockets, payload);
    this.notifyChangedMessageListeners(message);
  }

  private notifyClientsByKeySet(
    sockets: Iterable<HubSocket>,
    payload: string,
  ): void {
    // Snapshot: dropping a socket mutates the live subscription sets.
    for (const socket of [...sockets]) {
      this.sendWithBackpressure(this.appSendLane, socket, payload);
    }
  }

  private notifyChangedMessageListeners(message: ChangedMessage): void {
    for (const listener of this.changedMessageListeners) {
      listener(message);
    }
  }

  sendDaemonMessage(
    hostId: string,
    message: HostDaemonServerWsMessage,
  ): boolean {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    if (!sessionId) {
      return false;
    }
    return this.sendDaemonSessionMessage(sessionId, message);
  }

  sendDaemonSessionMessage(
    sessionId: string,
    message: HostDaemonServerWsMessage,
  ): boolean {
    const session = this.daemonSessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.socket.send(JSON.stringify(message));
    return true;
  }
}
