import type {
  ChangedMessage,
  AppChangeKind,
  EnvironmentChangeKind,
  HostChangeKind,
  ProjectChangeKind,
  SystemChangeKind,
  ThreadChangeKind,
  ThreadChangeMetadata,
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
import { COMMAND_RESULT_CACHE_TTL_MS } from "../constants.js";
import type { CommandResultWaiterResponse } from "../internal/command-result-side-effects.js";

interface HubSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface CommandWaiter {
  reject: (reason?: Error) => void;
  resolve: (notified: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
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

interface CommandResultWaiter {
  reject: (reason?: Error) => void;
  resolve: (result: CommandResultWaiterResponse) => void;
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
  private readonly commandResultCache = new Map<
    string,
    CommandResultWaiterResponse
  >();
  private readonly commandResultWaiters = new Map<
    string,
    Set<CommandResultWaiter>
  >();
  private readonly commandWaiters = new Map<string, Set<CommandWaiter>>();
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
    this.cancelPendingDaemonDisconnect(sessionId);
    const timeout = setTimeout(() => {
      this.pendingDaemonDisconnects.delete(sessionId);
      callback();
    }, delayMs);
    this.pendingDaemonDisconnects.set(sessionId, timeout);
  }

  cancelPendingDaemonDisconnect(sessionId: string): void {
    const timeout = this.pendingDaemonDisconnects.get(sessionId);
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    this.pendingDaemonDisconnects.delete(sessionId);
  }

  async waitForCommands(hostId: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const waiter: CommandWaiter = {
        reject,
        resolve: (notified) => resolve(notified),
        timeout: setTimeout(() => {
          this.deleteCommandWaiter(hostId, waiter);
          resolve(false);
        }, timeoutMs),
      };
      const waiters =
        this.commandWaiters.get(hostId) ?? new Set<CommandWaiter>();
      waiters.add(waiter);
      this.commandWaiters.set(hostId, waiters);
    });
  }

  async waitForCommandResult(
    commandId: string,
    timeoutMs: number,
  ): Promise<CommandResultWaiterResponse> {
    const cached = this.commandResultCache.get(commandId);
    if (cached !== undefined) {
      return cached;
    }

    return new Promise<CommandResultWaiterResponse>((resolve, reject) => {
      const waiter: CommandResultWaiter = {
        reject,
        resolve,
        timeout: setTimeout(() => {
          this.deleteCommandResultWaiter(commandId, waiter);
          reject(new Error("Timed out waiting for command result"));
        }, timeoutMs),
      };
      const waiters =
        this.commandResultWaiters.get(commandId) ??
        new Set<CommandResultWaiter>();
      waiters.add(waiter);
      this.commandResultWaiters.set(commandId, waiters);
    });
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

  recordCommandResult(
    commandId: string,
    result: CommandResultWaiterResponse,
  ): void {
    this.commandResultCache.set(commandId, result);
    setTimeout(() => {
      this.commandResultCache.delete(commandId);
    }, COMMAND_RESULT_CACHE_TTL_MS);

    const waiters = this.commandResultWaiters.get(commandId);
    if (!waiters) {
      return;
    }

    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(result);
    }
    this.commandResultWaiters.delete(commandId);
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

  notifyApp(changes: AppChangeKind[]): void {
    this.notifyClients({
      type: "changed",
      entity: "app",
      changes,
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

  notifyCommand(hostId: string): void {
    this.notifyDaemon(hostId);

    const waiters = this.commandWaiters.get(hostId);
    if (!waiters) {
      return;
    }

    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(true);
    }
    this.commandWaiters.delete(hostId);
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

  private deleteCommandResultWaiter(
    commandId: string,
    waiter: CommandResultWaiter,
  ): void {
    const waiters = this.commandResultWaiters.get(commandId);
    if (!waiters) {
      return;
    }
    clearTimeout(waiter.timeout);
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.commandResultWaiters.delete(commandId);
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

  private deleteCommandWaiter(hostId: string, waiter: CommandWaiter): void {
    const waiters = this.commandWaiters.get(hostId);
    if (!waiters) {
      return;
    }
    clearTimeout(waiter.timeout);
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.commandWaiters.delete(hostId);
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

  notifyDaemon(
    hostId: string,
    message: { type: "commands-available" } = { type: "commands-available" },
  ): void {
    this.sendDaemonMessage(hostId, message);
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
