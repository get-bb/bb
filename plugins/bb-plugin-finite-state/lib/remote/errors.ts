import { RemoteError, type Json, type RemoteService } from "./types.js";

export const REMOTE_FAILURE_KINDS = {
  authentication: "authentication",
  http: "http",
  networkUnreachable: "network-unreachable",
  settings: "settings",
  timeout: "timeout",
  unknown: "unknown",
} as const;

export type RemoteFailureKind =
  (typeof REMOTE_FAILURE_KINDS)[keyof typeof REMOTE_FAILURE_KINDS];

export interface RemoteRequestDescription {
  method: string;
  url: string;
  phase: string;
}

export interface RemoteFailureDiagnostic {
  kind: RemoteFailureKind;
  message: string;
  retryable: boolean;
  service: RemoteService | null;
  status: number | null;
  request: RemoteRequestDescription | null;
  credential: {
    header: string;
    label: string;
    setting: string;
  } | null;
}

export const REMOTE_REQUEST_TIMEOUT_MS = {
  platform: 30_000,
  "assurance-studio": 45_000,
} as const;

const SERVICE_PRESENTATION = {
  platform: {
    name: "Platform",
    credentialHeader: "X-Authorization",
    credentialLabel: "Platform token",
    credentialSetting: "platformToken",
    urlLabel: "Platform URL",
    urlSetting: "platformBaseUrl",
  },
  "assurance-studio": {
    name: "Assurance Studio",
    credentialHeader: "X-API-Key",
    credentialLabel: "Assurance Studio API key",
    credentialSetting: "asApiKey",
    urlLabel: "Assurance Studio URL",
    urlSetting: "asBaseUrl",
  },
  "forge-compute": {
    name: "Forge Compute",
    credentialHeader: "Authorization",
    credentialLabel: "Forge Compute bearer",
    credentialSetting: "forgeAuthToken",
    urlLabel: "Forge Compute URL",
    urlSetting: "forgeUrl",
  },
} as const satisfies Record<
  RemoteService,
  {
    name: string;
    credentialHeader: string;
    credentialLabel: string;
    credentialSetting: string;
    urlLabel: string;
    urlSetting: string;
  }
>;

function requestUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value;
  }
}

function requestDetails(
  request: RemoteRequestDescription | undefined,
): Record<string, Json> | null {
  return request
    ? {
        method: request.method,
        url: requestUrl(request.url),
        phase: request.phase,
      }
    : null;
}

function remoteAbortError(service: RemoteService): RemoteError {
  return new RemoteError("Remote operation was aborted", {
    service,
    code: "REMOTE_ABORTED",
    status: null,
    retryable: false,
    retryAfterMs: null,
    details: null,
  });
}

export async function withRemoteRequestTimeout<T>(
  service: "platform" | "assurance-studio",
  request: RemoteRequestDescription,
  callerSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = REMOTE_REQUEST_TIMEOUT_MS[service],
): Promise<T> {
  const startedAt = Date.now();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeout.signal])
    : timeout.signal;
  try {
    return await operation(signal);
  } catch (error: unknown) {
    if (timeout.signal.aborted) {
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      throw new RemoteError(
        `${SERVICE_PRESENTATION[service].name} timed out after ${elapsedMs}ms during ${request.phase} (${request.method} ${requestUrl(request.url)}).`,
        {
          service,
          code: "REMOTE_TIMEOUT",
          status: null,
          retryable: false,
          retryAfterMs: null,
          details: {
            ...requestDetails(request),
            elapsedMs,
          },
        },
      );
    }
    if (callerSignal?.aborted) throw remoteAbortError(service);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class IndeterminateRemoteWriteError extends RemoteError {
  constructor(service: RemoteService, operation: string) {
    super(
      "Remote write outcome is indeterminate; reconcile by reading it back",
      {
        service,
        code: "REMOTE_WRITE_INDETERMINATE",
        status: null,
        retryable: false,
        retryAfterMs: null,
        details: { operation },
      },
    );
    this.name = "IndeterminateRemoteWriteError";
  }
}

export function unavailableError(service: RemoteService): RemoteError {
  const presentation = SERVICE_PRESENTATION[service];
  return new RemoteError(
    `${presentation.name} is not configured. Set ${presentation.urlLabel} (${presentation.urlSetting}) and ${presentation.credentialLabel} (${presentation.credentialSetting}).`,
    {
      service,
      code: "REMOTE_UNAVAILABLE",
      status: null,
      retryable: false,
      retryAfterMs: null,
      details: null,
    },
  );
}

export function unsupportedError(
  service: RemoteService,
  operation: string,
): RemoteError {
  return new RemoteError("Remote operation is unsupported by this transport", {
    service,
    code: "REMOTE_UNSUPPORTED",
    status: null,
    retryable: false,
    retryAfterMs: null,
    details: { operation },
  });
}

export function parseRetryAfter(
  value: string | null,
  now: number,
): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? Math.ceil(seconds * 1_000) : null;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function safeDetails(value: unknown): Json | null {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 100).map(safeDetails);
  if (typeof value !== "object") return null;
  const output: Record<string, Json> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (
      /(?:authorization|api.?key|token|secret|password|url|path|command)/iu.test(
        key,
      )
    )
      continue;
    output[key] = safeDetails(item);
  }
  return output;
}

export async function responseError(
  service: RemoteService,
  response: Response,
  now: number,
  request?: RemoteRequestDescription,
): Promise<RemoteError> {
  let details: Json | null = null;
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim();
  if (contentType === "application/json") {
    try {
      details = safeDetails(await response.clone().json());
    } catch {
      details = null;
    }
  }
  const retryAfterMs = parseRetryAfter(
    response.headers.get("retry-after"),
    now,
  );
  const presentation = SERVICE_PRESENTATION[service];
  const requestLine = request
    ? `${request.method} ${requestUrl(request.url)}`
    : "the request";
  const authentication = response.status === 401 || response.status === 403;
  const authKind = response.status === 401 ? "authentication" : "authorization";
  const message = authentication
    ? `${presentation.name} ${authKind} failed for ${requestLine} with HTTP ${response.status} using ${presentation.credentialHeader}. Refresh ${presentation.credentialLabel} (${presentation.credentialSetting}).`
    : "Remote service rejected the request";
  const diagnosticDetails = requestDetails(request);
  const combinedDetails =
    diagnosticDetails === null
      ? details
      : details !== null &&
          typeof details === "object" &&
          !Array.isArray(details)
        ? { ...details, request: diagnosticDetails }
        : { request: diagnosticDetails, response: details };
  return new RemoteError(message, {
    service,
    code:
      response.status === 429
        ? "REMOTE_RATE_LIMITED"
        : `REMOTE_HTTP_${response.status}`,
    status: response.status,
    retryable:
      response.status === 429 ||
      response.status === 408 ||
      response.status >= 500,
    retryAfterMs,
    details: combinedDetails,
  });
}

export function transportError(
  service: RemoteService,
  operation: string,
  idempotent: boolean,
  error: unknown,
  request?: RemoteRequestDescription,
): RemoteError {
  if (error instanceof RemoteError) return error;
  if (!idempotent) return new IndeterminateRemoteWriteError(service, operation);
  const presentation = SERVICE_PRESENTATION[service];
  const requestLine = request
    ? `${request.method} ${requestUrl(request.url)}`
    : operation;
  return new RemoteError(
    `${presentation.name} could not be reached during ${requestLine}. Check DNS, proxy, and network connectivity.`,
    {
      service,
      code: "REMOTE_TRANSPORT_ERROR",
      status: null,
      retryable: true,
      retryAfterMs: null,
      details: requestDetails(request),
    },
  );
}

function diagnosticRequest(
  error: RemoteError,
): RemoteRequestDescription | null {
  const details = error.details;
  if (details === null || typeof details !== "object" || Array.isArray(details))
    return null;
  const candidate = details["request"] ?? details;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  )
    return null;
  const method = candidate["method"];
  const url = candidate["url"];
  const phase = candidate["phase"];
  return typeof method === "string" &&
    typeof url === "string" &&
    typeof phase === "string"
    ? { method, url, phase }
    : null;
}

function rejectedRequestMessage(error: RemoteError): string {
  const presentation = SERVICE_PRESENTATION[error.service];
  const request = diagnosticRequest(error);
  const requestLine = request
    ? `${request.method} ${requestUrl(request.url)}`
    : "the request";
  return `${presentation.name} rejected ${requestLine} with HTTP ${error.status}.`;
}

export function diagnoseRemoteFailure(error: unknown): RemoteFailureDiagnostic {
  if (!(error instanceof RemoteError)) {
    return {
      kind: REMOTE_FAILURE_KINDS.unknown,
      message:
        "Remote request failed unexpectedly. Retry, then inspect the plugin logs if the failure persists.",
      retryable: false,
      service: null,
      status: null,
      request: null,
      credential: null,
    };
  }
  const kind =
    error.code === "REMOTE_TIMEOUT"
      ? REMOTE_FAILURE_KINDS.timeout
      : error.code === "REMOTE_UNAVAILABLE"
        ? REMOTE_FAILURE_KINDS.settings
        : error.status === 401 || error.status === 403
          ? REMOTE_FAILURE_KINDS.authentication
          : error.code === "REMOTE_TRANSPORT_ERROR"
            ? REMOTE_FAILURE_KINDS.networkUnreachable
            : REMOTE_FAILURE_KINDS.http;
  const message =
    kind === REMOTE_FAILURE_KINDS.http && error.status !== null
      ? rejectedRequestMessage(error)
      : error.message;
  const presentation = SERVICE_PRESENTATION[error.service];
  return {
    kind,
    message,
    retryable: error.retryable,
    service: error.service,
    status: error.status,
    request: diagnosticRequest(error),
    credential:
      kind === REMOTE_FAILURE_KINDS.authentication
        ? {
            header: presentation.credentialHeader,
            label: presentation.credentialLabel,
            setting: presentation.credentialSetting,
          }
        : null,
  };
}

export function settingsFailureDiagnostic(
  service: RemoteService,
  message: string,
): RemoteFailureDiagnostic {
  return {
    kind: REMOTE_FAILURE_KINDS.settings,
    message,
    retryable: false,
    service,
    status: null,
    request: null,
    credential: null,
  };
}

/**
 * Keep frozen connections.status detail intentionally terse. Request metadata
 * belongs to the structured remoteConnectionDiagnostics RPC, whose fields are
 * not constrained by safeDetailSchema's credential-pattern guard.
 */
export function connectionStatusMessage(
  diagnostic: RemoteFailureDiagnostic,
): string {
  const name =
    diagnostic.service === null
      ? "Remote service"
      : SERVICE_PRESENTATION[diagnostic.service].name;
  switch (diagnostic.kind) {
    case REMOTE_FAILURE_KINDS.authentication:
      return `${name} credentials were rejected${diagnostic.status === null ? "" : ` (HTTP ${diagnostic.status})`}.`;
    case REMOTE_FAILURE_KINDS.http:
      return `${name} request was rejected${diagnostic.status === null ? "" : ` (HTTP ${diagnostic.status})`}.`;
    case REMOTE_FAILURE_KINDS.networkUnreachable:
      return `${name} could not be reached.`;
    case REMOTE_FAILURE_KINDS.settings:
      return `${name} settings are invalid.`;
    case REMOTE_FAILURE_KINDS.timeout:
      return `${name} request timed out.`;
    case REMOTE_FAILURE_KINDS.unknown:
      return `${name} request failed unexpectedly.`;
  }
}
