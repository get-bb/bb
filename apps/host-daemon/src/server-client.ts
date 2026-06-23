import pRetry, { AbortError } from "p-retry";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  hostDaemonEventBatchResponseSchema,
  hostDaemonInteractiveInterruptResponseSchema,
  hostDaemonInteractiveRequestResponseSchema,
  hostDaemonSessionOpenResponseSchema,
  hostDaemonToolCallResponseSchema,
  type HostDaemonInteractiveInterruptResponse,
  type HostDaemonInteractiveRequestResponse,
  type HostDaemonActiveThread,
  type HostDaemonEventBatchRequest,
  type HostDaemonEventEnvelope,
  type HostDaemonInteractiveInterruptRequest,
  type HostDaemonInteractiveRequest,
  type HostDaemonLoadedEnvironment,
  type HostDaemonProjectAttachmentContentQuery,
  type HostDaemonSessionOpenRequest,
  type HostDaemonSessionOpenResponse,
  type HostDaemonToolCallRequest,
  type HostDaemonToolCallResponse,
} from "@bb/host-daemon-contract";
import type { PendingInteractionCreate, ToolCallRequest } from "@bb/domain";
import type { HostDaemonLogger } from "./logger.js";
import type { EventPostResult } from "./event-sink.js";
import { runtimeErrorLogFields } from "./error-utils.js";
import type {
  FetchedProjectAttachment,
  FetchProjectAttachmentArgs,
} from "./project-attachments.js";

interface JsonRecord {
  readonly [key: string]: unknown;
}

interface ApiErrorResponseBody {
  code: string;
  message: string;
  retryable?: boolean;
}

interface ServerResponseErrorArgs {
  action: string;
  bodyMessage: string | null;
  code: string | null;
  retryable: boolean;
  status: number;
  statusText: string;
}

export class ServerResponseError extends Error {
  readonly action: string;
  readonly bodyMessage: string | null;
  readonly code: string | null;
  readonly retryable: boolean;
  readonly status: number;
  readonly statusText: string;

  constructor(args: ServerResponseErrorArgs) {
    const detail = args.bodyMessage ? ` - ${args.bodyMessage}` : "";
    super(
      `Failed to ${args.action}: ${args.status} ${args.statusText}${detail}`,
    );
    this.name = "ServerResponseError";
    this.action = args.action;
    this.bodyMessage = args.bodyMessage;
    this.code = args.code;
    this.retryable = args.retryable;
    this.status = args.status;
    this.statusText = args.statusText;
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toJsonRecord(value: unknown): JsonRecord | null {
  return isJsonRecord(value) ? value : null;
}

function parseApiErrorResponseBody(text: string): ApiErrorResponseBody | null {
  if (text.trim() === "") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const record = toJsonRecord(parsed);
  if (
    !record ||
    typeof record.code !== "string" ||
    typeof record.message !== "string"
  ) {
    return null;
  }

  if (typeof record.retryable === "boolean") {
    return {
      code: record.code,
      message: record.message,
      retryable: record.retryable,
    };
  }

  return {
    code: record.code,
    message: record.message,
  };
}

async function readApiErrorResponseBody(
  response: Response,
): Promise<ApiErrorResponseBody | null> {
  try {
    return parseApiErrorResponseBody(await response.text());
  } catch {
    return null;
  }
}

function defaultRetryableForStatus(status: number): boolean {
  return status < 400 || status >= 500;
}

function toRetryControlError(error: ServerResponseError): Error {
  return error.retryable ? error : new AbortError(error);
}

// The client only ever calls fetchFn(url, init); it never uses fetch.preconnect.
// Typing the dependency as fetch's call signature (not `typeof fetch`) keeps it
// precise and lets plain function / vi.fn mocks satisfy it.
export type FetchFn = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

interface CreateServerClientOptions {
  serverUrl: string;
  hostKey: string;
  logger: HostDaemonLogger;
  getSessionId: () => string;
  /** Runs before each POST attempt so retryable ordering preconditions can be repaired. */
  beforeInteractiveRequestRegistrationAttempt?: () => Promise<void>;
  fetchFn?: FetchFn;
}

interface OpenSessionArgs {
  hostId: string;
  hostName: string;
  hostType: HostDaemonSessionOpenRequest["hostType"];
  dataDir: string;
  instanceId: string;
  activeThreads: HostDaemonActiveThread[] | Promise<HostDaemonActiveThread[]>;
  loadedEnvironments:
    | HostDaemonLoadedEnvironment[]
    | Promise<HostDaemonLoadedEnvironment[]>;
}

export interface ServerClient {
  openSession(args: OpenSessionArgs): Promise<HostDaemonSessionOpenResponse>;
  fetchProjectAttachment(
    args: FetchProjectAttachmentArgs,
  ): Promise<FetchedProjectAttachment>;
  postEvents(events: HostDaemonEventEnvelope[]): Promise<EventPostResult>;
  callTool(request: ToolCallRequest): Promise<HostDaemonToolCallResponse>;
  registerInteractiveRequest(
    request: PendingInteractionCreate,
  ): Promise<HostDaemonInteractiveRequestResponse>;
  interruptInteractiveRequests(args: {
    providerId: string;
    reason: string;
    threadIds: readonly string[];
  }): Promise<HostDaemonInteractiveInterruptResponse>;
}

const INTERACTIVE_REQUEST_REGISTRATION_RETRIES = 5;

function usesSecureInternalFetchTransport(serverUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") {
    return true;
  }

  return (
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "::1"
  );
}

function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function validateProjectAttachmentPartialByteLength(
  args: FetchProjectAttachmentArgs,
  byteLength: number,
): void {
  if (
    args.expectedSizeBytes !== undefined &&
    byteLength > args.expectedSizeBytes
  ) {
    throw new Error(
      `Project attachment size mismatch: expected ${args.expectedSizeBytes} bytes, received more than ${args.expectedSizeBytes}`,
    );
  }
  if (byteLength > args.maxBytes) {
    throw new Error(
      `Project attachment exceeds ${args.maxBytes} byte limit: received ${byteLength}`,
    );
  }
}

function validateProjectAttachmentFinalByteLength(
  args: FetchProjectAttachmentArgs,
  byteLength: number,
): void {
  if (
    args.expectedSizeBytes !== undefined &&
    byteLength !== args.expectedSizeBytes
  ) {
    throw new Error(
      `Project attachment size mismatch: expected ${args.expectedSizeBytes} bytes, received ${byteLength}`,
    );
  }
  validateProjectAttachmentPartialByteLength(args, byteLength);
}

async function readProjectAttachmentBytes(
  response: Response,
  args: FetchProjectAttachmentArgs,
): Promise<Uint8Array> {
  if (!response.body) {
    validateProjectAttachmentFinalByteLength(args, 0);
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    totalBytes += result.value.byteLength;
    validateProjectAttachmentPartialByteLength(args, totalBytes);
    chunks.push(result.value);
  }

  validateProjectAttachmentFinalByteLength(args, totalBytes);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createServerClient(
  options: CreateServerClientOptions,
): ServerClient {
  const fetchFn = options.fetchFn ?? fetch;

  function requireSessionId(): string {
    const sessionId = options.getSessionId();
    if (!sessionId) {
      throw new Error("Server session is not open");
    }
    return sessionId;
  }

  function headers(): HeadersInit {
    return {
      authorization: `Bearer ${options.hostKey}`,
      "content-type": "application/json",
    };
  }

  function buildInternalUrl(
    pathname: string,
    query?: Record<string, string | undefined>,
  ): string {
    const url = new URL(`/internal${pathname}`, options.serverUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  async function createResponseError(
    action: string,
    response: Response,
  ): Promise<ServerResponseError> {
    const body = await readApiErrorResponseBody(response);
    return new ServerResponseError({
      action,
      bodyMessage: body?.message ?? null,
      code: body?.code ?? null,
      retryable: body?.retryable ?? defaultRetryableForStatus(response.status),
      status: response.status,
      statusText: response.statusText,
    });
  }

  return {
    async openSession(
      args: OpenSessionArgs,
    ): Promise<HostDaemonSessionOpenResponse> {
      const payload: HostDaemonSessionOpenRequest = {
        hostId: args.hostId,
        instanceId: args.instanceId,
        hostName: args.hostName,
        hostType: args.hostType,
        dataDir: args.dataDir,
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        activeThreads: await args.activeThreads,
        loadedEnvironments: await args.loadedEnvironments,
      };
      const response = await fetchFn(buildInternalUrl("/session/open"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload),
      });

      if (response.status !== 201) {
        throw await createResponseError("open session", response);
      }

      return hostDaemonSessionOpenResponseSchema.parse(await response.json());
    },

    async fetchProjectAttachment(
      args: FetchProjectAttachmentArgs,
    ): Promise<FetchedProjectAttachment> {
      if (!usesSecureInternalFetchTransport(options.serverUrl)) {
        throw new AbortError(
          `Refusing to fetch project attachment over insecure server URL: ${options.serverUrl}`,
        );
      }

      const query: HostDaemonProjectAttachmentContentQuery = {
        sessionId: requireSessionId(),
        threadId: args.threadId,
        projectId: args.projectId,
        path: args.path,
      };
      const response = await fetchFn(
        buildInternalUrl("/session/project-attachment-content", query),
        {
          method: "GET",
          headers: headers(),
        },
      );

      if (!response.ok) {
        throw await createResponseError("fetch project attachment", response);
      }

      const contentLength = parseContentLength(
        response.headers.get("content-length"),
      );
      if (contentLength !== null) {
        validateProjectAttachmentFinalByteLength(args, contentLength);
      }

      const bytes = await readProjectAttachmentBytes(response, args);
      return {
        bytes,
      };
    },

    async postEvents(
      events: HostDaemonEventEnvelope[],
    ): Promise<EventPostResult> {
      const payload: HostDaemonEventBatchRequest = {
        sessionId: requireSessionId(),
        events,
      };
      const response = await fetchFn(buildInternalUrl("/session/events"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw await createResponseError("post events", response);
      }

      const json = await response.json();
      const parsed = hostDaemonEventBatchResponseSchema.parse(json);
      return {
        acceptedEvents: parsed.acceptedEvents,
        kind: "accepted",
        rejectedEvents: parsed.rejectedEvents,
      };
    },

    async callTool(
      request: ToolCallRequest,
    ): Promise<HostDaemonToolCallResponse> {
      const payload: HostDaemonToolCallRequest = {
        threadId: request.threadId,
        providerThreadId: request.providerThreadId,
        turnId: request.turnId,
        callId: request.callId,
        tool: request.tool,
        ...(request.arguments !== undefined
          ? { arguments: request.arguments }
          : {}),
        sessionId: requireSessionId(),
      };
      const response = await fetchFn(buildInternalUrl("/session/tool-call"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw await createResponseError("call tool", response);
      }

      return hostDaemonToolCallResponseSchema.parse(await response.json());
    },

    async registerInteractiveRequest(
      request: PendingInteractionCreate,
    ): Promise<HostDaemonInteractiveRequestResponse> {
      return pRetry(
        async () => {
          await options.beforeInteractiveRequestRegistrationAttempt?.();
          const payload: HostDaemonInteractiveRequest = {
            sessionId: requireSessionId(),
            interaction: request,
          };
          const response = await fetchFn(
            buildInternalUrl("/session/interactive-request"),
            {
              method: "POST",
              headers: headers(),
              body: JSON.stringify(payload),
            },
          );

          if (!response.ok) {
            throw toRetryControlError(
              await createResponseError(
                "register interactive request",
                response,
              ),
            );
          }

          return hostDaemonInteractiveRequestResponseSchema.parse(
            await response.json(),
          );
        },
        {
          retries: INTERACTIVE_REQUEST_REGISTRATION_RETRIES,
          minTimeout: 100,
          maxTimeout: 2_000,
          randomize: true,
          onFailedAttempt(context): void {
            options.logger.warn(
              {
                attempt: context.attemptNumber,
                retriesLeft: context.retriesLeft,
                ...runtimeErrorLogFields(context),
              },
              "interactive request registration failed, retrying",
            );
          },
        },
      );
    },

    async interruptInteractiveRequests(
      args,
    ): Promise<HostDaemonInteractiveInterruptResponse> {
      const payload: HostDaemonInteractiveInterruptRequest = {
        sessionId: requireSessionId(),
        providerId: args.providerId,
        threadIds: [...args.threadIds],
        reason: args.reason,
      };
      const response = await fetchFn(
        buildInternalUrl("/session/interactive-request/interrupt"),
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw await createResponseError(
          "interrupt interactive requests",
          response,
        );
      }

      return hostDaemonInteractiveInterruptResponseSchema.parse(
        await response.json(),
      );
    },
  };
}
