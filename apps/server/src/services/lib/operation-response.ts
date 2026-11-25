import type { OperationResponse } from "@bb/server-contract";

export function operationComplete(): OperationResponse {
  return { ok: true, progress: "complete" };
}

export function operationInProgress(): OperationResponse {
  return { ok: true, progress: "in-progress" };
}
