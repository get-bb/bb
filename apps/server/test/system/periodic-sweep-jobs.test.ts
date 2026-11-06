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
  "environment-provider-lifecycle":
    "Runs teardowns concurrently in per-host slots; each environment catches its own failure and keeps retry state on its row.",
  "machine-provider-lifecycle":
    "Runs machine sweeps in the background; each machine catches its own failure and keeps retry state on its row.",
  "machine-auth-prune": "One bulk DELETE with no per-item work.",
  "completed-event-output-migration":
    "Cursor scan per target; a failing target is backed off through the shared failure records while the other targets continue.",
  "retained-event-output-expiry": "Bulk DELETE of expired rows in batches.",
  "closed-session-prune": "One bulk DELETE with no per-item work.",
  "exited-terminal-session-prune": "One bulk DELETE with no per-item work.",
  "queued-message-auto-send":
    "Each message records its own failure and retry schedule, which users see in the queue.",
  "due-scheduled-queue-dispatch":
    "Each message records its own failure and retry schedule, which users see in the queue.",
  "failed-queue-message-retry":
    "Each message records its own failure and retry schedule, which users see in the queue.",
  "orphaned-queue-wait-clear":
    "Each message records its own failure and retry schedule, which users see in the queue.",
  "thread-event-pruning":
    "Cursor scan; a failing thread is skipped and recorded through the shared failure records, and the policy keeps going.",
  "database-maintenance": "One maintenance pass with no item list.",
  "plugin-database-maintenance": "One vacuum check per open plugin database.",
  "project-attachment-backfill":
    "One project per pass; each project records its own error and is skipped for 60 s after a failure.",
  "project-attachment-orphan-prune":
    "Catches each attachment's failure and keeps claim times on the attachment rows.",
  "thread-storage-orphan-cleanup":
    "Per-host queue tied to the daemon session; per-directory errors skip the directory and host errors park the host.",
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
