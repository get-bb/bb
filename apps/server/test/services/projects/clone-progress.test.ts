import { expect, it, vi } from "vitest";
import { createCloneProgressReporter } from "../../../src/services/projects/clone-progress.js";

it("coalesces bursts, skips duplicates, and flushes the final update on disposal", async () => {
  const log = vi.fn();
  const progress = createCloneProgressReporter({ log, step: log });
  try {
    progress.report.log("start");
    for (let i = 0; i < 1000; i++)
      progress.report.log(`Receiving objects: ${i}`);
    expect(log).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenLastCalledWith("Receiving objects: 999");
    progress.report.log("Receiving objects: 999");
    progress.dispose();
    expect(log).toHaveBeenCalledTimes(2);
  } finally {
    progress.dispose();
  }
  const final = createCloneProgressReporter({ log, step: log });
  final.report.log("start");
  final.report.log("done");
  final.dispose();
  expect(log).toHaveBeenLastCalledWith("done");
  final.report.log("late");
  expect(log).toHaveBeenLastCalledWith("done");
});
