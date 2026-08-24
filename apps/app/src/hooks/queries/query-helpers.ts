import { toRecord } from "@bb/core-ui";
import { HttpError } from "@/lib/api";
import { BbHttpError } from "@/lib/sdk";

/**
 * Staleness window for prompt-history queries. Shared by the thread- and
 * project-scoped variants so they age out their cached suggestions together.
 */
export const PROMPT_HISTORY_STALE_TIME_MS = 10_000;
const TRANSIENT_READ_RETRY_COUNT = 2;
export const TRANSIENT_READ_RETRY_DELAY_MS = 250;

export interface QueryOptions {
  enabled?: boolean;
}

interface RequireEnabledQueryArgArgs<T> {
  value: T | null | undefined;
  hookName: string;
  argName: string;
}

/**
 * Asserts a query argument is present once its query is enabled. Query hooks
 * gate `enabled` on their id/arg being set, so the queryFn only runs with a
 * real value — this turns that invariant into a typed non-null at the call
 * site, and throws (rather than firing a request with a missing arg) if the
 * invariant is ever violated. Treats empty string as missing so a blank id is
 * rejected the same as null/undefined; a numeric `0` is kept.
 */
export function requireEnabledQueryArg<T>({
  value,
  hookName,
  argName,
}: RequireEnabledQueryArgArgs<T>): T {
  if (value == null || value === "") {
    throw new Error(
      `${hookName}: ${argName} is required when query is enabled`,
    );
  }
  return value;
}

export function requireProjectId(
  projectId: string | undefined,
  hookName: string,
): string {
  return requireEnabledQueryArg({
    value: projectId,
    hookName,
    argName: "projectId",
  });
}

export function requireThreadId(id: string, hookName: string): string {
  return requireEnabledQueryArg({ value: id, hookName, argName: "thread id" });
}

function normalizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().toLowerCase();
}

export function isTransientReadError(error: unknown): boolean {
  if (toRecord(error)?.name === "AbortError") {
    return true;
  }
  if (error instanceof HttpError || error instanceof BbHttpError) {
    return false;
  }

  const record = toRecord(error);
  if (!record || typeof record.message !== "string") {
    return false;
  }

  const message = normalizeErrorMessage(record.message);
  return (
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("networkerror")
  );
}

export function shouldRetryTransientReadQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= TRANSIENT_READ_RETRY_COUNT) {
    return false;
  }

  return isTransientReadError(error);
}
