import { ApiError } from "../../errors.js";
import type { ServerRuntimeConfig } from "../../types.js";

interface ProductionErrorLogFields {
  errorCode?: string;
  errorMessage: string;
  errorName: string;
  errorStatus?: number;
}

type RuntimeErrorLogFields = { err: unknown } | ProductionErrorLogFields;

export function productionErrorLogFields(
  cause: unknown,
): ProductionErrorLogFields {
  if (cause instanceof ApiError) {
    return {
      errorCode: cause.body.code,
      errorMessage: cause.body.message,
      errorName: cause.name,
      errorStatus: cause.status,
    };
  }

  if (cause instanceof Error) {
    return {
      errorMessage: cause.message,
      errorName: cause.name,
    };
  }

  return {
    errorMessage: String(cause),
    errorName: "NonError",
  };
}

export function runtimeErrorLogFields(
  config: Pick<ServerRuntimeConfig, "isDevelopment">,
  cause: unknown,
): RuntimeErrorLogFields {
  return config.isDevelopment
    ? { err: cause }
    : productionErrorLogFields(cause);
}

export function isCommandTimeoutError(cause: unknown): boolean {
  return cause instanceof ApiError && cause.body.code === "command_timeout";
}

export function isHostUnavailableError(cause: unknown): boolean {
  return cause instanceof ApiError && cause.body.code === "host_unavailable";
}
