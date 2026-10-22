import { describe, expect, it } from "vitest";
import type { SystemAppUpdateResult } from "@bb/server-contract";
import {
  appUpdateConfirmDescription,
  appUpdateSuccessTitle,
  formatAppUpdateRevision,
  formatAppUpdateTarget,
} from "./app-update-presentation";

const updated: SystemAppUpdateResult = {
  acknowledged: false,
  finishedAt: "2026-10-22T00:00:00.000Z",
  from: { commit: null, version: "0.46.0" },
  id: "update-1",
  logTail: [],
  message: null,
  outcome: "updated",
  phase: null,
  to: { commit: null, version: "0.47.0" },
};

describe("app update presentation", () => {
  it("labels source revisions with a short commit", () => {
    expect(
      formatAppUpdateRevision({ commit: "abcdef1234567", version: "1.0.0" }),
    ).toBe("abcdef1");
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

  it("counts running commands in the update confirmation", () => {
    expect(appUpdateConfirmDescription(3)).toBe(
      "3 commands are running. Updating stops them now. bb is back in under a minute, and each agent picks up where it left off.",
    );
    expect(appUpdateConfirmDescription(1)).toBe(
      "1 command is running. Updating stops it now. bb is back in under a minute, and each agent picks up where it left off.",
    );
  });

  it("names the resumed threads in the post-update notice", () => {
    expect(appUpdateSuccessTitle(updated, 3)).toBe(
      "Updated to bb 0.47.0 · 3 threads picking up where they left off",
    );
    expect(appUpdateSuccessTitle(updated, 1)).toBe(
      "Updated to bb 0.47.0 · 1 thread picking up where it left off",
    );
    expect(appUpdateSuccessTitle(updated, 0)).toBe("Updated bb to 0.47.0");
  });
});
