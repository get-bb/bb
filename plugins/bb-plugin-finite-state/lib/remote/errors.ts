import { RemoteError, type Json, type RemoteService } from "./types.js";

export class IndeterminateRemoteWriteError extends RemoteError {
  constructor(service: RemoteService, operation: string) {
    super("Remote write outcome is indeterminate; reconcile by reading it back", {
      service,
      code: "REMOTE_WRITE_INDETERMINATE",
      status: null,
      retryable: false,
      retryAfterMs: null,
      details: { operation },
    });
    this.name = "IndeterminateRemoteWriteError";
  }
}

export function unavailableError(service: RemoteService): RemoteError {
  return new RemoteError("Remote service is not configured", {
    service,
    code: "REMOTE_UNAVAILABLE",
    status: null,
    retryable: false,
    retryAfterMs: null,
    details: null,
  });
}

export function unsupportedError(service: RemoteService, operation: string): RemoteError {
  return new RemoteError("Remote operation is unsupported by this transport", {
    service,
    code: "REMOTE_UNSUPPORTED",
    status: null,
    retryable: false,
    retryAfterMs: null,
    details: { operation },
  });
}

export function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? Math.ceil(seconds * 1_000) : null;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function safeDetails(value: unknown): Json | null {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 100).map(safeDetails);
  if (typeof value !== "object") return null;
  const output: Record<string, Json> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (/(?:authorization|api.?key|token|secret|password|url|path|command)/iu.test(key)) continue;
    output[key] = safeDetails(item);
  }
  return output;
}

export async function responseError(
  service: RemoteService,
  response: Response,
  now: number,
): Promise<RemoteError> {
  let details: Json | null = null;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType === "application/json") {
    try {
      details = safeDetails(await response.clone().json());
    } catch {
      details = null;
    }
  }
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), now);
  return new RemoteError("Remote service rejected the request", {
    service,
    code: response.status === 429 ? "REMOTE_RATE_LIMITED" : `REMOTE_HTTP_${response.status}`,
    status: response.status,
    retryable: response.status === 429 || response.status === 408 || response.status >= 500,
    retryAfterMs,
    details,
  });
}

export function transportError(
  service: RemoteService,
  operation: string,
  idempotent: boolean,
  error: unknown,
): RemoteError {
  if (error instanceof RemoteError) return error;
  if (!idempotent) return new IndeterminateRemoteWriteError(service, operation);
  return new RemoteError("Remote service could not be reached", {
    service,
    code: "REMOTE_TRANSPORT_ERROR",
    status: null,
    retryable: true,
    retryAfterMs: null,
    details: null,
  });
}
