import { createApiClient, type ApiClient } from "@bb/server-contract";
import { extractErrorMessage } from "@bb/core-ui";
import {
  createNodeBbSdk,
  type BbSdk,
  type BbSdkContext,
} from "@bb/sdk/node";

// Total timeout from request start through response body consumption. Keep this
// above the server's 60s long-poll cap so server timeouts win that race.
export const DEFAULT_CLI_REQUEST_TIMEOUT_MS = 75_000;

export type FetchImplementation = typeof fetch;

export interface CliRequestTimeoutFetchOptions {
  timeoutMs: number;
}

interface CliRequestTimeoutContext {
  requestSignal: AbortSignal;
  timeoutSignal: AbortSignal;
  timeoutMs: number;
}

type ResponseBodyReader<T> = () => Promise<T>;

interface ReadResponseBodyWithTimeoutMappingArgs<T> {
  context: CliRequestTimeoutContext;
  read: ResponseBodyReader<T>;
}

interface WrapCliRequestTimeoutResponseArgs {
  context: CliRequestTimeoutContext;
  response: Response;
}

interface WrapCliRequestTimeoutBodyArgs {
  context: CliRequestTimeoutContext;
  stream: ReadableStream<Uint8Array>;
}

const RESPONSE_BODY_READER_METHODS = new Set<PropertyKey>([
  "arrayBuffer",
  "blob",
  "bytes",
  "formData",
  "json",
  "text",
]);

function formatCliRequestTimeoutDuration(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;
  if (!Number.isInteger(seconds)) {
    return `${timeoutMs} ms`;
  }
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

class CliRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `BB request timed out after ${formatCliRequestTimeoutDuration(
        timeoutMs,
      )}.`,
    );
    this.name = "CliRequestTimeoutError";
  }
}

export function createClient(baseUrl: string): ApiClient {
  return createApiClient(baseUrl, {
    fetch: createCliRequestTimeoutFetch({
      timeoutMs: DEFAULT_CLI_REQUEST_TIMEOUT_MS,
    }),
  });
}

export type Client = ReturnType<typeof createClient>;

export interface CreateCliBbSdkOptions {
  context?: BbSdkContext;
}

export function createCliBbSdk(
  baseUrl: string,
  options: CreateCliBbSdkOptions = {},
): BbSdk {
  return createNodeBbSdk({ baseUrl, context: options.context });
}

export function createCliRequestTimeoutFetch(
  options: CliRequestTimeoutFetchOptions,
): FetchImplementation {
  validateCliRequestTimeoutMs(options.timeoutMs);

  return async (input, init) => {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const requestSignal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    const context: CliRequestTimeoutContext = {
      requestSignal,
      timeoutSignal,
      timeoutMs: options.timeoutMs,
    };

    try {
      const response = await fetch(input, { ...init, signal: requestSignal });
      return wrapCliRequestTimeoutResponse({ context, response });
    } catch (err) {
      if (isCliRequestTimeoutError(context, err)) {
        throw new CliRequestTimeoutError(options.timeoutMs);
      }
      throw err;
    }
  };
}

async function readResponseBodyWithTimeoutMapping<T>(
  args: ReadResponseBodyWithTimeoutMappingArgs<T>,
): Promise<T> {
  try {
    return await args.read();
  } catch (err) {
    if (isCliRequestTimeoutError(args.context, err)) {
      throw new CliRequestTimeoutError(args.context.timeoutMs);
    }
    throw err;
  }
}

function wrapCliRequestTimeoutResponse(
  args: WrapCliRequestTimeoutResponseArgs,
): Response {
  const { context, response } = args;
  let body: ReadableStream<Uint8Array> | null | undefined;

  return new Proxy(response, {
    get(target, property) {
      if (RESPONSE_BODY_READER_METHODS.has(property)) {
        const read = Reflect.get(target, property, target);
        if (typeof read === "function") {
          return () =>
            readResponseBodyWithTimeoutMapping({
              context,
              read: read.bind(target),
            });
        }
      }

      switch (property) {
        case "body":
          if (target.body === null) {
            return null;
          }
          body ??= wrapCliRequestTimeoutBody({
            context,
            stream: target.body,
          });
          return body;
        case "clone":
          return () =>
            wrapCliRequestTimeoutResponse({
              context,
              response: target.clone(),
            });
        default: {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  });
}

function wrapCliRequestTimeoutBody(
  args: WrapCliRequestTimeoutBodyArgs,
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
      } catch (err) {
        if (isCliRequestTimeoutError(args.context, err)) {
          controller.error(new CliRequestTimeoutError(args.context.timeoutMs));
          return;
        }
        controller.error(err);
      }
    },
    cancel(reason) {
      return getReader().cancel(reason);
    },
  });
}

function isCliRequestTimeoutError(
  context: CliRequestTimeoutContext,
  err: unknown,
): boolean {
  // Some paths reject with the timeout reason directly; others wrap it as a
  // platform AbortError/TimeoutError while preserving the composed reason.
  if (context.timeoutSignal.aborted && err === context.timeoutSignal.reason) {
    return true;
  }

  return (
    context.timeoutSignal.aborted &&
    context.requestSignal.reason === context.timeoutSignal.reason &&
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

function validateCliRequestTimeoutMs(timeoutMs: number): void {
  // timeoutMs=0 is an effectively immediate abort knob for tests and callers.
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(
      "CLI request timeout must be a non-negative finite number.",
    );
  }
}

function isTypeErrorWithCauseCode(err: unknown, expectedCode: string): boolean {
  if (!(err instanceof TypeError)) {
    return false;
  }
  const { cause } = err as Error & { cause?: unknown };
  if (!cause || typeof cause !== "object") {
    return false;
  }
  return "code" in cause && cause.code === expectedCode;
}

const ERROR_EXTRACT_OPTS = { legacyKeys: ["detail"] as const };

async function readHttpErrorMessage(res: Response): Promise<string> {
  let rawBody: string;
  try {
    rawBody = await res.text();
  } catch (err) {
    if (err instanceof CliRequestTimeoutError) {
      throw err;
    }
    rawBody = "";
  }
  const normalized = rawBody.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return res.statusText;
  }

  const contentType = res.headers.get("content-type");
  const shouldParseJson =
    (contentType?.includes("application/json") ?? false) ||
    normalized.startsWith("{") ||
    normalized.startsWith("[");
  if (!shouldParseJson) {
    return normalized;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    return extractErrorMessage(parsed, ERROR_EXTRACT_OPTS) ?? normalized;
  } catch {
    return normalized;
  }
}

export async function unwrap<T>(
  responsePromise: Promise<Response>,
): Promise<T> {
  const res = await resolveResponse(responsePromise);
  const text = await res.text();
  return JSON.parse(text) as T;
}

export async function unwrapVoid(
  responsePromise: Promise<Response>,
): Promise<void> {
  await resolveResponse(responsePromise);
}

async function resolveResponse(
  responsePromise: Promise<Response>,
): Promise<Response> {
  let res: Response;
  try {
    res = await responsePromise;
  } catch (err) {
    if (isTypeErrorWithCauseCode(err, "ECONNREFUSED")) {
      throw new Error(
        "Cannot connect to BB server. Ensure it is running and BB_SERVER_URL is correct.",
      );
    }
    throw err;
  }
  if (!res.ok) {
    const message = await readHttpErrorMessage(res);
    throw new Error(`HTTP ${res.status}: ${message}`);
  }
  return res;
}
