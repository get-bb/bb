export type ServerArchiveErrorCode =
  | "bad_passphrase"
  | "corrupt"
  | "digest_mismatch"
  | "encryption_mismatch"
  | "server_data_exists"
  | "unsafe_entry"
  | "unsupported_version";

export class ServerArchiveError extends Error {
  constructor(
    readonly code: ServerArchiveErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ServerArchiveError";
  }
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
