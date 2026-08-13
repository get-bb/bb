import { eq } from "drizzle-orm";
import {
  CLOSED_SESSION_ROW_RETENTION_MS,
  createThreadHandoff,
  getThread,
  getThreadHandoffByReplacementThreadId,
  hostDaemonSessions,
  markThreadDeleted,
} from "@bb/db";
import { turnScope } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import {
  type PeriodicSweepJob,
  runThreadHandoffReconciliationSweep,
  runStartupRecoverySweep,
  runPeriodicSweepJobs,
  runPeriodicSweeps,
} from "../../src/services/system/periodic-sweeps.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
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
        pluginService: harness.pluginService,
        pluginCatalogService: harness.pluginCatalogService,
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
        pluginService: harness.pluginService,
        pluginCatalogService: harness.pluginCatalogService,
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

      const deps = {
        ...harness.deps,
        pluginSchedules: harness.pluginService,
        pluginService: harness.pluginService,
        pluginCatalogService: harness.pluginCatalogService,
      };
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

      const deps = {
        ...harness.deps,
        pluginSchedules: harness.pluginService,
        pluginService: harness.pluginService,
        pluginCatalogService: harness.pluginCatalogService,
      };
      await runPeriodicSweepJobs(deps, jobs, 20_000);
      await runPeriodicSweepJobs(deps, jobs, 20_999);
      await runPeriodicSweepJobs(deps, jobs, 21_000);

      expect(runCount).toBe(2);
    });
  });
});

describe("thread handoff reconciliation", () => {
  it("pages provisioning handoffs and settles stored root starts after restart", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const fixtures = Array.from({ length: 3 }, (_, index) => {
        const source = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
        });
        const replacement = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
          status: "active",
        });
        createThreadHandoff(harness.db, {
          archiveSource: true,
          environmentId: environment.id,
          idempotencyKey: `restart-started-${index}`,
          model: "gpt-5.6-codex",
          permissionMode: "accept-edits",
          projectId: project.id,
          providerId: "codex",
          reasoningLevel: "high",
          replacementThreadId: replacement.id,
          serviceTier: null,
          sourceThreadId: source.id,
        });
        seedEvent(harness.deps, {
          data: { providerThreadId: `provider-${index}` },
          environmentId: environment.id,
          providerThreadId: `provider-${index}`,
          scope: turnScope(`root-turn-${index}`),
          sequence: 1,
          threadId: replacement.id,
          type: "turn/started",
        });
        return { replacement, source };
      });

      const result = runThreadHandoffReconciliationSweep(harness.deps, {
        pageSize: 2,
      });

      expect(result).toEqual({
        observation: "observed",
        observed: 3,
        failed: 0,
        started: 3,
      });
      for (const fixture of fixtures) {
        expect(
          getThreadHandoffByReplacementThreadId(
            harness.db,
            fixture.replacement.id,
          ),
        ).toMatchObject({ status: "started" });
        expect(getThread(harness.db, fixture.source.id)?.archivedAt).toEqual(
          expect.any(Number),
        );
      }
    });
  });

  it("fails terminal replacements without a start and leaves live replacements provisioning", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      function add(status: "starting" | "active" | "error", key: string) {
        const source = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
        });
        const replacement = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
          status,
        });
        createThreadHandoff(harness.db, {
          archiveSource: true,
          environmentId: environment.id,
          idempotencyKey: key,
          model: "gpt-5.6-codex",
          permissionMode: "accept-edits",
          projectId: project.id,
          providerId: "codex",
          reasoningLevel: "high",
          replacementThreadId: replacement.id,
          serviceTier: null,
          sourceThreadId: source.id,
        });
        return { replacement, source };
      }
      const failed = add("error", "failed-before-start");
      const deleted = add("starting", "deleted-before-start");
      const starting = add("starting", "still-starting");
      const running = add("active", "still-running");
      markThreadDeleted(harness.db, harness.hub, {
        threadId: deleted.replacement.id,
      });

      runThreadHandoffReconciliationSweep(harness.deps);
      runThreadHandoffReconciliationSweep(harness.deps);

      expect(
        getThreadHandoffByReplacementThreadId(
          harness.db,
          failed.replacement.id,
        ),
      ).toMatchObject({
        status: "failed",
        failureCode: "replacement_thread_failed",
      });
      expect(
        getThreadHandoffByReplacementThreadId(
          harness.db,
          deleted.replacement.id,
        ),
      ).toMatchObject({
        status: "failed",
        failureCode: "replacement_thread_deleted",
      });
      for (const fixture of [starting, running]) {
        expect(
          getThreadHandoffByReplacementThreadId(
            harness.db,
            fixture.replacement.id,
          ),
        ).toMatchObject({ status: "provisioning" });
        expect(getThread(harness.db, fixture.source.id)?.archivedAt).toBeNull();
      }
    });
  });

  it("does not report an empty reconciliation observation as success", async () => {
    await withTestHarness(async (harness) => {
      const info = vi.spyOn(harness.deps.logger, "info");

      expect(runThreadHandoffReconciliationSweep(harness.deps)).toEqual({
        observation: "empty",
        observed: 0,
        failed: 0,
        started: 0,
      });
      expect(info).not.toHaveBeenCalledWith(
        expect.anything(),
        "Thread handoff reconciliation completed",
      );
    });
  });

  it("runs handoff reconciliation during startup recovery", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const source = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const replacement = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "error",
      });
      createThreadHandoff(harness.db, {
        archiveSource: true,
        environmentId: environment.id,
        idempotencyKey: "startup-recovery",
        model: "gpt-5.6-codex",
        permissionMode: "accept-edits",
        projectId: project.id,
        providerId: "codex",
        reasoningLevel: "high",
        replacementThreadId: replacement.id,
        serviceTier: null,
        sourceThreadId: source.id,
      });

      await runStartupRecoverySweep(harness.deps);

      expect(
        getThreadHandoffByReplacementThreadId(harness.db, replacement.id),
      ).toMatchObject({
        status: "failed",
        failureCode: "replacement_thread_failed",
      });
    });
  });
});
