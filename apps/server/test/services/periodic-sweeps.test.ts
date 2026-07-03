import { eq } from "drizzle-orm";
import { CLOSED_SESSION_ROW_RETENTION_MS, hostDaemonSessions } from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import {
  type PeriodicSweepJob,
  runPeriodicSweepJobs,
  runPeriodicSweeps,
} from "../../src/services/system/periodic-sweeps.js";
import { seedHostSession } from "../helpers/seed.js";
import { testLogger, withTestHarness } from "../helpers/test-app.js";

type ReleaseCallback = () => void;

function releaseRunningJob(release: ReleaseCallback | null): void {
  if (!release) {
    throw new Error("Expected a pending sweep job");
  }
  release();
}

describe("runPeriodicSweeps", () => {
  it("continues later sweep jobs after an earlier job fails", async () => {
    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps);
      const closedAt = Date.now() - CLOSED_SESSION_ROW_RETENTION_MS - 1;
      harness.db
        .update(hostDaemonSessions)
        .set({
          closedAt,
          status: "closed",
          updatedAt: closedAt,
        })
        .where(eq(hostDaemonSessions.id, session.id))
        .run();

      const logger = {
        ...testLogger,
        error: vi.fn(),
      };
      const deps = {
        ...harness.deps,
        logger,
        machineAuth: {
          ...harness.deps.machineAuth,
          pruneExpiredKeys: vi.fn(async () => {
            throw new Error("machine auth prune failed");
          }),
        },
        pluginSchedules: harness.pluginService,
      };

      await runPeriodicSweeps(deps);

      const sessionAfterSweep = harness.db
        .select({ id: hostDaemonSessions.id })
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, session.id))
        .get();
      expect(sessionAfterSweep).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          sweepJob: "machine-auth-prune",
          sweepJobCategory: "retention",
        }),
        "Periodic sweep job failed",
      );
    });
  });

  it("isolates job failures in the generic runner", async () => {
    await withTestHarness(async (harness) => {
      const logger = {
        ...testLogger,
        error: vi.fn(),
      };
      const deps = {
        ...harness.deps,
        logger,
        pluginSchedules: harness.pluginService,
      };
      let laterJobRuns = 0;
      const jobs: PeriodicSweepJob[] = [
        {
          cadenceMs: 0,
          category: "retention",
          name: "test-failing-sweep",
          run() {
            throw new Error("synthetic sweep failure");
          },
        },
        {
          cadenceMs: 0,
          category: "retention",
          name: "test-later-sweep",
          run() {
            laterJobRuns += 1;
          },
        },
      ];

      await runPeriodicSweepJobs(deps, jobs, Date.now());

      expect(laterJobRuns).toBe(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          sweepJob: "test-failing-sweep",
          sweepJobCategory: "retention",
        }),
        "Periodic sweep job failed",
      );
    });
  });

  it("skips a generic job that is already running in another tick", async () => {
    await withTestHarness(async (harness) => {
      let runCount = 0;
      let releaseJob: (() => void) | null = null;
      let resolveJobStarted: (() => void) | null = null;
      const jobStarted = new Promise<void>((resolveStarted) => {
        resolveJobStarted = resolveStarted;
      });
      const jobs: PeriodicSweepJob[] = [
        {
          cadenceMs: 0,
          category: "maintenance",
          name: "test-overlap-sweep",
          async run() {
            runCount += 1;
            if (resolveJobStarted) {
              resolveJobStarted();
            }
            await new Promise<void>((resolveRunningJob) => {
              releaseJob = resolveRunningJob;
            });
          },
        },
      ];

      const deps = { ...harness.deps, pluginSchedules: harness.pluginService };
      const firstSweep = runPeriodicSweepJobs(deps, jobs, 10_000);
      await jobStarted;
      await runPeriodicSweepJobs(deps, jobs, 10_001);
      expect(runCount).toBe(1);
      releaseRunningJob(releaseJob);
      await firstSweep;
    });
  });

  it("does not run cadence-limited generic jobs early", async () => {
    await withTestHarness(async (harness) => {
      let runCount = 0;
      const jobs: PeriodicSweepJob[] = [
        {
          cadenceMs: 1_000,
          category: "maintenance",
          name: "test-cadence-sweep",
          run() {
            runCount += 1;
          },
        },
      ];

      const deps = { ...harness.deps, pluginSchedules: harness.pluginService };
      await runPeriodicSweepJobs(deps, jobs, 20_000);
      await runPeriodicSweepJobs(deps, jobs, 20_999);
      await runPeriodicSweepJobs(deps, jobs, 21_000);

      expect(runCount).toBe(2);
    });
  });
});
