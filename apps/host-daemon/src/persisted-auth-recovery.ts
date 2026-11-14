import { ServerResponseError } from "./server-client.js";

const MAX_CAUSE_DEPTH = 5;

export interface HostDaemonStartAttempt {
  ignorePersistedAuth: boolean;
}

export class PersistedHostAuthRejectedError extends Error {
  constructor(readonly rejection: ServerResponseError) {
    super(rejection.message, { cause: rejection });
    this.name = "PersistedHostAuthRejectedError";
  }
}

export function findCredentialRejection(
  error: unknown,
): ServerResponseError | null {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current instanceof Error;
    depth += 1
  ) {
    if (
      current instanceof ServerResponseError &&
      (current.status === 401 || current.status === 403)
    ) {
      return current;
    }
    current = current.cause;
  }
  return null;
}

export function classifyDaemonStartFailure(args: {
  error: unknown;
  usedPersistedAuth: boolean;
}): unknown {
  if (!args.usedPersistedAuth) {
    return args.error;
  }
  const rejection = findCredentialRejection(args.error);
  return rejection ? new PersistedHostAuthRejectedError(rejection) : args.error;
}

export async function startWithPersistedAuthRecovery<T>(args: {
  enrollKey: string | undefined;
  start: (attempt: HostDaemonStartAttempt) => Promise<T>;
  warn: (message: string, fields: Record<string, unknown>) => void;
}): Promise<T> {
  try {
    return await args.start({ ignorePersistedAuth: false });
  } catch (error) {
    if (
      !(error instanceof PersistedHostAuthRejectedError) ||
      args.enrollKey === undefined
    ) {
      throw error;
    }
    args.warn(
      "Server rejected the persisted host credentials; re-enrolling with the provided enroll key",
      { status: error.rejection.status, code: error.rejection.code },
    );
    return args.start({ ignorePersistedAuth: true });
  }
}
