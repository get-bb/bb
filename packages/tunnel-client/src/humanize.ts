function readTransportErrorCode(error: Error): string | undefined {
  if (!("code" in error)) return undefined;
  const code = error.code;
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET"
  ) {
    return code;
  }
  return undefined;
}

export function humanizeTransportError(error: Error, host: string): string {
  const code = readTransportErrorCode(error);
  let reason: string;
  if (code === "ECONNREFUSED") reason = "connection refused";
  else if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    reason = "host not found";
  else if (
    code === "ETIMEDOUT" ||
    /timed out|timeout|ETIMEDOUT/i.test(error.message)
  )
    reason = "timed out";
  else if (code === "ECONNRESET") reason = "connection reset";
  else reason = error.message;
  return `can't reach ${host} — ${reason}`;
}
