type ConnectListErrorCode =
  | "not_paired"
  | "unauthorized"
  | "network"
  | "invalid_response";

/**
 * Typed gate-call failure. `code` is stable for RPC/CLI mapping; `message`
 * carries detail for logs/stderr.
 */
export class ConnectListError extends Error {
  constructor(
    readonly code: ConnectListErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectListError";
  }
}
