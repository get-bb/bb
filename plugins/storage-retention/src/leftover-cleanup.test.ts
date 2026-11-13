import { expect, it } from "vitest";
import { summarizeLeftoverRetry } from "./leftover-cleanup.js";

const kept = (environmentId: string) => ({
  environmentId,
  message: "Kept because it has 5 uncommitted changes",
});

it("reports a checkout kept for uncommitted changes as a finished cleanup, not a failure", () => {
  expect(
    summarizeLeftoverRetry({
      retriedCount: 0,
      kept: [kept("env_a")],
      failed: [],
    }),
  ).toEqual({
    state: "completed",
    message: "Kept because it has 5 uncommitted changes",
  });
});

it("fails only when nothing was removed or kept", () => {
  expect(
    summarizeLeftoverRetry({
      retriedCount: 0,
      kept: [],
      failed: [
        { environmentId: "env_a", message: "git worktree remove failed" },
      ],
    }),
  ).toEqual({ state: "failed", message: "git worktree remove failed" });
  expect(
    summarizeLeftoverRetry({
      retriedCount: 2,
      kept: [kept("env_b"), kept("env_c")],
      failed: [
        { environmentId: "env_a", message: "git worktree remove failed" },
      ],
    }),
  ).toEqual({
    state: "completed",
    message:
      "Removed 2 checkouts; 2 kept because they have uncommitted changes or something is running in them; 1 couldn’t be removed",
  });
});
