import { ConnectListError } from "@bb/connect-client";
import { toRecord } from "@bb/core-ui";
import { BbHttpError } from "@bb/sdk/browser";
import { z } from "zod";

export type AuthErrorKind = "auth-required" | "network" | "http" | "unknown";

interface ResponseLike {
  status: number;
  headers: { get(name: string): string | null };
}

function isResponseLike(cause: unknown): cause is ResponseLike {
  const record = toRecord(cause);
  if (!record || !z.number().safeParse(record.status).success) return false;
  const headers = toRecord(record.headers);
  return headers?.get instanceof Function;
}

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export function mapAuthError(cause: unknown): AuthErrorKind {
  if (cause instanceof ConnectListError) {
    return cause.code === "unauthorized" ? "auth-required" : "network";
  }
  if (cause instanceof BbHttpError) {
    return isAuthStatus(cause.status) ? "auth-required" : "http";
  }
  if (isResponseLike(cause)) {
    if (isAuthStatus(cause.status)) return "auth-required";
    return cause.status >= 400 ? "http" : "unknown";
  }
  const record = toRecord(cause);
  if (record) {
    const status = z.number().safeParse(record.status);
    if (status.success && isAuthStatus(status.data)) {
      return "auth-required";
    }
    if (record.name === "AbortError" || record.name === "TimeoutError") {
      return "network";
    }
    const parsedMessage = z.string().safeParse(record.message);
    if (parsedMessage.success) {
      const message = parsedMessage.data.toLowerCase();
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
