type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD"]);
const TRANSIENT_FETCH_ERROR_CODES = new Set(["ECONNRESET", "UND_ERR_SOCKET"]);
const TRANSIENT_FETCH_MAX_ATTEMPTS = 2;
const TRANSIENT_FETCH_RETRY_DELAY_MS = 25;

function getFetchMethod(input: FetchInput, init: FetchInit): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }
  if (input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function getErrorCode(error: Error): string | null {
  const cause = error.cause;
  if (
    cause instanceof Error &&
    "code" in cause &&
    typeof cause.code === "string"
  ) {
    return cause.code;
  }
  return null;
}

function isTransientFetchError(error: Error): boolean {
  return (
    error instanceof TypeError &&
    error.message === "fetch failed" &&
    TRANSIENT_FETCH_ERROR_CODES.has(getErrorCode(error) ?? "")
  );
}

function isRetryableFetch(input: FetchInput, init: FetchInit): boolean {
  return IDEMPOTENT_METHODS.has(getFetchMethod(input, init));
}

function waitForRetryDelay(): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, TRANSIENT_FETCH_RETRY_DELAY_MS),
  );
}

export function createIntegrationFetch(): typeof fetch {
  return async (input, init) => {
    const retryable = isRetryableFetch(input, init);

    for (
      let attempt = 1;
      attempt <= TRANSIENT_FETCH_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await fetch(input, init);
      } catch (error) {
        const shouldRetry =
          retryable &&
          attempt < TRANSIENT_FETCH_MAX_ATTEMPTS &&
          error instanceof Error &&
          isTransientFetchError(error);
        if (!shouldRetry) {
          throw error;
        }
        await waitForRetryDelay();
      }
    }

    throw new Error("Integration fetch retry loop exited unexpectedly");
  };
}
