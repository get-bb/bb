import { z } from "zod";

const CONNECT_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 120_000;

const cdpResponseSchema = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

const cdpEventSchema = z.object({
  method: z.string(),
  params: z.unknown().optional(),
  sessionId: z.string().optional(),
});

type PendingCommand = {
  method: string;
  timer: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type CdpEventHandler = (params: unknown) => void;

export class CdpCommandError extends Error {}

export type CdpSocket = {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "message" | "close" | "error",
    listener: (event: { data?: unknown }) => void,
  ): void;
};

function handlerKey(method: string, sessionId: string | undefined): string {
  return `${sessionId ?? ""}|${method}`;
}

export class CdpConnection {
  private readonly socket: CdpSocket;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly handlers = new Map<string, Set<CdpEventHandler>>();
  private nextId = 0;
  private closedReason: string | null = null;

  constructor(socket: CdpSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        this.dispatch(event.data);
      }
    });
    socket.addEventListener("close", () => {
      this.markClosed("CDP connection closed");
    });
    socket.addEventListener("error", () => {
      this.markClosed("CDP connection errored");
    });
  }

  static async connect(webSocketUrl: string): Promise<CdpConnection> {
    const socket = new WebSocket(webSocketUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(
          new Error(
            `Timed out after ${CONNECT_TIMEOUT_MS} ms connecting to ${webSocketUrl}`,
          ),
        );
      }, CONNECT_TIMEOUT_MS);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error(`Failed to connect to ${webSocketUrl}`));
        },
        { once: true },
      );
    });
    return new CdpConnection(socket);
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    options: { timeoutMs?: number } = {},
  ): Promise<unknown> {
    if (this.closedReason !== null) {
      return Promise.reject(
        new Error(`${this.closedReason}; cannot send ${method}`),
      );
    }
    const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
    this.nextId += 1;
    const id = this.nextId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} did not respond within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { method, timer, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(method: string, handler: CdpEventHandler, sessionId?: string): () => void {
    const key = handlerKey(method, sessionId);
    const set = this.handlers.get(key) ?? new Set();
    set.add(handler);
    this.handlers.set(key, set);
    return () => {
      set.delete(handler);
    };
  }

  waitForEvent(
    method: string,
    sessionId: string,
    timeoutMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(`Timed out after ${timeoutMs} ms waiting for ${method}`),
        );
      }, timeoutMs);
      const unsubscribe = this.on(
        method,
        (params) => {
          clearTimeout(timer);
          unsubscribe();
          resolve(params);
        },
        sessionId,
      );
    });
  }

  close(): void {
    this.markClosed("CDP connection closed by client");
    this.socket.close();
  }

  private dispatch(raw: string): void {
    const message: unknown = JSON.parse(raw);
    const response = cdpResponseSchema.safeParse(message);
    if (response.success) {
      const pending = this.pending.get(response.data.id);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(response.data.id);
      clearTimeout(pending.timer);
      const { error } = response.data;
      if (error === undefined) {
        pending.resolve(response.data.result ?? {});
      } else {
        pending.reject(
          new CdpCommandError(
            `${pending.method} failed (${error.code}): ${error.message}`,
          ),
        );
      }
      return;
    }
    const event = cdpEventSchema.safeParse(message);
    if (!event.success) {
      return;
    }
    const handlers = this.handlers.get(
      handlerKey(event.data.method, event.data.sessionId),
    );
    for (const handler of [...(handlers ?? [])]) {
      handler(event.data.params ?? {});
    }
  }

  private markClosed(reason: string): void {
    if (this.closedReason !== null) {
      return;
    }
    this.closedReason = reason;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error(`${reason} while waiting for ${pending.method}`),
      );
    }
    this.pending.clear();
  }
}
