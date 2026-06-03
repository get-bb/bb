import { extractErrorMessage } from "@bb/core-ui";

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

interface ResolveResponseArgs<TResponse extends Response> {
  response: Promise<TResponse>;
}

interface ReadJsonResponseArgs<TResponse extends Response> {
  response: Promise<TResponse>;
}

interface ReadVoidResponseArgs<TResponse extends Response> {
  response: Promise<TResponse>;
}

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

const ERROR_EXTRACT_OPTS: { legacyKeys: readonly ["detail"] } = {
  legacyKeys: ["detail"],
};

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
        error === context.timeoutSignal.reason ||
        (error instanceof Error && isRequestTimeoutError(context, error))
      ) {
        throw new BbRequestTimeoutError(options.timeoutMs);
      }
      throw error;
    }
  };
}

export async function readJsonResponse<TResponse extends Response>(
  args: ReadJsonResponseArgs<TResponse>,
): Promise<JsonBodyOf<TResponse>> {
  const response = await resolveResponse({ response: args.response });
  return response.json();
}

export async function readVoidResponse<TResponse extends Response>(
  args: ReadVoidResponseArgs<TResponse>,
): Promise<void> {
  await resolveResponse({ response: args.response });
}

export async function resolveResponse<TResponse extends Response>(
  args: ResolveResponseArgs<TResponse>,
): Promise<TResponse> {
  let response: TResponse;
  try {
    response = await args.response;
  } catch (error) {
    if (error instanceof Error && isTypeErrorWithCauseCode(error, "ECONNREFUSED")) {
      throw new Error(
        "Cannot connect to BB server. Ensure it is running and BB_SERVER_URL is correct.",
      );
    }
    throw error;
  }
  if (!response.ok) {
    const message = await readHttpErrorMessage(response);
    throw new Error(`HTTP ${response.status}: ${message}`);
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
      error === args.context.timeoutSignal.reason ||
      (error instanceof Error && isRequestTimeoutError(args.context, error))
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
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  });
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
          error === args.context.timeoutSignal.reason ||
          (error instanceof Error && isRequestTimeoutError(args.context, error))
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
  error: Error,
): boolean {
  return (
    context.timeoutSignal.aborted &&
    context.requestSignal.reason === context.timeoutSignal.reason &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function validateRequestTimeoutMs(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(
      "CLI request timeout must be a non-negative finite number.",
    );
  }
}

function isTypeErrorWithCauseCode(error: Error, expectedCode: string): boolean {
  if (!(error instanceof TypeError)) {
    return false;
  }
  const { cause } = error;
  if (!cause || typeof cause !== "object") {
    return false;
  }
  return "code" in cause && cause.code === expectedCode;
}

async function readHttpErrorMessage(response: Response): Promise<string> {
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
    return response.statusText;
  }

  const contentType = response.headers.get("content-type");
  const shouldParseJson =
    (contentType?.includes("application/json") ?? false) ||
    normalized.startsWith("{") ||
    normalized.startsWith("[");
  if (!shouldParseJson) {
    return normalized;
  }

  try {
    const parsed = JSON.parse(normalized);
    return extractErrorMessage(parsed, ERROR_EXTRACT_OPTS) ?? normalized;
  } catch {
    return normalized;
  }
}
