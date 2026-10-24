import { z } from "zod";
import WebSocket from "ws";

export { DESKTOP_NOTIFICATION_CLAIM_CHANNEL } from "./desktop-notifications-ipc.js";

const notificationSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  body: z.string(),
  threadId: z.string().nullable(),
  channels: z.array(z.enum(["web", "desktop"])),
  kind: z
    .enum(["needs_input", "failed", "finished", "day2_result"])
    .nullable()
    .optional(),
});
const signalSchema = z.object({
  type: z.literal("plugin-signal"),
  pluginId: z.literal("push-notifications"),
  channel: z.literal("notification"),
  payload: notificationSchema,
});
type NotificationMessage = z.infer<typeof notificationSchema>;

interface NativeNotification {
  once(
    event: "show" | "click" | "close" | "failed",
    callback: () => void,
  ): unknown;
  show(): void;
  close(): void;
}

export function createNotificationClaims() {
  const seen = new Set<string>();
  return (serverUrl: string, id: string): boolean => {
    const key = `${new URL(serverUrl).origin}/${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 1_000) seen.delete(seen.values().next().value!);
    return true;
  };
}

export function createDesktopNotificationDelivery(args: {
  serverUrl: string;
  hasOpenWindows(): boolean;
  isSupported(): boolean;
  claim(serverUrl: string, id: string): boolean;
  createNotification(message: NotificationMessage): NativeNotification;
  openThread(threadId: string | null): void;
  recordSent(kind: "needs_input" | "failed" | "finished" | "day2_result"): void;
}) {
  const active = new Set<NativeNotification>();
  let stopped = false;
  return {
    receive(payload: unknown): void {
      const parsed = signalSchema.safeParse(payload);
      if (!parsed.success || stopped) return;
      const message = parsed.data.payload;
      if (
        !message.channels.includes("desktop") ||
        args.hasOpenWindows() ||
        !args.isSupported() ||
        !args.claim(args.serverUrl, message.id)
      )
        return;
      const notification = args.createNotification(message);
      active.add(notification);
      notification.once("click", () => {
        args.openThread(message.threadId);
        notification.close();
        active.delete(notification);
      });
      notification.once("close", () => active.delete(notification));
      notification.once("failed", () => active.delete(notification));
      notification.show();
      if (message.kind) args.recordSent(message.kind);
    },
    stop(): void {
      stopped = true;
      for (const notification of active) notification.close();
      active.clear();
    },
  };
}

export function connectDesktopNotifications(args: {
  serverUrl: string;
  getCookie(): Promise<string>;
  receive(payload: unknown): void;
}) {
  const url = new URL("/ws", args.serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  let stopped = false;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function reconnect(): void {
    if (stopped || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, 1_000);
  }

  async function connect(): Promise<void> {
    try {
      const cookie = await args.getCookie();
      if (stopped) return;
      const next = new WebSocket(url, {
        headers: { origin: new URL(args.serverUrl).origin, cookie },
        handshakeTimeout: 10_000,
      });
      socket = next;
      next.on("message", (data) => {
        if (stopped) return;
        try {
          args.receive(JSON.parse(data.toString()));
        } catch {
          return;
        }
      });
      next.on("close", reconnect);
      next.on("error", () => next.close());
    } catch {
      reconnect();
    }
  }

  void connect();
  return {
    stop(): void {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      socket?.close();
    },
  };
}
