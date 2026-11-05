import { describe, expect, it } from "vitest";
import {
  formatAppUpdateRevision,
  formatAppUpdateTarget,
  runningThreadsWarning,
} from "./app-update-presentation";

describe("app update presentation", () => {
  it("labels source revisions with a short commit", () => {
    expect(
      formatAppUpdateRevision({ commit: "abcdef1234567", version: "1.0.0" }),
    ).toBe("abcdef1");
    expect(
      formatAppUpdateTarget({
        behindSince: "2026-11-02T12:00:00.000Z",
        channel: "main",
        commit: "abcdef1234567",
        commitCount: 1,
        subjects: [],
        version: "1.0.0",
      }),
    ).toBe("abcdef1 (+1 commit)");
  });

  it("warns in the singular and plural", () => {
    expect(runningThreadsWarning(1, false)).toBe(
      "1 thread is running. Updating restarts bb and interrupts it.",
    );
    expect(runningThreadsWarning(3, false)).toBe(
      "3 threads are running. Updating restarts bb and interrupts them.",
    );
  });

  it("says the threads resume when restarts resume them", () => {
    expect(runningThreadsWarning(1, true)).toBe(
      "1 thread is running. Updating restarts bb, and it resumes after the update.",
    );
    expect(runningThreadsWarning(3, true)).toBe(
      "3 threads are running. Updating restarts bb, and they resume after the update.",
    );
  });
});
