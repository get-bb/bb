import {
  client,
  RequestError,
  type AgentRequestMethod,
  type AgentRequestParamsByMethod,
  type AgentRequestResponsesByMethod,
  type ClientConnection,
} from "@agentclientprotocol/sdk";
import type { Readable, Writable } from "node:stream";
import { isJsonObject, readString } from "../session/decode.js";
import type { AcpJsonObject } from "../session/session-types.js";
import {
  createAcpMessageStream,
  type AcpDiscardReason,
} from "./message-stream.js";

export const ACP_AUTH_REQUIRED_CODE = -32000;
export const ACP_RESOURCE_NOT_FOUND_CODE = -32002;
export const ACP_REQUEST_CANCELLED_CODE = -32800;

export interface AcpSessionUpdateNotification {
  sessionId: string;
  update: unknown;
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: AcpJsonObject;
  options: AcpPermissionOption[];
  title?: string;
  description?: string;
}

export interface AcpRequestContext {
  signal: AbortSignal;
}

export type AcpInboundRequestHandler = (
  params: unknown,
  context: AcpRequestContext,
) => unknown;

export interface AcpClientHandlers {
  sessionUpdate(notification: AcpSessionUpdateNotification): void;
  requests?: Readonly<Record<string, AcpInboundRequestHandler>>;
  notifications?: Readonly<Record<string, (params: unknown) => void>>;
  anyNotification?(method: string, params: unknown): void;
  discarded?(reason: AcpDiscardReason | "malformed-update", line: string): void;
}

export interface AcpClientOptions {
  input: Readable;
  output: Writable;
  requestTimeoutMs: number | null;
  closeOnInputEnd: boolean;
  handlers: AcpClientHandlers;
}

export interface AcpRequestOptions {
  timeoutMs?: number | null;
}

export interface AcpClient {
  request<Method extends AgentRequestMethod>(
    method: Method,
    params: AgentRequestParamsByMethod[Method],
    options?: AcpRequestOptions,
  ): Promise<AgentRequestResponsesByMethod[Method]>;
  extensionRequest(
    method: string,
    params: unknown,
    options?: AcpRequestOptions,
  ): Promise<unknown>;
  notify(method: string, params: unknown): Promise<void>;
  close(reason?: Error): void;
  readonly closed: Promise<void>;
}

export class AcpRequestTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`ACP agent did not answer ${method} within ${timeoutMs} ms`);
    this.name = "AcpRequestTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export function acpErrorCode(error: unknown): number | undefined {
  return error instanceof RequestError ? error.code : undefined;
}

export function decodeAcpPermissionRequest(
  params: unknown,
): AcpPermissionRequest {
  if (!isJsonObject(params)) {
    throw RequestError.invalidParams();
  }
  const sessionId = readString(params, "sessionId");
  const rawOptions = params["options"];
  if (sessionId === undefined || !Array.isArray(rawOptions)) {
    throw RequestError.invalidParams();
  }
  const options: AcpPermissionOption[] = [];
  for (const entry of rawOptions) {
    if (!isJsonObject(entry)) {
      continue;
    }
    const optionId = readString(entry, "optionId");
    if (optionId === undefined) {
      continue;
    }
    options.push({
      optionId,
      name: readString(entry, "name") ?? optionId,
      kind: readString(entry, "kind") ?? "",
    });
  }
  const subject = params["subject"];
  const subjectToolCall =
    isJsonObject(subject) && isJsonObject(subject["toolCall"])
      ? subject["toolCall"]
      : undefined;
  const toolCall = isJsonObject(params["toolCall"])
    ? params["toolCall"]
    : (subjectToolCall ?? {});
  const title = readString(params, "title");
  const description = readString(params, "description");
  return {
    sessionId,
    toolCall,
    options,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

export function connectAcpClient(options: AcpClientOptions): AcpClient {
  const { handlers } = options;
  const discarded = handlers.discarded ?? (() => {});

  const stream = createAcpMessageStream({
    input: options.input,
    output: options.output,
    closeOnInputEnd: options.closeOnInputEnd,
    onDiscard: discarded,
    ...(handlers.anyNotification
      ? { onNotification: handlers.anyNotification }
      : {}),
    onSessionUpdate(params) {
      if (!isJsonObject(params)) {
        discarded("malformed-update", JSON.stringify(params ?? null));
        return;
      }
      const sessionId = readString(params, "sessionId");
      if (sessionId === undefined) {
        discarded("malformed-update", JSON.stringify(params));
        return;
      }
      handlers.sessionUpdate({ sessionId, update: params["update"] });
    },
  });

  const app = client({ name: "bb" });
  for (const [method, handler] of Object.entries(handlers.requests ?? {})) {
    app.onRequest(
      method,
      (params: unknown) => params,
      async ({ params, signal }) => (await handler(params, { signal })) ?? null,
    );
  }
  for (const [method, handler] of Object.entries(
    handlers.notifications ?? {},
  )) {
    app.onNotification(
      method,
      (params: unknown) => params,
      ({ params }) => handler(params),
    );
  }

  const connection: ClientConnection = app.connect(stream);

  async function withDeadline<Result>(
    method: string,
    requestOptions: AcpRequestOptions | undefined,
    send: (cancellationSignal: AbortSignal | undefined) => Promise<Result>,
  ): Promise<Result> {
    const timeoutMs =
      requestOptions?.timeoutMs === undefined
        ? options.requestTimeoutMs
        : requestOptions.timeoutMs;
    if (timeoutMs === null) {
      return send(undefined);
    }
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AcpRequestTimeoutError(method, timeoutMs));
      }, timeoutMs);
    });
    try {
      return await Promise.race([send(controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    request(method, params, requestOptions) {
      return withDeadline(method, requestOptions, (cancellationSignal) =>
        connection.agent.request(
          method,
          params,
          cancellationSignal ? { cancellationSignal } : undefined,
        ),
      );
    },

    extensionRequest(method, params, requestOptions) {
      return withDeadline(method, requestOptions, (cancellationSignal) =>
        connection.agent.request<unknown, unknown>(
          method,
          params,
          cancellationSignal ? { cancellationSignal } : undefined,
        ),
      );
    },

    notify(method, params) {
      return connection.agent.notify(method, params);
    },

    close(reason) {
      connection.close(reason);
    },

    closed: connection.closed,
  };
}
