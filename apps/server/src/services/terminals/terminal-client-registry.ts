import { Buffer } from "node:buffer";
import {
  terminalServerMessageSchema,
  type TerminalServerMessage,
} from "@bb/server-contract";
import type { TerminalDataPlaneSocket } from "./terminal-data-plane.js";

export const TERMINAL_SOCKET_HIGH_WATER_BYTES = 1024 * 1024;
export const TERMINAL_SOCKET_MAX_QUEUE_BYTES = 32 * 1024 * 1024;
export const TERMINAL_SOCKET_DRAIN_POLL_MS = 10;

interface TerminalSocketSendQueue {
  bytes: number;
  payloads: string[];
  timeout: NodeJS.Timeout | null;
}

type HubSocket = TerminalDataPlaneSocket;

export class TerminalClientRegistry {
  private readonly terminalClientSocketsById = new Map<
    string,
    Set<TerminalDataPlaneSocket>
  >();
  private readonly terminalSocketSendQueues = new Map<
    TerminalDataPlaneSocket,
    TerminalSocketSendQueue
  >();
  private readonly terminalIdsByClientSocket = new Map<
    TerminalDataPlaneSocket,
    Set<string>
  >();
  private readonly terminalResizeOwnerById = new Map<
    string,
    TerminalDataPlaneSocket
  >();
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
      this.clearTerminalSocketSendQueue(socket);
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
    this.clearTerminalSocketSendQueue(socket);
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
    this.sendOrQueueTerminalPayload(
      socket,
      JSON.stringify(terminalServerMessageSchema.parse(message)),
    );
  }

  hasTerminalClients(terminalId: string): boolean {
    return (this.terminalClientSocketsById.get(terminalId)?.size ?? 0) > 0;
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
      this.sendOrQueueTerminalPayload(socket, payload);
    }
  }

  private sendOrQueueTerminalPayload(socket: HubSocket, payload: string): void {
    const existingQueue = this.terminalSocketSendQueues.get(socket);
    if (
      !existingQueue &&
      (socket.raw?.bufferedAmount ?? 0) <= TERMINAL_SOCKET_HIGH_WATER_BYTES
    ) {
      try {
        socket.send(payload);
        return;
      } catch {
        this.dropTerminalSocket(socket, "terminal-send-failed");
        return;
      }
    }

    const queue = existingQueue ?? {
      bytes: 0,
      payloads: [],
      timeout: null,
    };
    const payloadBytes = Buffer.byteLength(payload, "utf8");
    if (queue.bytes + payloadBytes > TERMINAL_SOCKET_MAX_QUEUE_BYTES) {
      this.dropTerminalSocket(socket, "terminal-backpressure");
      return;
    }
    queue.payloads.push(payload);
    queue.bytes += payloadBytes;
    this.terminalSocketSendQueues.set(socket, queue);
    this.scheduleTerminalSocketDrain(socket, queue);
  }

  private scheduleTerminalSocketDrain(
    socket: HubSocket,
    queue: TerminalSocketSendQueue,
  ): void {
    if (queue.timeout !== null) {
      return;
    }
    queue.timeout = setTimeout(() => {
      queue.timeout = null;
      this.flushTerminalSocketQueue(socket, queue);
    }, TERMINAL_SOCKET_DRAIN_POLL_MS);
  }

  private flushTerminalSocketQueue(
    socket: HubSocket,
    queue: TerminalSocketSendQueue,
  ): void {
    if (this.terminalSocketSendQueues.get(socket) !== queue) {
      return;
    }
    while (
      queue.payloads.length > 0 &&
      (socket.raw?.bufferedAmount ?? 0) <= TERMINAL_SOCKET_HIGH_WATER_BYTES
    ) {
      const payload = queue.payloads[0];
      if (payload === undefined) {
        break;
      }
      try {
        socket.send(payload);
      } catch {
        this.dropTerminalSocket(socket, "terminal-send-failed");
        return;
      }
      queue.payloads.shift();
      queue.bytes -= Buffer.byteLength(payload, "utf8");
    }
    if (queue.payloads.length === 0) {
      this.clearTerminalSocketSendQueue(socket);
      return;
    }
    this.scheduleTerminalSocketDrain(socket, queue);
  }

  private dropTerminalSocket(socket: HubSocket, reason: string): void {
    this.unregisterTerminalClientSocket(socket);
    try {
      socket.close(1013, reason);
    } catch {}
  }

  private clearTerminalSocketSendQueue(socket: HubSocket): void {
    const queue = this.terminalSocketSendQueues.get(socket);
    if (!queue) {
      return;
    }
    if (queue.timeout !== null) {
      clearTimeout(queue.timeout);
    }
    this.terminalSocketSendQueues.delete(socket);
  }
}
