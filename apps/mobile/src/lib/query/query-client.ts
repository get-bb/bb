import { toRecord } from "@bb/core-ui";
import { BbHttpError } from "@bb/sdk/browser";
import {
  MutationCache,
  QueryClient,
  type Mutation,
  type QueryClientConfig,
} from "@tanstack/react-query";
import { z } from "zod";

const TRANSIENT_READ_RETRY_COUNT = 2;
export const TRANSIENT_READ_RETRY_DELAY_MS = 250;
const DEFAULT_QUERY_STALE_TIME_MS = 2000;

export function isTransientReadError(cause: unknown): boolean {
  if (cause instanceof BbHttpError) return false;
  const record = toRecord(cause);
  if (!record) return false;
  if (record.name === "AbortError" || record.name === "TimeoutError") {
    return true;
  }
  const parsedMessage = z.string().safeParse(record.message);
  if (!parsedMessage.success) return false;
  const message = parsedMessage.data.replace(/\s+/g, " ").trim().toLowerCase();
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
  cause: unknown,
): boolean {
  if (failureCount >= TRANSIENT_READ_RETRY_COUNT) return false;
  return isTransientReadError(cause);
}

export interface CreateProfileQueryClientOptions {
  defaultOptions?: QueryClientConfig["defaultOptions"];
  onMutationError?: (
    cause: unknown,
    mutation: Mutation<unknown, unknown, unknown, unknown>,
  ) => void;
}

export function createProfileQueryClient(
  options: CreateProfileQueryClientOptions = {},
): QueryClient {
  const defaultOptions = options.defaultOptions;
  const onMutationError = options.onMutationError;
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (!onMutationError) return;
        const meta = toRecord(mutation.meta);
        if (meta?.showErrorToast === false) return;
        onMutationError(error, mutation);
      },
    }),
    defaultOptions: {
      ...defaultOptions,
      queries: {
        staleTime: DEFAULT_QUERY_STALE_TIME_MS,
        refetchOnWindowFocus: true,
        retry: shouldRetryTransientReadQuery,
        retryDelay: TRANSIENT_READ_RETRY_DELAY_MS,
        ...defaultOptions?.queries,
      },
    },
  });
}
