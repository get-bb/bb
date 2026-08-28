import type { ExperimentalAiServiceErrorCode } from "@get-bb/plugin-sdk/ai-services";

export class AiServiceFailure extends Error {
  readonly code: ExperimentalAiServiceErrorCode;
  readonly detailCode: string;

  constructor(
    code: ExperimentalAiServiceErrorCode,
    detailCode: string,
    message: string,
  ) {
    super(message);
    this.name = "AiServiceFailure";
    this.code = code;
    this.detailCode = detailCode;
  }
}

interface AiServiceFailureResult {
  ok: false;
  code: ExperimentalAiServiceErrorCode;
  message: string;
}

export function toAiServiceFailure<T>(error: T): AiServiceFailureResult {
  if (error instanceof AiServiceFailure) {
    console.error(`codex ai service: ${error.detailCode}: ${error.message}`);
    return { ok: false, code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "AbortError") {
    return { ok: false, code: "timeout", message };
  }
  return { ok: false, code: "request_failed", message };
}
