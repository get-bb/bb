import { describe, expect, it } from "vitest";
import {
  classifyDaemonStartFailure,
  PersistedHostAuthRejectedError,
  startWithPersistedAuthRecovery,
  type HostDaemonStartAttempt,
} from "./persisted-auth-recovery.js";
import { ServerResponseError } from "./server-client.js";

function sessionOpenError(status: number): ServerResponseError {
  return new ServerResponseError({
    action: "open session",
    bodyMessage: status === 401 ? "Unauthorized" : "Server error",
    code: status === 401 ? "unauthorized" : null,
    retryable: false,
    status,
    statusText: status === 401 ? "Unauthorized" : "Internal Server Error",
  });
}

describe("classifyDaemonStartFailure", () => {
  it("flags a rejected persisted host key", () => {
    const result = classifyDaemonStartFailure({
      error: sessionOpenError(401),
      usedPersistedAuth: true,
    });
    expect(result).toBeInstanceOf(PersistedHostAuthRejectedError);
  });

  it("finds a credential rejection wrapped in another error", () => {
    const wrapped = new Error("daemon start failed", {
      cause: sessionOpenError(403),
    });
    const result = classifyDaemonStartFailure({
      error: wrapped,
      usedPersistedAuth: true,
    });
    expect(result).toBeInstanceOf(PersistedHostAuthRejectedError);
  });

  it("leaves a rejection of a freshly enrolled key untouched", () => {
    const error = sessionOpenError(401);
    expect(
      classifyDaemonStartFailure({ error, usedPersistedAuth: false }),
    ).toBe(error);
  });

  it("leaves non-credential failures untouched", () => {
    const error = sessionOpenError(500);
    expect(classifyDaemonStartFailure({ error, usedPersistedAuth: true })).toBe(
      error,
    );
  });
});

describe("startWithPersistedAuthRecovery", () => {
  const rejected = () =>
    new PersistedHostAuthRejectedError(sessionOpenError(401));

  it("re-enrolls once when the persisted key is rejected and an enroll key exists", async () => {
    const attempts: HostDaemonStartAttempt[] = [];
    const warnings: string[] = [];
    const result = await startWithPersistedAuthRecovery({
      enrollKey: "bbde_fresh",
      start: async (attempt) => {
        attempts.push(attempt);
        if (!attempt.ignorePersistedAuth) {
          throw rejected();
        }
        return "daemon";
      },
      warn: (message) => warnings.push(message),
    });
    expect(result).toBe("daemon");
    expect(attempts).toEqual([
      { ignorePersistedAuth: false },
      { ignorePersistedAuth: true },
    ]);
    expect(warnings).toHaveLength(1);
  });

  it("does not loop when the re-enrolled start also fails", async () => {
    let calls = 0;
    await expect(
      startWithPersistedAuthRecovery({
        enrollKey: "bbde_fresh",
        start: async () => {
          calls += 1;
          throw rejected();
        },
        warn: () => undefined,
      }),
    ).rejects.toBeInstanceOf(PersistedHostAuthRejectedError);
    expect(calls).toBe(2);
  });

  it("rethrows the rejection when no enroll key is available", async () => {
    let calls = 0;
    await expect(
      startWithPersistedAuthRecovery({
        enrollKey: undefined,
        start: async () => {
          calls += 1;
          throw rejected();
        },
        warn: () => undefined,
      }),
    ).rejects.toBeInstanceOf(PersistedHostAuthRejectedError);
    expect(calls).toBe(1);
  });

  it("does not retry unrelated startup failures", async () => {
    let calls = 0;
    const failure = new Error("lock held");
    await expect(
      startWithPersistedAuthRecovery({
        enrollKey: "bbde_fresh",
        start: async () => {
          calls += 1;
          throw failure;
        },
        warn: () => undefined,
      }),
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
  });
});
