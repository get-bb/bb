import type {
  ChangedMessage,
  ApplicationId,
  EnvironmentChangeKind,
  HostChangeKind,
  ProjectChangeKind,
  SystemChangeKind,
  ThreadChangeKind,
  ThreadChangeMetadata,
  WorkflowRunChangeKind,
} from "@bb/domain";
import type { DbNotifier } from "@bb/db";
import type {
  HostDaemonOnlineRpcRequestMessage,
  HostDaemonOnlineRpcResponseMessage,
  HostDaemonServerWsMessage,
  HostDaemonSessionCloseReason,
} from "@bb/host-daemon-contract";
import {
  serverMessageSchema,
  terminalServerMessageSchema,
  type AppDataBroadcastMessage,
  type TerminalServerMessage,
} from "@bb/server-contract";

interface HubSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface ThreadEventWaiter {
  reject: (reason?: Error) => void;
  resolve: (notified: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface HostEventWaiter {
  reject: (reason?: Error) => void;
  resolve: (notified: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface WorkflowRunWaiter {
  reject: (reason?: Error) => void;
  resolve: (notified: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface HostOnlineRpcWaiter {
  reject: (reason?: Error) => void;
  resolve: (message: HostDaemonOnlineRpcResponseMessage) => void;
  sessionId: string;
  timeout: ReturnType<typeof setTimeout>;
}

export interface RecordHostOnlineRpcResponseArgs {
  message: HostDaemonOnlineRpcResponseMessage;
  sessionId: string;
}

export type HostOnlineRpcResponseDisposition =
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

function subKey(entity: string, id?: string): string {
  return id ? `${entity}:${id}` : entity;
}

export class NotificationHub implements DbNotifier {
  private readonly clientKeysBySocket = new Map<HubSocket, Set<string>>();
  private readonly clientSocketsByKey = new Map<string, Set<HubSocket>>();
  private readonly daemonSessions = new Map<
    string,
    { hostId: string; socket: HubSocket }
  >();
  private readonly daemonSessionIdsByHost = new Map<string, string>();
  private readonly hostEventWaiters = new Map<string, Set<HostEventWaiter>>();
  private readonly hostOnlineRpcWaiters = new Map<
    string,
    HostOnlineRpcWaiter
  >();
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
  private readonly terminalIdsByClientSocket = new Map<
    HubSocket,
    Set<string>
  >();
  private readonly threadEventWaiters = new Map<
    string,
    Set<ThreadEventWaiter>
  >();
  private readonly workflowRunWaiters = new Map<
    string,
    Set<WorkflowRunWaiter>
  >();

  registerClient(socket: HubSocket): void {
    if (!this.clientKeysBySocket.has(socket)) {
      this.clientKeysBySocket.set(socket, new Set());
    }
  }

  unregisterClient(socket: HubSocket): void {
    this.unregisterTerminalClientSocket(socket);
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

  unregisterTerminalClient(terminalId: string, socket: HubSocket): void {
    const sockets = this.terminalClientSocketsById.get(terminalId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.terminalClientSocketsById.delete(terminalId);
      }
    }

    const terminalIds = this.terminalIdsByClientSocket.get(socket);
    if (!terminalIds) {
      return;
    }
    terminalIds.delete(terminalId);
    if (terminalIds.size === 0) {
      this.terminalIdsByClientSocket.delete(socket);
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
    }

    this.terminalIdsByClientSocket.delete(socket);
  }

  sendTerminalSocketMessage(
    socket: HubSocket,
    message: TerminalServerMessage,
  ): void {
    socket.send(JSON.stringify(terminalServerMessageSchema.parse(message)));
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
    for (const socket of sockets) {
      socket.send(payload);
    }
  }

  subscribe(socket: HubSocket, entity: string, id?: string): void {
    this.registerClient(socket);
    const key = subKey(entity, id);
    this.clientKeysBySocket.get(socket)?.add(key);

    const sockets = this.clientSocketsByKey.get(key) ?? new Set<HubSocket>();
    sockets.add(socket);
    this.clientSocketsByKey.set(key, sockets);
  }

  unsubscribe(socket: HubSocket, entity: string, id?: string): void {
    const key = subKey(entity, id);
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

  registerDaemon(sessionId: string, hostId: string, socket: HubSocket): void {
    this.cancelPendingDaemonDisconnect(sessionId);
    const existingSessionId = this.daemonSessionIdsByHost.get(hostId);
    if (existingSessionId && existingSessionId !== sessionId) {
      this.cancelPendingDaemonDisconnect(existingSessionId);
      this.unregisterDaemon(existingSessionId);
    }
    this.daemonSessions.set(sessionId, { hostId, socket });
    this.daemonSessionIdsByHost.set(hostId, sessionId);
  }

  unregisterDaemon(sessionId: string): void {
    const entry = this.daemonSessions.get(sessionId);
    if (!entry) {
      return;
    }
    this.daemonSessions.delete(sessionId);
    this.rejectHostOnlineRpcWaitersForSession(sessionId);
    if (this.daemonSessionIdsByHost.get(entry.hostId) === sessionId) {
      this.daemonSessionIdsByHost.delete(entry.hostId);
    }
  }

  /**
   * Whether the host's daemon currently has a live hub websocket. An active
   * session ROW does not imply this: /internal/session/open creates the row
   * before the daemon attaches its socket, so work that would fail without a
   * socket (e.g. deferred workflow manager notifications) gates on this in
   * addition to the session row.
   */
  hasDaemonForHost(hostId: string): boolean {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    return sessionId !== undefined && this.daemonSessions.has(sessionId);
  }

  closeDaemonSession(
    sessionId: string,
    reason: HostDaemonSessionCloseReason,
  ): void {
    this.cancelPendingDaemonDisconnect(sessionId);
    const entry = this.daemonSessions.get(sessionId);
    if (!entry) {
      return;
    }
    entry.socket.send(JSON.stringify({ type: "session-close", reason }));
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

  async waitForThreadEvent(
    threadId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const { promise } = this.registerThreadEventWaiter(threadId, timeoutMs);
    return promise;
  }

  async waitForHostEvent(hostId: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const waiter: HostEventWaiter = {
        reject,
        resolve: (notified) => resolve(notified),
        timeout: setTimeout(() => {
          this.deleteHostEventWaiter(hostId, waiter);
          resolve(false);
        }, timeoutMs),
      };
      const waiters =
        this.hostEventWaiters.get(hostId) ?? new Set<HostEventWaiter>();
      waiters.add(waiter);
      this.hostEventWaiters.set(hostId, waiters);
    });
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
    const promise = new Promise<boolean>((resolve, reject) => {
      waiter = {
        reject,
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

  /**
   * Wakeup for the `/workflow-runs/:id/wait` long-poll: resolves on the next
   * `notifyWorkflowRun` for the run (`run-updated` or `events-appended` — the
   * route re-checks the row either way). Same register-then-recheck contract
   * as `registerThreadEventWaiter`.
   */
  registerWorkflowRunWaiter(
    workflowRunId: string,
    timeoutMs: number,
  ): { promise: Promise<boolean>; cancel: () => void } {
    let waiter: WorkflowRunWaiter;
    const promise = new Promise<boolean>((resolve, reject) => {
      waiter = {
        reject,
        resolve: (notified) => resolve(notified),
        timeout: setTimeout(() => {
          this.deleteWorkflowRunWaiter(workflowRunId, waiter);
          resolve(false);
        }, timeoutMs),
      };
      const waiters =
        this.workflowRunWaiters.get(workflowRunId) ??
        new Set<WorkflowRunWaiter>();
      waiters.add(waiter);
      this.workflowRunWaiters.set(workflowRunId, waiters);
    });
    const cancel = () => {
      this.deleteWorkflowRunWaiter(workflowRunId, waiter!);
    };
    return { promise, cancel };
  }

  notifyThread(
    threadId: string,
    changes: ThreadChangeKind[],
    metadata?: ThreadChangeMetadata,
  ): void {
    this.notifyClients({
      type: "changed",
      entity: "thread",
      id: threadId,
      ...(metadata ? { metadata } : {}),
      changes,
    });

    const threadEventWaiters = this.threadEventWaiters.get(threadId);
    if (threadEventWaiters) {
      for (const waiter of threadEventWaiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve(true);
      }
      this.threadEventWaiters.delete(threadId);
    }
  }

  notifyAppData(message: AppDataBroadcastMessage): void {
    this.notifyClientsByKey(
      subKey("app", `${message.applicationId}:data`),
      JSON.stringify(serverMessageSchema.parse(message)),
    );
  }

  /**
   * List-level (id-less) app broadcast — some app was installed, updated, or
   * removed. App-scoped changes go through `notifyAppContentChanged` instead.
   */
  notifyAppsChanged(): void {
    this.notifyClients({
      type: "changed",
      entity: "app",
      changes: ["apps-changed"],
    });
  }

  /**
   * App-scoped signal that an app's served `public/` content changed on disk.
   * Carries the application id (unlike the list-level `apps-changed`
   * broadcast) so clients can reload just that app's open surfaces.
   */
  notifyAppContentChanged(applicationId: ApplicationId): void {
    this.notifyClients({
      type: "changed",
      entity: "app",
      id: applicationId,
      changes: ["content-changed"],
    });
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

    const waiters = this.hostEventWaiters.get(hostId);
    if (!waiters) {
      return;
    }

    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(true);
    }
    this.hostEventWaiters.delete(hostId);
  }

  notifySystem(changes: SystemChangeKind[]): void {
    this.notifyClients({
      type: "changed",
      entity: "system",
      changes,
    });
  }

  notifyWorkflowRun(
    workflowRunId: string,
    changes: WorkflowRunChangeKind[],
  ): void {
    this.notifyClients({
      type: "changed",
      entity: "workflow-run",
      id: workflowRunId,
      changes,
    });

    const workflowRunWaiters = this.workflowRunWaiters.get(workflowRunId);
    if (workflowRunWaiters) {
      for (const waiter of workflowRunWaiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve(true);
      }
      this.workflowRunWaiters.delete(workflowRunId);
    }
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

  private deleteWorkflowRunWaiter(
    workflowRunId: string,
    waiter: WorkflowRunWaiter,
  ): void {
    const waiters = this.workflowRunWaiters.get(workflowRunId);
    if (!waiters) {
      return;
    }
    clearTimeout(waiter.timeout);
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.workflowRunWaiters.delete(workflowRunId);
    }
  }

  private deleteHostEventWaiter(hostId: string, waiter: HostEventWaiter): void {
    clearTimeout(waiter.timeout);
    const waiters = this.hostEventWaiters.get(hostId);
    if (!waiters) {
      return;
    }
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.hostEventWaiters.delete(hostId);
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

  private notifyClients(message: ChangedMessage): void {
    const sockets = new Set<HubSocket>();
    const entitySockets = this.clientSocketsByKey.get(subKey(message.entity));
    if (entitySockets) {
      for (const socket of entitySockets) {
        sockets.add(socket);
      }
    }

    if ("id" in message && message.id) {
      const specificSockets = this.clientSocketsByKey.get(
        subKey(message.entity, message.id),
      );
      if (specificSockets) {
        for (const socket of specificSockets) {
          sockets.add(socket);
        }
      }
    }

    const parseResult = serverMessageSchema.safeParse(message);
    if (!parseResult.success) {
      console.error("Skipping invalid realtime broadcast", parseResult.error);
      return;
    }
    const payload = JSON.stringify(parseResult.data);
    this.notifyClientsByKeySet(sockets, payload);
  }

  private notifyClientsByKey(key: string, payload: string): void {
    const sockets = this.clientSocketsByKey.get(key);
    if (!sockets) {
      return;
    }
    this.notifyClientsByKeySet(sockets, payload);
  }

  private notifyClientsByKeySet(
    sockets: Iterable<HubSocket>,
    payload: string,
  ): void {
    for (const socket of sockets) {
      socket.send(payload);
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
