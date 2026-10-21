import { FRP_LOGIN_REFUSED_REASON } from "@bb/tunnel-contract/next";

export type FrpcLogEvent =
  | { kind: "connecting" }
  | { kind: "logged-in" }
  | { kind: "proxy-started"; proxy: string }
  | { kind: "proxy-refused"; proxy: string; reason: string }
  | { kind: "proxy-removed"; proxy: string }
  | { kind: "offline"; reason: string }
  | { kind: "refused"; reason: string };

const ANSI_PATTERN = /\u001b\[[0-9;]*m/gu;
const PREFIX_PATTERN =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? \[[A-Z]\] \[[^\]]+\] (?:\[[0-9a-f]+\] )?/u;
const PROXY_STARTED = /^\[([^\]]+)\] start proxy success/u;
const PROXY_ERROR = /^\[([^\]]+)\] start error: (.*)$/u;
const PROXY_REMOVED = /^proxy removed: \[([^\]]+)\]/u;
const LOGIN_ERROR =
  /^(?:connect to server error|login to the server failed|reconnect to server error): (.*)$/u;

export function cleanFrpcLine(
  line: string,
  secrets: readonly string[],
): string {
  let cleaned = line.replace(ANSI_PATTERN, "").trimEnd();
  for (const secret of secrets) {
    if (secret.length > 0) cleaned = cleaned.split(secret).join("[redacted]");
  }
  return cleaned;
}

export function parseFrpcLine(line: string): FrpcLogEvent | null {
  const message = line.replace(PREFIX_PATTERN, "");
  if (/^try to (?:re)?connect to server/u.test(message)) {
    return { kind: "connecting" };
  }
  if (/^login to server success/u.test(message)) return { kind: "logged-in" };
  const started = PROXY_STARTED.exec(message);
  if (started !== null) {
    return { kind: "proxy-started", proxy: started[1] ?? "" };
  }
  const proxyError = PROXY_ERROR.exec(message);
  if (proxyError !== null) {
    return {
      kind: "proxy-refused",
      proxy: proxyError[1] ?? "",
      reason: proxyError[2] ?? "",
    };
  }
  const removed = PROXY_REMOVED.exec(message);
  if (removed !== null) {
    return { kind: "proxy-removed", proxy: removed[1] ?? "" };
  }
  const loginError = LOGIN_ERROR.exec(message);
  if (loginError !== null) {
    const reason = loginError[1] ?? "";
    return reason === FRP_LOGIN_REFUSED_REASON
      ? { kind: "refused", reason }
      : { kind: "offline", reason };
  }
  return null;
}
