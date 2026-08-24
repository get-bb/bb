import type { ExperimentalAiServiceErrorCode } from "@get-bb/plugin-sdk/ai-services";
import { ApiError } from "../../errors.js";

/** The public error code each service failure code maps to. */
export const AI_SERVICE_ERROR_CODES: Record<ExperimentalAiServiceErrorCode, string> = {
  timeout: "ai_service_timeout",
  rate_limited: "ai_service_rate_limited",
  service_unavailable: "ai_service_unavailable",
  auth_required: "ai_service_auth_required",
  request_failed: "ai_service_request_failed",
  invalid_response: "ai_service_invalid_response",
};

const TRANSIENT_CODES = new Set<ExperimentalAiServiceErrorCode>([
  "timeout",
  "rate_limited",
  "service_unavailable",
]);

/**
 * A failure the serving plugin reported in its result (not a transport
 * failure): carries the generic code core's retry and fallback policy keys
 * on. Surfaces to HTTP as a 502 with the mapped public code.
 */
export class AiServiceCallError extends ApiError {
  readonly serviceId: string;
  readonly code: ExperimentalAiServiceErrorCode;

  constructor(
    serviceId: string,
    code: ExperimentalAiServiceErrorCode,
    message: string,
  ) {
    super(502, AI_SERVICE_ERROR_CODES[code], message, TRANSIENT_CODES.has(code));
    this.name = "AiServiceCallError";
    this.serviceId = serviceId;
    this.code = code;
  }

  get transient(): boolean {
    return TRANSIENT_CODES.has(this.code);
  }
}

/**
 * Whether an error is worth the configured fallback model: a service's
 * transient failure, or the host layer's own command timeout (the daemon
 * did not answer in time).
 */
export function isTransientAiServiceError(error: Error): boolean {
  if (error instanceof AiServiceCallError) {
    return error.transient;
  }
  return error instanceof ApiError && error.body.code === "command_timeout";
}
