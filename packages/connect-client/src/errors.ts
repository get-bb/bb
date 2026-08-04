export type ConnectListErrorCode =
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

/**
 * A credential the gate refuses is dead: the machine was revoked, or the
 * account unpaired it. Callers that cache the credential must drop their copy.
 */
export function isRevokedCredentialError(error: unknown): boolean {
  return error instanceof ConnectListError && error.code === "unauthorized";
}
