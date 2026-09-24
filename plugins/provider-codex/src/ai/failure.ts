import type { CodexAiFailureCode } from "./host-contract.js";

export class AiServiceFailure extends Error {
  readonly code: CodexAiFailureCode;
  readonly detailCode: string;

  constructor(code: CodexAiFailureCode, detailCode: string, message: string) {
    super(message);
    this.name = "AiServiceFailure";
    this.code = code;
    this.detailCode = detailCode;
  }
}

export function toAiServiceFailure(error: unknown): {
  ok: false;
  code: CodexAiFailureCode;
  message: string;
} {
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
