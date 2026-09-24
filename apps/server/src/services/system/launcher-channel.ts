import { randomUUID } from "node:crypto";
import {
  launcherToServerMessageSchema,
  type AppUpdateLauncherRequest,
  type LauncherAppUpdateStatus,
  type ServerToLauncherMessage,
} from "@bb/config/app-update";

const SOURCE_CHECK_TIMEOUT_MS = 3 * 60 * 1000;
const LAUNCHER_REQUEST_TIMEOUT_MS = 15 * 1000;

export interface LauncherChannel {
  dispose(): void;
  onDisconnect(listener: () => void): () => void;
  onStatus(listener: (status: LauncherAppUpdateStatus) => void): () => void;
  request(request: AppUpdateLauncherRequest): Promise<unknown>;
}

function requestTimeoutMs(request: AppUpdateLauncherRequest): number {
  return request.type === "check-source"
    ? SOURCE_CHECK_TIMEOUT_MS
    : LAUNCHER_REQUEST_TIMEOUT_MS;
}

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface LauncherProcessPort {
  channel?: { unref(): void } | undefined;
  off(event: "message", listener: (message: unknown) => void): unknown;
  off(event: "disconnect", listener: () => void): unknown;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "disconnect", listener: () => void): unknown;
  send?:
    | ((
        message: ServerToLauncherMessage,
        callback: (error: Error | null) => void,
      ) => boolean)
    | undefined;
}

export function createLauncherChannel(
  port: LauncherProcessPort,
): LauncherChannel | null {
  const send = port.send?.bind(port);
  if (send === undefined) {
    return null;
  }
  const pending = new Map<string, PendingRequest>();
  const listeners = new Set<(status: LauncherAppUpdateStatus) => void>();
  const disconnectListeners = new Set<() => void>();

  const rejectAll = (message: string): void => {
    for (const [requestId, request] of pending) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
      pending.delete(requestId);
    }
  };

  const onMessage = (raw: unknown): void => {
    const parsed = launcherToServerMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.channel === "bb-app-update/status") {
      for (const listener of listeners) listener(message.status);
      return;
    }
    const request = pending.get(message.requestId);
    if (request === undefined) return;
    pending.delete(message.requestId);
    clearTimeout(request.timer);
    if (message.error === null) {
      request.resolve(message.result);
    } else {
      request.reject(new Error(message.error));
    }
  };
  const onDisconnect = (): void => {
    rejectAll("The bb-app launcher disconnected.");
    for (const listener of disconnectListeners) listener();
  };

  port.on("message", onMessage);
  port.on("disconnect", onDisconnect);
  port.channel?.unref();
  try {
    send({ channel: "bb-app-update/hello" }, () => undefined);
  } catch {}

  return {
    dispose() {
      port.off("message", onMessage);
      port.off("disconnect", onDisconnect);
      rejectAll("The server is shutting down.");
      listeners.clear();
      disconnectListeners.clear();
    },
    onDisconnect(listener) {
      disconnectListeners.add(listener);
      return () => {
        disconnectListeners.delete(listener);
      };
    },
    onStatus(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request(request) {
      const requestId = randomUUID();
      return new Promise((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          rejectPromise(new Error("The bb-app launcher did not respond."));
        }, requestTimeoutMs(request));
        pending.set(requestId, {
          reject: rejectPromise,
          resolve: resolvePromise,
          timer,
        });
        try {
          send(
            { channel: "bb-app-update/request", request, requestId },
            (error) => {
              if (error === null || !pending.has(requestId)) return;
              clearTimeout(timer);
              pending.delete(requestId);
              rejectPromise(error);
            },
          );
        } catch (error) {
          clearTimeout(timer);
          pending.delete(requestId);
          rejectPromise(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    },
  };
}
