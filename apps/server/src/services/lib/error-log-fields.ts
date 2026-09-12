import { ApiError } from "../../errors.js";
import type { ServerRuntimeConfig } from "../../types.js";

interface ProductionErrorLogFields {
  errorCode?: string;
  errorMessage: string;
  errorName: string;
  errorStatus?: number;
}

interface ExpectedFallbackErrorLogFields {
  errorCode: string;
  errorDetails?: unknown;
  errorMessage: string;
  errorRetryable?: boolean;
  errorStatus: number;
}

type LoggableError = unknown;
type RuntimeErrorLogFields = { err: LoggableError } | ProductionErrorLogFields;

export function expectedFallbackErrorLogFields(
  error: ApiError,
): ExpectedFallbackErrorLogFields {
  const fields: ExpectedFallbackErrorLogFields = {
    errorCode: error.body.code,
    errorMessage: error.body.message,
    errorStatus: error.status,
  };
  if (error.body.details !== undefined) {
    fields.errorDetails = error.body.details;
  }
  if (error.body.retryable !== undefined) {
    fields.errorRetryable = error.body.retryable;
  }
  return fields;
}

export function productionErrorLogFields(
  error: LoggableError,
): ProductionErrorLogFields {
  if (error instanceof ApiError) {
    return {
      errorCode: error.body.code,
      errorMessage: error.body.message,
      errorName: error.name,
      errorStatus: error.status,
    };
  }

  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorName: error.name,
    };
  }

  return {
    errorMessage: String(error),
    errorName: "NonError",
  };
}

export function runtimeErrorLogFields(
  config: Pick<ServerRuntimeConfig, "isDevelopment">,
  error: LoggableError,
): RuntimeErrorLogFields {
  return config.isDevelopment
    ? { err: error }
    : productionErrorLogFields(error);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isCommandTimeoutError(error: LoggableError): boolean {
  return error instanceof ApiError && error.body.code === "command_timeout";
}
