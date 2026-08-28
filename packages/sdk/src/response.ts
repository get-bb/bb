import { extractErrorMessage } from "@bb/core-ui";
import type { JsonValue } from "@bb/domain";
import { z } from "zod";

export const DEFAULT_BB_REQUEST_TIMEOUT_MS = 75_000;

export type FetchImplementation = typeof fetch;

export interface RequestTimeoutFetchOptions {
  timeoutMs: number;
}

interface RequestTimeoutContext {
  requestSignal: AbortSignal;
  timeoutSignal: AbortSignal;
  timeoutMs: number;
}

type ResponseBodyReader<TBody> = () => Promise<TBody>;

interface ReadResponseBodyWithTimeoutMappingArgs<TBody> {
  context: RequestTimeoutContext;
  read: ResponseBodyReader<TBody>;
}

interface WrapRequestTimeoutResponseArgs {
  context: RequestTimeoutContext;
  response: Response;
}

interface WrapRequestTimeoutBodyArgs {
  context: RequestTimeoutContext;
  stream: ReadableStream<Uint8Array>;
}

export type SdkResponseLike = Pick<
  Response,
  "arrayBuffer" | "headers" | "json" | "ok" | "status" | "statusText" | "text"
>;

export type JsonBodyOf<TResponse> = TResponse extends {
  json(): Promise<infer TBody>;
}
  ? TBody
  : never;

const RESPONSE_BODY_READER_METHODS = new Set<PropertyKey>([
  "arrayBuffer",
  "blob",
  "bytes",
  "formData",
  "json",
  "text",
]);

const ERROR_EXTRACT_OPTS = { legacyKeys: ["detail", "error"] as const };

const errorCauseSchema = z.object({ code: z.string() }).passthrough();
const httpErrorPayloadSchema = z
  .object({ code: z.string().optional() })
  .passthrough();

function formatRequestTimeoutDuration(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;
  if (!Number.isInteger(seconds)) {
    return `${timeoutMs} ms`;
  }
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

export class BbRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `BB request timed out after ${formatRequestTimeoutDuration(timeoutMs)}.`,
    );
    this.name = "BbRequestTimeoutError";
  }
}

export interface BbHttpErrorArgs {
  body: unknown;
  code: string | null;
  message: string;
  status: number;
}

export class BbHttpError extends Error {
  readonly body: unknown;
  readonly code: string | null;
  readonly status: number;

  constructor(args: BbHttpErrorArgs) {
    super(`HTTP ${args.status}: ${args.message}`);
    this.name = "BbHttpError";
    this.body = args.body;
    this.code = args.code;
    this.status = args.status;
  }
}

export function createRequestTimeoutFetch(
  options: RequestTimeoutFetchOptions,
): FetchImplementation {
  validateRequestTimeoutMs(options.timeoutMs);

  return async (input, init) => {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const requestSignal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    const context: RequestTimeoutContext = {
      requestSignal,
      timeoutSignal,
      timeoutMs: options.timeoutMs,
    };

    try {
      const response = await fetch(input, { ...init, signal: requestSignal });
      return wrapRequestTimeoutResponse({ context, response });
    } catch (error) {
      if (
        isRequestTimeoutError(
          context,
          error instanceof Error ? error : null,
          error === context.timeoutSignal.reason,
        )
      ) {
        throw new BbRequestTimeoutError(options.timeoutMs);
      }
      throw error;
    }
  };
}

export async function readJsonResponse<TResponse extends SdkResponseLike>(
  response: Promise<TResponse>,
): Promise<JsonBodyOf<TResponse>> {
  const resolved = await resolveResponse(response);
  return resolved.json();
}

export async function readVoidResponse<TResponse extends SdkResponseLike>(
  response: Promise<TResponse>,
): Promise<void> {
  await resolveResponse(response);
}

export async function resolveResponse<TResponse extends SdkResponseLike>(
  responsePromise: Promise<TResponse>,
): Promise<TResponse> {
  let response: TResponse;
  try {
    response = await responsePromise;
  } catch (error) {
    if (
      error instanceof TypeError &&
      isTypeErrorWithCauseCode(error, "ECONNREFUSED")
    ) {
      throw new Error(
        "Cannot connect to BB server. Ensure it is running and BB_SERVER_URL is correct.",
      );
    }
    throw error;
  }
  if (!response.ok) {
    const { body, code, message } = await readHttpErrorInfo(response);
    throw new BbHttpError({ body, code, message, status: response.status });
  }
  return response;
}

async function readResponseBodyWithTimeoutMapping<TBody>(
  args: ReadResponseBodyWithTimeoutMappingArgs<TBody>,
): Promise<TBody> {
  try {
    return await args.read();
  } catch (error) {
    if (
      isRequestTimeoutError(
        args.context,
        error instanceof Error ? error : null,
        error === args.context.timeoutSignal.reason,
      )
    ) {
      throw new BbRequestTimeoutError(args.context.timeoutMs);
    }
    throw error;
  }
}

function wrapRequestTimeoutResponse(
  args: WrapRequestTimeoutResponseArgs,
): Response {
  const { context, response } = args;
  let body: ReadableStream<Uint8Array> | null | undefined;

  return new Proxy(response, {
    get(target, property) {
      if (RESPONSE_BODY_READER_METHODS.has(property)) {
        const read = getResponseBodyReader(target, property);
        if (read !== undefined) {
          return () => readResponseBodyWithTimeoutMapping({ context, read });
        }
      }

      switch (property) {
        case "body":
          if (target.body === null) {
            return null;
          }
          body ??= wrapRequestTimeoutBody({
            context,
            stream: target.body,
          });
          return body;
        case "clone":
          return () =>
            wrapRequestTimeoutResponse({
              context,
              response: target.clone(),
            });
        default: {
          return getResponseProperty(target, property);
        }
      }
    },
  });
}

type ResponseBodyValue =
  | ArrayBuffer
  | Blob
  | Uint8Array
  | object
  | string
  | JsonValue;
type ResponseBodyMethod = () => Promise<ResponseBodyValue>;

function getResponseBodyReader(
  target: Response,
  property: PropertyKey,
): ResponseBodyMethod | undefined {
  switch (property) {
    case "arrayBuffer":
      return () => target.arrayBuffer();
    case "blob":
      return () => target.blob();
    case "bytes":
      return () => target.bytes();
    case "formData":
      return () => target.formData();
    case "json":
      return () => target.json();
    case "text":
      return () => target.text();
    default:
      return undefined;
  }
}

type ResponseDataProperty =
  | "type"
  | "url"
  | "redirected"
  | "status"
  | "ok"
  | "statusText"
  | "headers"
  | "body"
  | "bodyUsed";

function getResponseProperty(
  target: Response,
  property: PropertyKey,
): Response[ResponseDataProperty] | undefined {
  switch (property) {
    case "type":
      return target.type;
    case "url":
      return target.url;
    case "redirected":
      return target.redirected;
    case "status":
      return target.status;
    case "ok":
      return target.ok;
    case "statusText":
      return target.statusText;
    case "headers":
      return target.headers;
    case "body":
      return target.body;
    case "bodyUsed":
      return target.bodyUsed;
    default:
      return undefined;
  }
}

function wrapRequestTimeoutBody(
  args: WrapRequestTimeoutBodyArgs,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const getReader = () => {
    reader ??= args.stream.getReader();
    return reader;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await getReader().read();
        if (result.done) {
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        if (
          isRequestTimeoutError(
            args.context,
            error instanceof Error ? error : null,
            error === args.context.timeoutSignal.reason,
          )
        ) {
          controller.error(new BbRequestTimeoutError(args.context.timeoutMs));
          return;
        }
        controller.error(error);
      }
    },
    cancel(reason) {
      return getReader().cancel(reason);
    },
  });
}

function isRequestTimeoutError(
  context: RequestTimeoutContext,
  error: Error | null,
  matchesTimeoutReason: boolean,
): boolean {
  return (
    (context.timeoutSignal.aborted && matchesTimeoutReason) ||
    (context.timeoutSignal.aborted &&
      context.requestSignal.reason === context.timeoutSignal.reason &&
      error !== null &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function validateRequestTimeoutMs(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(
      "BB request timeout must be a non-negative finite number.",
    );
  }
}

function isTypeErrorWithCauseCode(
  error: TypeError,
  expectedCode: string,
): boolean {
  const cause = errorCauseSchema.safeParse(error.cause);
  return cause.success && cause.data.code === expectedCode;
}

interface HttpErrorInfo {
  body: unknown;
  code: string | null;
  message: string;
}

function readHttpErrorCode(
  parsed: z.infer<typeof httpErrorPayloadSchema>,
): string | null {
  return parsed.code ?? null;
}

async function readHttpErrorInfo(
  response: SdkResponseLike,
): Promise<HttpErrorInfo> {
  let rawBody: string;
  try {
    rawBody = await response.text();
  } catch (error) {
    if (error instanceof BbRequestTimeoutError) {
      throw error;
    }
    rawBody = "";
  }
  const normalized = rawBody.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return { body: null, code: null, message: response.statusText };
  }

  const contentType = response.headers.get("content-type");
  const shouldParseJson =
    (contentType?.includes("application/json") ?? false) ||
    normalized.startsWith("{") ||
    normalized.startsWith("[");
  if (!shouldParseJson) {
    const message = normalized.startsWith("<")
      ? response.statusText || `Request failed with status ${response.status}`
      : normalized;
    return { body: null, code: null, message };
  }

  try {
    const parsed: unknown = JSON.parse(normalized);
    const parsedPayload = httpErrorPayloadSchema.safeParse(parsed);
    return {
      body: parsed,
      code: parsedPayload.success
        ? readHttpErrorCode(parsedPayload.data)
        : null,
      message: extractErrorMessage(parsed, ERROR_EXTRACT_OPTS) ?? normalized,
    };
  } catch {
    return { body: null, code: null, message: normalized };
  }
}
