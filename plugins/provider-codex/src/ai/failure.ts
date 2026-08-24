import type { ExperimentalAiServiceErrorCode } from "@get-bb/plugin-sdk/ai-services";

/**
 * A failure the ChatGPT client reports to bb's AI-services caller: the
 * generic code core's retry policy keys on, plus the codex-specific detail
 * code kept in the message for logs and the UI.
 */
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

/** `{ ok: false, code, message }` for the contract; unknown errors are `request_failed`. */
export function toAiServiceFailure(error: unknown): {
  ok: false;
  code: ExperimentalAiServiceErrorCode;
  message: string;
} {
  if (error instanceof AiServiceFailure) {
    // The detail code is for logs (the host worker's stderr reaches the
    // daemon log); the message is what the user sees in the toast.
    console.error(`codex ai service: ${error.detailCode}: ${error.message}`);
    return { ok: false, code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "AbortError") {
    return { ok: false, code: "timeout", message };
  }
  return { ok: false, code: "request_failed", message };
}
