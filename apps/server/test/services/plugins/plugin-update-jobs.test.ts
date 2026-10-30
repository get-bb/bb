import { expect, it, vi } from "vitest";
import type {
  PluginApplyUpdateResult,
  PluginRollbackResult,
} from "@bb/server-contract";
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
    kind: "update",
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
    kind: "update",
    expectedVersion: null,
    run: next,
  });
  const duplicate = jobs.start({
    pluginId: "one",
    displayName: "One",
    kind: "update",
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
    kind: "update",
    expectedVersion: "1.1.0",
    run: () => waiting,
  });
  const sameReview = jobs.start({
    pluginId: "notes",
    displayName: "Notes",
    kind: "update",
    expectedVersion: "1.1.0",
    run: async () => result,
  });
  const otherReview = jobs.start({
    pluginId: "notes",
    displayName: "Notes",
    kind: "update",
    expectedVersion: "1.2.0",
    run: async () => result,
  });
  const unbound = jobs.start({
    pluginId: "notes",
    displayName: "Notes",
    kind: "update",
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

it("never merges a rollback into an update of the same plugin", async () => {
  let finish = (_result: PluginApplyUpdateResult) => {};
  const waiting = new Promise<PluginApplyUpdateResult>((resolve) => {
    finish = resolve;
  });
  const result: PluginRollbackResult = {
    applied: true,
    from: { version: "1.1.0", label: "1.1.0", display: "1.1.0" },
    to: { version: "1.0.0", label: "1.0.0", display: "1.0.0" },
    outcome: "reverted",
  };
  const jobs = createPluginUpdateJobs({ notifyChanged: () => {} });
  const update = jobs.start({
    pluginId: "notes",
    displayName: "Notes",
    kind: "update",
    expectedVersion: "1.0.0",
    run: () => waiting,
  });
  const rollback = jobs.start({
    pluginId: "notes",
    displayName: "Notes",
    kind: "rollback",
    expectedVersion: "1.0.0",
    run: async () => result,
  });
  const sameRollback = jobs.start({
    pluginId: "notes",
    displayName: "Notes",
    kind: "rollback",
    expectedVersion: "1.0.0",
    run: async () => result,
  });

  expect(rollback.id).not.toBe(update.id);
  expect(sameRollback.id).toBe(rollback.id);
  expect(jobs.get(rollback.id)).toMatchObject({
    kind: "rollback",
    state: "queued",
  });
  finish({ ...result, outcome: "updated" });
  await expect(jobs.settled(update.id)).resolves.toMatchObject({
    kind: "update",
    result: { outcome: "updated" },
  });
  await expect(jobs.settled(rollback.id)).resolves.toMatchObject({
    kind: "rollback",
    state: "completed",
    result: { outcome: "reverted" },
  });
});
