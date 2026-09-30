import { describe, expect, it } from "vitest";
import type { SystemAppUpdateResult } from "@bb/server-contract";
import {
  describeAppUpdateResult,
  formatAppUpdateRevision,
  formatAppUpdateTarget,
  runningThreadsWarning,
} from "./app-update-presentation";

function result(
  overrides: Partial<SystemAppUpdateResult>,
): SystemAppUpdateResult {
  return {
    acknowledged: false,
    finishedAt: "2026-09-23T00:00:00.000Z",
    from: { commit: null, version: "1.0.0" },
    id: "update-1",
    logTail: [],
    message: null,
    outcome: "updated",
    phase: null,
    to: { commit: null, version: "1.1.0" },
    ...overrides,
  };
}

describe("app update presentation", () => {
  it("labels source revisions with a short commit", () => {
    expect(
      formatAppUpdateRevision({ commit: "abcdef1234567", version: "1.0.0" }),
    ).toBe("1.0.0 (abcdef1)");
    expect(
      formatAppUpdateTarget({
        channel: "main",
        commit: "abcdef1234567",
        commitCount: 1,
        subjects: [],
        version: "1.0.0",
      }),
    ).toBe("abcdef1 (+1 commit)");
  });

  it("names the target version and carries the failure message", () => {
    expect(
      describeAppUpdateResult(
        result({ message: "npm install failed", outcome: "failed" }),
      ),
    ).toEqual({
      description: "npm install failed",
      title: "Update to 1.1.0 failed",
      tone: "error",
    });
    expect(describeAppUpdateResult(result({})).tone).toBe("success");
  });

  it("warns in the singular and plural", () => {
    expect(runningThreadsWarning(1)).toBe(
      "1 thread is running. Updating restarts bb and interrupts it.",
    );
    expect(runningThreadsWarning(3)).toBe(
      "3 threads are running. Updating restarts bb and interrupts them.",
    );
  });
});
