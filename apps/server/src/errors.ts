import { HTTPException } from "hono/http-exception";
import type { ThreadEventScopeKind, ThreadEventType } from "@bb/domain";
import type { ServerLogger } from "./types.js";

interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
}

interface ApiErrorOptions {
  details?: unknown;
  retryable?: boolean;
}

interface TurnStartGuardFailureDetails {
  eventType: ThreadEventType;
  scopeKind: ThreadEventScopeKind;
  threadId: string;
  turnId: string;
}

export class ApiError extends HTTPException {
  readonly body: ApiErrorBody;

  constructor(
    status: ConstructorParameters<typeof HTTPException>[0],
    code: string,
    message: string,
    options?: boolean | ApiErrorOptions,
  ) {
    super(status, { message });
    const resolvedOptions = normalizeApiErrorOptions(options);
    this.body = { code, message };
    if (resolvedOptions.details !== undefined) {
      this.body.details = resolvedOptions.details;
    }
    if (resolvedOptions.retryable !== undefined) {
      this.body.retryable = resolvedOptions.retryable;
    }
  }

  toResponse(): Response {
    return new Response(JSON.stringify(this.body), {
      status: this.status,
      headers: {
        "content-type": "application/json",
      },
    });
  }
}

function normalizeApiErrorOptions(
  options: boolean | ApiErrorOptions | undefined,
): ApiErrorOptions {
  if (typeof options === "boolean") {
    return { retryable: options };
  }
  return options ?? {};
}

export class TurnStartGuardError extends ApiError {
  readonly details: TurnStartGuardFailureDetails;

  constructor(details: TurnStartGuardFailureDetails) {
    super(
      409,
      "invalid_request",
      `Cannot append ${details.eventType} for turn ${details.turnId} before turn/started is stored`,
    );
    this.name = "TurnStartGuardError";
    this.details = details;
  }
}

export function errorToResponse(
  error: unknown,
  logger: ServerLogger,
): Response {
  if (error instanceof TurnStartGuardError) {
    logger.warn(
      { err: error, ...error.details },
      "Rejected turn-scoped server event before turn/started",
    );
    return error.toResponse();
  }
  if (error instanceof ApiError) {
    return error.toResponse();
  }
  if (error instanceof HTTPException) {
    return new Response(
      JSON.stringify({
        code: "internal_error",
        message: error.message,
      }),
      {
        status: error.status,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }
  logger.error({ err: error }, "Unhandled server error");
  return new Response(
    JSON.stringify({
      code: "internal_error",
      message: "Internal server error",
    }),
    {
      status: 500,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}
