import { randomUUID } from "node:crypto";
import {
  desktopAppUpdateMessageSchema,
  type DesktopAppUpdateInfo,
  type DesktopAppUpdateRequest,
} from "@bb/config/desktop-app-update";

export interface DesktopUpdateChannel {
  request(
    action: DesktopAppUpdateRequest["action"],
  ): Promise<DesktopAppUpdateInfo>;
  subscribe(listener: (info: DesktopAppUpdateInfo | null) => void): () => void;
  dispose(): void;
}

export function createDesktopUpdateChannel(
  port: Pick<NodeJS.Process, "send" | "on" | "off" | "channel">,
): DesktopUpdateChannel | null {
  const send = port.send?.bind(port);
  if (send === undefined) return null;
  const listeners = new Set<(info: DesktopAppUpdateInfo | null) => void>();
  const pending = new Map<
    string,
    {
      resolve: (info: DesktopAppUpdateInfo) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let disconnected = false;
  const disconnect = (): void => {
    disconnected = true;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("The desktop app disconnected."));
    }
    pending.clear();
    for (const listener of listeners) listener(null);
  };
  const onMessage = (raw: unknown): void => {
    const parsed = desktopAppUpdateMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.channel === "bb-desktop-update/disconnected") {
      disconnect();
      return;
    }
    if (message.channel === "bb-desktop-update/status") {
      for (const listener of listeners) listener(message.info);
      return;
    }
    const request = pending.get(message.requestId);
    if (request === undefined) return;
    pending.delete(message.requestId);
    clearTimeout(request.timer);
    if (message.error !== null || message.info === null) {
      request.reject(
        new Error(message.error ?? "Desktop update status is unavailable."),
      );
    } else {
      request.resolve(message.info);
    }
  };
  port.on("message", onMessage);
  port.on("disconnect", disconnect);
  port.channel?.unref();
  return {
    request(action) {
      if (disconnected)
        return Promise.reject(new Error("The desktop app disconnected."));
      const requestId = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => {
            pending.delete(requestId);
            reject(new Error("The desktop app did not respond."));
          },
          action === "status" ? 15_000 : 180_000,
        );
        pending.set(requestId, { resolve, reject, timer });
        const fail = (error: Error | null): void => {
          if (error === null || !pending.delete(requestId)) return;
          clearTimeout(timer);
          reject(error);
        };
        try {
          send(
            { channel: "bb-desktop-update/request", requestId, action },
            fail,
          );
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      port.off("message", onMessage);
      port.off("disconnect", disconnect);
      disconnect();
      listeners.clear();
    },
  };
}
