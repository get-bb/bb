import { expect, it, vi } from "vitest";
import type { PluginApplyUpdateResult } from "@bb/server-contract";
import { createPluginUpdateJobs } from "../../../src/services/plugins/plugin-update-jobs.js";
import { reportPluginUpdatePhase } from "../../../src/services/plugins/plugin-update-progress.js";

it("deduplicates an active update, queues other updates, and proceeds after failure", async () => {
  let reject = (_error: Error) => {};
  const waiting = new Promise<PluginApplyUpdateResult>(
    (_resolve, rejectPromise) => {
      reject = rejectPromise;
    },
  );
  const jobs = createPluginUpdateJobs({ notifyChanged: () => {} });
  const first = jobs.start({
    pluginId: "one",
    displayName: "One",
    run: async () => {
      reportPluginUpdatePhase("checking");
      return waiting;
    },
  });
  const next = vi.fn(async (): Promise<PluginApplyUpdateResult> => ({
    applied: false,
    from: { version: "1", display: "1" },
    outcome: "rolled-back",
    detail: "restored",
  }));
  const second = jobs.start({ pluginId: "two", displayName: "Two", run: next });
  const duplicate = jobs.start({
    pluginId: "one",
    displayName: "One",
    run: next,
  });
  expect(duplicate.id).toBe(first.id);
  expect(jobs.get(first.id)).toMatchObject({
    state: "running",
    phase: "checking",
  });
  expect(jobs.get(second.id)?.state).toBe("queued");
  expect(next).not.toHaveBeenCalled();
  reject(new Error("download failed"));
  await expect(jobs.settled(first.id)).resolves.toMatchObject({
    state: "failed",
    error: "download failed",
  });
  await expect(jobs.settled(second.id)).resolves.toMatchObject({
    state: "completed",
    result: { outcome: "rolled-back", detail: "restored" },
  });
  expect(next).toHaveBeenCalledOnce();
});
