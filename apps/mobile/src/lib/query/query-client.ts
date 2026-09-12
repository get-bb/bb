import { toRecord } from "@bb/core-ui";
import { BbHttpError } from "@bb/sdk/browser";
import { QueryClient } from "@tanstack/react-query";

const TRANSIENT_READ_RETRY_COUNT = 2;
export const TRANSIENT_READ_RETRY_DELAY_MS = 250;
const DEFAULT_QUERY_STALE_TIME_MS = 2000;

export function isTransientReadError(error: unknown): boolean {
  if (error instanceof BbHttpError) return false;
  const record = toRecord(error);
  if (!record) return false;
  if (record.name === "AbortError" || record.name === "TimeoutError") {
    return true;
  }
  if (typeof record.message !== "string") return false;
  const message = record.message.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("network connection was lost") ||
    message.startsWith("fetch failed") ||
    message.includes("could not connect to the server")
  );
}

export function shouldRetryTransientReadQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= TRANSIENT_READ_RETRY_COUNT) return false;
  return isTransientReadError(error);
}

export function createProfileQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_QUERY_STALE_TIME_MS,
        refetchOnWindowFocus: true,
        retry: shouldRetryTransientReadQuery,
        retryDelay: TRANSIENT_READ_RETRY_DELAY_MS,
      },
    },
  });
}
