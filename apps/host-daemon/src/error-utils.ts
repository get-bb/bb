interface ErrorSummary {
  errorMessage: string;
  errorName: string;
}

export function normalizeCaughtError<T>(error: T): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function summarizeError<T>(error: T): ErrorSummary {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorName: error.name,
    };
  }

  return {
    errorMessage: String(error),
    errorName: "NonError",
  };
}

export function runtimeErrorLogFields<T>(error: T): { err: T } | ErrorSummary {
  return process.env.NODE_ENV === "production"
    ? summarizeError(error)
    : { err: error };
}
