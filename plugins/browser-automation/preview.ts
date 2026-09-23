import { z } from "zod";
import type { PreviewFrame, PreviewSize } from "./contracts.js";

const messageSchema = z.object({
  id: z.number().int().optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
  sessionId: z.string().optional(),
});
const targetInfoSchema = z.object({
  targetId: z.string(),
  type: z.string(),
  url: z.string(),
  title: z.string(),
});
const targetEventSchema = z.object({ targetInfo: targetInfoSchema });
const targetDestroyedSchema = z.object({ targetId: z.string() });
const detachedSchema = z.object({ sessionId: z.string() });
const attachedSchema = z.object({ sessionId: z.string() });
const screencastFrameSchema = z.object({
  data: z.string().min(1),
  sessionId: z.number().int(),
  metadata: z.object({
    deviceWidth: z.number().positive(),
    deviceHeight: z.number().positive(),
  }),
});

const maxFrameChars = 700_000;
const frameEdge: Record<PreviewSize, number> = { thumbnail: 800, full: 1280 };
const blankUrls = new Set(["", "about:blank"]);

const socketOpen = 1;

export interface PreviewSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "close" | "error",
    listener: () => void,
  ): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
}

export interface PreviewSource {
  next(
    afterSequence: number,
    waitMs: number,
    signal: AbortSignal,
    size: PreviewSize,
  ): Promise<PreviewFrame | null>;
  close(): void;
}

export function createPreview(
  connectionUrl: string,
  timing = {
    frameIntervalMs: 250,
    idleMs: 15_000,
    reconnectMs: 1_000,
    fullSizeHoldMs: 10_000,
    settleMs: 1_000,
  },
  openSocket: (url: string) => PreviewSocket = (url) => new WebSocket(url),
): PreviewSource {
  const targets = new Map<
    string,
    { url: string; title: string; activity: number }
  >();
  const calls = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  const waiters = new Set<{ check(): void; fail(error: Error): void }>();
  let socket: PreviewSocket | null = null;
  let cast: { targetId: string; sessionId: string; edge: number } | null = null;
  let fullSizeUntil = 0;
  let selection: Promise<void> = Promise.resolve();
  let latest: PreviewFrame | null = null;
  let sequence = 0;
  let nextCallId = 0;
  let activityClock = 0;
  let lastConnectAt = 0;
  let nextAckAt = 0;
  let idleTimer: NodeJS.Timeout | null = null;
  let settleTimer: NodeJS.Timeout | null = null;
  let closed = false;

  function send(
    connection: PreviewSocket,
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> {
    if (connection !== socket || connection.readyState !== socketOpen)
      return Promise.reject(new Error("Browser preview connection closed"));
    const id = ++nextCallId;
    return new Promise((resolve, reject) => {
      calls.set(id, { resolve, reject });
      connection.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId === undefined ? {} : { sessionId }),
        }),
      );
    });
  }

  function disconnect() {
    const connection = socket;
    socket = null;
    cast = null;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    targets.clear();
    for (const call of calls.values())
      call.reject(new Error("Browser preview connection closed"));
    calls.clear();
    if (connection && connection.readyState <= socketOpen) connection.close();
  }

  function bestTarget(): string | null {
    let best: { targetId: string; rank: number; activity: number } | null =
      null;
    for (const [targetId, target] of targets) {
      const rank = blankUrls.has(target.url) ? 0 : 1;
      if (
        !best ||
        rank > best.rank ||
        (rank === best.rank && target.activity > best.activity)
      )
        best = { targetId, rank, activity: target.activity };
    }
    return best?.targetId ?? null;
  }

  function select(connection: PreviewSocket) {
    selection = selection
      .then(async () => {
        if (connection !== socket) return;
        const targetId = bestTarget();
        const edge =
          Date.now() < fullSizeUntil ? frameEdge.full : frameEdge.thumbnail;
        if (
          targetId === (cast?.targetId ?? null) &&
          (cast === null || cast.edge === edge)
        )
          return;
        let sessionId: string;
        if (cast && cast.targetId === targetId) {
          sessionId = cast.sessionId;
          await send(connection, "Page.stopScreencast", {}, sessionId);
        } else {
          const previous = cast;
          cast = null;
          if (previous)
            await send(connection, "Target.detachFromTarget", {
              sessionId: previous.sessionId,
            }).catch(() => {});
          if (targetId === null) return;
          sessionId = attachedSchema.parse(
            await send(connection, "Target.attachToTarget", {
              targetId,
              flatten: true,
            }),
          ).sessionId;
        }
        cast = { targetId, sessionId, edge };
        await send(
          connection,
          "Page.startScreencast",
          {
            format: "jpeg",
            quality: 60,
            maxWidth: edge,
            maxHeight: edge,
            everyNthFrame: 1,
          },
          sessionId,
        );
      })
      .catch(() => {
        if (connection === socket) disconnect();
      });
  }

  function observe(
    connection: PreviewSocket,
    info: z.infer<typeof targetInfoSchema>,
  ) {
    if (info.type !== "page") return;
    const known = targets.get(info.targetId);
    if (known && known.url === info.url && known.title === info.title) return;
    targets.set(info.targetId, {
      url: info.url,
      title: info.title,
      activity:
        known && known.url === info.url ? known.activity : ++activityClock,
    });
    if (latest && cast?.targetId === info.targetId) {
      latest = {
        ...latest,
        sequence: ++sequence,
        url: info.url.slice(0, 2_000),
        title: info.title.slice(0, 300),
      };
      for (const waiter of [...waiters]) waiter.check();
    }
    select(connection);
  }

  function receive(connection: PreviewSocket, raw: string) {
    const message = messageSchema.parse(JSON.parse(raw));
    if (message.id !== undefined) {
      const call = calls.get(message.id);
      calls.delete(message.id);
      if (message.error) call?.reject(new Error(message.error.message));
      else call?.resolve(message.result);
      return;
    }
    if (
      message.method === "Target.targetCreated" ||
      message.method === "Target.targetInfoChanged" ||
      message.method === "Target.attachedToTarget"
    ) {
      observe(connection, targetEventSchema.parse(message.params).targetInfo);
    } else if (message.method === "Target.targetDestroyed") {
      const { targetId } = targetDestroyedSchema.parse(message.params);
      targets.delete(targetId);
      if (cast?.targetId === targetId) cast = null;
      select(connection);
    } else if (message.method === "Target.detachedFromTarget") {
      const { sessionId } = detachedSchema.parse(message.params);
      if (cast?.sessionId !== sessionId) return;
      cast = null;
      select(connection);
    } else if (message.method === "Page.screencastFrame") {
      const sessionId = message.sessionId;
      if (sessionId === undefined || sessionId !== cast?.sessionId) return;
      const frame = screencastFrameSchema.parse(message.params);
      const target = targets.get(cast.targetId);
      if (frame.data.length <= maxFrameChars) {
        latest = {
          sequence: ++sequence,
          mimeType: "image/jpeg",
          data: frame.data,
          width: frame.metadata.deviceWidth,
          height: frame.metadata.deviceHeight,
          url: (target?.url ?? "").slice(0, 2_000),
          title: (target?.title ?? "").slice(0, 300),
        };
        for (const waiter of [...waiters]) waiter.check();
      }
      const targetId = cast.targetId;
      const refresh = () =>
        void send(connection, "Target.getTargetInfo", { targetId })
          .then((result) => {
            if (connection === socket)
              observe(connection, targetEventSchema.parse(result).targetInfo);
          })
          .catch(() => {});
      refresh();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(refresh, timing.settleMs);
      settleTimer.unref();
      const ackAt = Math.max(Date.now(), nextAckAt) + timing.frameIntervalMs;
      nextAckAt = ackAt;
      const ack = setTimeout(() => {
        void send(
          connection,
          "Page.screencastFrameAck",
          { sessionId: frame.sessionId },
          sessionId,
        ).catch(() => {});
      }, ackAt - Date.now());
      ack.unref();
    }
  }

  function connect() {
    if (closed || socket || Date.now() - lastConnectAt < timing.reconnectMs)
      return;
    lastConnectAt = Date.now();
    const connection = openSocket(connectionUrl);
    socket = connection;
    connection.addEventListener("open", () => {
      send(connection, "Target.setDiscoverTargets", { discover: true }).catch(
        () => {
          if (connection === socket) disconnect();
        },
      );
    });
    connection.addEventListener("message", (event) => {
      if (connection !== socket || typeof event.data !== "string") return;
      try {
        receive(connection, event.data);
      } catch {
        disconnect();
      }
    });
    const drop = () => {
      if (connection === socket) disconnect();
    };
    connection.addEventListener("close", drop);
    connection.addEventListener("error", drop);
  }

  function touch() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (waiters.size > 0) touch();
      else disconnect();
    }, timing.idleMs);
    idleTimer.unref();
  }

  return {
    next(afterSequence, waitMs, signal, size) {
      signal.throwIfAborted();
      if (closed)
        return Promise.reject(
          new Error("Browser session stopped; open a new session"),
        );
      touch();
      connect();
      if (size === "full") fullSizeUntil = Date.now() + timing.fullSizeHoldMs;
      if (socket) select(socket);
      const ready = () =>
        latest && (latest.sequence > afterSequence || afterSequence > sequence)
          ? latest
          : null;
      const immediate = ready();
      if (immediate) return Promise.resolve(immediate);
      return new Promise((resolve, reject) => {
        const settle = (finish: () => void) => {
          waiters.delete(waiter);
          clearTimeout(timeout);
          clearInterval(reconnect);
          signal.removeEventListener("abort", abort);
          finish();
        };
        const waiter = {
          check() {
            const frame = ready();
            if (frame) settle(() => resolve(frame));
          },
          fail(error: Error) {
            settle(() => reject(error));
          },
        };
        const abort = () => waiter.fail(new Error("Browser preview cancelled"));
        const timeout = setTimeout(() => settle(() => resolve(null)), waitMs);
        const reconnect = setInterval(connect, timing.reconnectMs);
        timeout.unref();
        reconnect.unref();
        waiters.add(waiter);
        signal.addEventListener("abort", abort, { once: true });
      });
    },
    close() {
      if (closed) return;
      closed = true;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      disconnect();
      for (const waiter of [...waiters])
        waiter.fail(new Error("Browser session stopped; open a new session"));
    },
  };
}
