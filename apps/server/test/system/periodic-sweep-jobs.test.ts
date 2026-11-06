import { describe, expect, it, vi } from "vitest";
import { getThread, listSweepItemFailures, markThreadDeleted } from "@bb/db";
import {
  PERIODIC_SWEEP_JOBS,
  runThreadLifecycleSweep,
} from "../../src/services/system/periodic-sweeps.js";
import {
  seedHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const TASK_JOBS: Record<string, string> = {
  "environment-preparation-owner-release": "One bulk UPDATE with no items.",
  "machine-auth-prune": "One bulk DELETE with no items.",
  "retained-event-output-expiry": "Bulk DELETE of expired rows in batches.",
  "closed-session-prune": "One bulk DELETE with no items.",
  "exited-terminal-session-prune": "One bulk DELETE with no items.",
  "queued-message-claim-release": "One bulk UPDATE with no items.",
  "database-maintenance": "One maintenance pass with no items.",
  "plugin-database-maintenance": "One vacuum check per open plugin database.",
  "thread-event-pruning":
    "Cursor scan; a failing thread is skipped and recorded through the shared failure records.",
  "completed-event-output-migration":
    "Cursor scan per target; a failing target is backed off through the shared failure records.",
  "machine-provider-lifecycle":
    "Starts every machine's sweep without waiting for it, and re-requests removal for machines whose sweep is still running, which the runner's in-flight skip would prevent.",
  "project-attachment-orphan-prune":
    "One project per pass; the cursor moves past the project before pruning it, and each attachment's failure is caught.",
};

describe("periodic sweep jobs", () => {
  it("runs every job that works through items on the item sweep runner, and lists a reason for every other job", async () => {
    await withTestHarness(async (harness) => {
      const deps = {
        ...harness.deps,
        pluginSchedules: harness.pluginService,
        plugins: harness.pluginService,
      };
      const taskJobs = PERIODIC_SWEEP_JOBS.filter(
        (job) => job.kind === "task",
      ).map((job) => job.name);
      expect(taskJobs.sort()).toEqual(Object.keys(TASK_JOBS).sort());
      for (const job of PERIODIC_SWEEP_JOBS) {
        if (job.kind === "items")
          expect(job.sweep(deps, Date.now()).name).toBe(job.name);
      }
      expect(new Set(PERIODIC_SWEEP_JOBS.map((job) => job.name)).size).toBe(
        PERIODIC_SWEEP_JOBS.length,
      );
    });
  });

  it("finishes deleting other threads when one deleted thread's finalization throws", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const broken = seedThread(harness.deps, { projectId: project.id });
      const healthy = seedThread(harness.deps, { projectId: project.id });
      for (const thread of [broken, healthy]) {
        markThreadDeleted(harness.db, harness.deps.hub, {
          threadId: thread.id,
        });
      }
      const close = vi
        .spyOn(harness.deps.terminalSessions, "closeDeletedThreadTerminals")
        .mockImplementation(({ threadId }) => {
          if (threadId === broken.id) throw new Error("terminal close failed");
        });

      await runThreadLifecycleSweep(harness.deps);
      close.mockRestore();

      expect(getThread(harness.db, healthy.id)).toBeNull();
      expect(getThread(harness.db, broken.id)?.deletedAt).toEqual(
        expect.any(Number),
      );
      expect(
        listSweepItemFailures(harness.db, "deleted-thread-finalization"),
      ).toMatchObject([
        { attempts: 1, itemKey: broken.id, lastError: "terminal close failed" },
      ]);
    });
  });
});
