import { z } from "zod";

const cdpResponseSchema = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.string().optional(),
    })
    .optional(),
  sessionId: z.string().optional(),
});

const cdpEventSchema = z.object({
  method: z.string(),
  params: z.unknown().optional(),
  sessionId: z.string().optional(),
});

const detachedFromTargetSchema = z.object({ sessionId: z.string() });
const inspectorDetachedSchema = z.object({ reason: z.string() });

type PendingCommand = {
  method: string;
  sessionId: string | undefined;
  timer: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type FailureListener = {
  sessionId: string | undefined;
  notify: (reason: string, scope: "connection" | "session") => void;
};

export type CdpEventHandler = (params: unknown) => void;

export class CdpCommandError extends Error {
  readonly method: string;
  readonly code: number;

  constructor(method: string, code: number, message: string) {
    super(`${method} failed (${code}): ${message}`);
    this.name = "CdpCommandError";
    this.method = method;
    this.code = code;
  }
}

export class CdpTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number, message: string) {
    super(message);
    this.name = "CdpTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class CdpSessionError extends Error {
  readonly method: string;
  readonly sessionId: string;

  constructor(method: string, sessionId: string, reason: string) {
    super(`${reason}; ${method} on session ${sessionId} cannot complete`);
    this.name = "CdpSessionError";
    this.method = method;
    this.sessionId = sessionId;
  }
}

function handlerKey(method: string, sessionId: string | undefined): string {
  return `${sessionId ?? ""}|${method}`;
}

export type CdpSocket = {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "message" | "close" | "error",
    listener: (event: { data?: unknown }) => void,
  ): void;
};

export type CdpConnectionOptions = {
  commandTimeoutMs: number;
};

export class CdpConnection {
  private readonly socket: CdpSocket;
  private readonly commandTimeoutMs: number;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly handlers = new Map<string, Set<CdpEventHandler>>();
  private readonly failureListeners = new Set<FailureListener>();
  private readonly failedSessions = new Map<string, string>();
  private nextId = 0;
  private closedReason: string | null = null;

  constructor(socket: CdpSocket, options: CdpConnectionOptions) {
    this.socket = socket;
    this.commandTimeoutMs = options.commandTimeoutMs;
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

  static async connect(
    webSocketUrl: string,
    options: CdpConnectionOptions & { timeoutMs: number },
  ): Promise<CdpConnection> {
    const socket = new WebSocket(webSocketUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(
          new Error(
            `Timed out after ${options.timeoutMs} ms connecting to ${webSocketUrl}`,
          ),
        );
      }, options.timeoutMs);
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
    return new CdpConnection(socket, {
      commandTimeoutMs: options.commandTimeoutMs,
    });
  }

  get isClosed(): boolean {
    return this.closedReason !== null;
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
    if (sessionId !== undefined) {
      const failure = this.failedSessions.get(sessionId);
      if (failure !== undefined) {
        return Promise.reject(new CdpSessionError(method, sessionId, failure));
      }
    }
    const timeoutMs = options.timeoutMs ?? this.commandTimeoutMs;
    this.nextId += 1;
    const id = this.nextId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(
            new CdpTimeoutError(
              method,
              timeoutMs,
              `${method} did not respond within ${timeoutMs} ms`,
            ),
          );
        }
      }, timeoutMs);
      this.pending.set(id, { method, sessionId, timer, resolve, reject });
      const message =
        sessionId === undefined
          ? { id, method, params }
          : { id, method, params, sessionId };
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  on(method: string, handler: CdpEventHandler, sessionId?: string): () => void {
    const key = handlerKey(method, sessionId);
    let set = this.handlers.get(key);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler);
    return () => {
      const current = this.handlers.get(key);
      current?.delete(handler);
      if (current?.size === 0) {
        this.handlers.delete(key);
      }
    };
  }

  waitForEvent(
    method: string,
    options: { sessionId?: string; timeoutMs: number },
  ): { promise: Promise<unknown>; cancel: () => void } {
    let cancel = () => {};
    const promise = new Promise<unknown>((resolve, reject) => {
      if (this.closedReason !== null) {
        reject(new Error(`${this.closedReason}; cannot wait for ${method}`));
        return;
      }
      if (options.sessionId !== undefined) {
        const failure = this.failedSessions.get(options.sessionId);
        if (failure !== undefined) {
          reject(new CdpSessionError(method, options.sessionId, failure));
          return;
        }
      }
      const cleanup = () => {
        clearTimeout(timer);
        unsubscribe();
        this.failureListeners.delete(failureListener);
      };
      const failureListener: FailureListener = {
        sessionId: options.sessionId,
        notify: (reason, scope) => {
          cleanup();
          reject(
            scope === "session" && options.sessionId !== undefined
              ? new CdpSessionError(method, options.sessionId, reason)
              : new Error(`${reason} while waiting for ${method}`),
          );
        },
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new CdpTimeoutError(
            method,
            options.timeoutMs,
            `Timed out after ${options.timeoutMs} ms waiting for ${method}`,
          ),
        );
      }, options.timeoutMs);
      const unsubscribe = this.on(
        method,
        (params) => {
          cleanup();
          resolve(params);
        },
        options.sessionId,
      );
      this.failureListeners.add(failureListener);
      cancel = cleanup;
    });
    promise.catch(() => undefined);
    return { promise, cancel };
  }

  close(): void {
    this.markClosed("CDP connection closed by client");
    this.socket.close();
  }

  private dispatch(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const response = cdpResponseSchema.safeParse(message);
    if (response.success) {
      const pending = this.pending.get(response.data.id);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(response.data.id);
      clearTimeout(pending.timer);
      if (response.data.error !== undefined) {
        pending.reject(
          new CdpCommandError(
            pending.method,
            response.data.error.code,
            response.data.error.message,
          ),
        );
        return;
      }
      pending.resolve(response.data.result ?? {});
      return;
    }
    const event = cdpEventSchema.safeParse(message);
    if (!event.success) {
      return;
    }
    this.trackSessionLifecycle(
      event.data.method,
      event.data.params,
      event.data.sessionId,
    );
    const handlers = this.handlers.get(
      handlerKey(event.data.method, event.data.sessionId),
    );
    if (handlers === undefined) {
      return;
    }
    for (const handler of [...handlers]) {
      handler(event.data.params ?? {});
    }
  }

  private trackSessionLifecycle(
    method: string,
    params: unknown,
    sessionId: string | undefined,
  ): void {
    if (method === "Inspector.targetCrashed" && sessionId !== undefined) {
      this.failSession(sessionId, "Target crashed");
      return;
    }
    if (method === "Inspector.detached" && sessionId !== undefined) {
      const detached = inspectorDetachedSchema.safeParse(params);
      this.failSession(
        sessionId,
        detached.success
          ? `Target detached (${detached.data.reason})`
          : "Target detached",
      );
      return;
    }
    if (method === "Target.detachedFromTarget") {
      const detached = detachedFromTargetSchema.safeParse(params);
      if (detached.success) {
        this.failSession(detached.data.sessionId, "Target detached");
      }
    }
  }

  private failSession(sessionId: string, reason: string): void {
    if (this.failedSessions.has(sessionId)) {
      return;
    }
    this.failedSessions.set(sessionId, reason);
    for (const [id, pending] of [...this.pending.entries()]) {
      if (pending.sessionId !== sessionId) {
        continue;
      }
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new CdpSessionError(pending.method, sessionId, reason));
    }
    for (const listener of [...this.failureListeners]) {
      if (listener.sessionId === sessionId) {
        listener.notify(reason, "session");
      }
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
    for (const listener of [...this.failureListeners]) {
      listener.notify(reason, "connection");
    }
    this.failureListeners.clear();
  }
}
