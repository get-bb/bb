import { ApiError } from "../../errors.js";
import type { ServerRuntimeConfig } from "../../types.js";

export interface ProductionErrorLogFields {
  errorCode?: string;
  errorMessage: string;
  errorName: string;
  errorStatus?: number;
}

export type LoggableError = unknown;
export type RuntimeErrorLogFields =
  | { err: LoggableError }
  | ProductionErrorLogFields;

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

export function isCommandTimeoutError(error: LoggableError): boolean {
  return error instanceof ApiError && error.body.code === "command_timeout";
}

export function isHostUnavailableError(error: LoggableError): boolean {
  return error instanceof ApiError && error.body.code === "host_unavailable";
}
