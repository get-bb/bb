import { ConnectListError } from "@bb/connect-client";
import { toRecord } from "@bb/core-ui";
import { BbHttpError } from "@bb/sdk/browser";

/**
 * - `auth-required`: the connect gate refused us (HTML sign-in page on 401/403,
 *   or the machine credential is revoked). The profile needs re-pairing or a
 *   fresh session cookie.
 * - `network`: transport failure, retryable.
 * - `http`: the server answered with another error status.
 * - `unknown`: anything else.
 */
export type AuthErrorKind = "auth-required" | "network" | "http" | "unknown";

interface ResponseLike {
  status: number;
  headers: { get(name: string): string | null };
}

function isResponseLike(value: unknown): value is ResponseLike {
  const record = toRecord(value);
  if (!record || typeof record.status !== "number") return false;
  const headers = toRecord(record.headers);
  return typeof headers?.get === "function";
}

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Classify a failed response or thrown error from a bb server / connect gate.
 * The gate answers unauthenticated visitors with an HTML sign-in page (401)
 * or a "not your server" text (403); the bb server itself never returns
 * 401/403 for the routes the app calls, so any auth status maps to
 * `auth-required`.
 */
export function mapAuthError(input: unknown): AuthErrorKind {
  if (input instanceof ConnectListError) {
    return input.code === "unauthorized" ? "auth-required" : "network";
  }
  if (input instanceof BbHttpError) {
    return isAuthStatus(input.status) ? "auth-required" : "http";
  }
  if (isResponseLike(input)) {
    if (isAuthStatus(input.status)) return "auth-required";
    return input.status >= 400 ? "http" : "unknown";
  }
  const record = toRecord(input);
  if (record) {
    if (typeof record.status === "number" && isAuthStatus(record.status)) {
      return "auth-required";
    }
    if (record.name === "AbortError" || record.name === "TimeoutError") {
      return "network";
    }
    if (typeof record.message === "string") {
      const message = record.message.toLowerCase();
      if (
        message.includes("network request failed") ||
        message.includes("failed to fetch") ||
        message.includes("load failed") ||
        message.includes("networkerror") ||
        message.includes("network connection was lost")
      ) {
        return "network";
      }
    }
  }
  return "unknown";
}
