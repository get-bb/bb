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

  it("warns in the singular and plural", () => {
    expect(runningThreadsWarning(1)).toBe(
      "1 thread is running. Updating restarts bb and interrupts it.",
    );
    expect(runningThreadsWarning(3)).toBe(
      "3 threads are running. Updating restarts bb and interrupts them.",
    );
  });
});
