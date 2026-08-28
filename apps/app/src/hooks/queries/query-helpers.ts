import { HttpError } from "@/lib/api";
import { BbHttpError } from "@/lib/sdk";
import { z } from "zod";

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

const transientErrorSchema = z.object({
  message: z.string().optional(),
  name: z.string().optional(),
});

function parseTransientError(cause: unknown) {
  const parsed = transientErrorSchema.safeParse(cause);
  if (parsed.success) {
    return parsed.data;
  }
  if (cause instanceof Error) {
    return { message: cause.message, name: cause.name };
  }
  return null;
}

export function isTransientReadError(cause: unknown): boolean {
  const parsed = parseTransientError(cause);
  if (parsed?.name === "AbortError") {
    return true;
  }
  if (cause instanceof HttpError || cause instanceof BbHttpError) {
    return false;
  }

  if (parsed?.message === undefined) {
    return false;
  }

  const message = normalizeErrorMessage(parsed.message);
  return (
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("networkerror")
  );
}

export function shouldRetryTransientReadQuery(
  failureCount: number,
  cause: unknown,
): boolean {
  if (failureCount >= TRANSIENT_READ_RETRY_COUNT) {
    return false;
  }

  return isTransientReadError(cause);
}
