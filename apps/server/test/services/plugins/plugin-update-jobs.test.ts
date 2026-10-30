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
    expectedVersion: null,
    run: async () => {
      reportPluginUpdatePhase("checking");
      return waiting;
    },
  });
  const next = vi.fn(async (): Promise<PluginApplyUpdateResult> => ({
    applied: false,
    from: { version: "1", label: "1", display: "1" },
    outcome: "rolled-back",
    detail: "restored",
  }));
  const second = jobs.start({
    pluginId: "two",
    displayName: "Two",
    expectedVersion: null,
    run: next,
  });
  const duplicate = jobs.start({
    pluginId: "one",
    displayName: "One",
    expectedVersion: null,
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

it("joins an active update only when it applies the same reviewed version", async () => {
  let finish = (_result: PluginApplyUpdateResult) => {};
  const waiting = new Promise<PluginApplyUpdateResult>((resolve) => {
    finish = resolve;
  });
  const result: PluginApplyUpdateResult = {
    applied: false,
    from: { version: "1.0.0", label: "1.0.0", display: "1.0.0" },
    outcome: "current",
  };
  const jobs = createPluginUpdateJobs({ notifyChanged: () => {} });
  const reviewed = jobs.start({
    pluginId: "notes",
    displayName: "Notes",
    expectedVersion: "1.1.0",
    run: () => waiting,
  });
  const sameReview = jobs.start({
    pluginId: "notes",
    displayName: "Notes",
    expectedVersion: "1.1.0",
    run: async () => result,
  });
  const otherReview = jobs.start({
    pluginId: "notes",
    displayName: "Notes",
    expectedVersion: "1.2.0",
    run: async () => result,
  });
  const unbound = jobs.start({
    pluginId: "notes",
    displayName: "Notes",
    expectedVersion: null,
    run: async () => result,
  });

  expect(sameReview.id).toBe(reviewed.id);
  expect(new Set([reviewed.id, otherReview.id, unbound.id]).size).toBe(3);
  expect(jobs.get(otherReview.id)?.state).toBe("queued");
  finish(result);
  await expect(jobs.settled(unbound.id)).resolves.toMatchObject({
    state: "completed",
  });
});
