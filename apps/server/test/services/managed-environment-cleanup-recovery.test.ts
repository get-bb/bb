import { eq } from "drizzle-orm";
import { createEnvironment, environments, getEnvironment } from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import {
  runEnvironmentCleanupAdvance,
  settleEnvironmentDestroyCommandResult,
} from "../../src/services/environments/environment-cleanup-internal.js";
import {
  MANAGED_ENVIRONMENT_ARCHIVE_CLEANUP_RECOVERY_INTERVAL_MS,
  runManagedEnvironmentArchiveCleanupRecoverySweep,
  runStartupRecoverySweep,
} from "../../src/services/system/periodic-sweeps.js";
import {
  listQueuedEnvironmentCommands,
} from "../helpers/commands.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const SWEEP_START_MS = 4_000_000_000_000;

describe("managed environment cleanup recovery sweep", () => {
  it("marks stale destroying cleanup requests as error without retrying blindly", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        hostId: host.id,
        isGitRepo: false,
        managed: true,
        path: "/tmp/stale-destroying-environment",
        projectId: project.id,
        status: "destroying",
        workspaceProvisionType: "managed-worktree",
      });
      const staleUpdatedAt = Date.now() - 1;
      harness.db
        .update(environments)
        .set({
          destroyAttemptId: "rpc-stale-destroying",
          updatedAt: staleUpdatedAt,
        })
        .where(eq(environments.id, environment.id))
        .run();

      await runStartupRecoverySweep(harness.deps);

      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          environment.id,
        ),
      ).toHaveLength(0);
    });
  });

  it("ignores an older destroy failure after lost destroy recovery marks error", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const workspacePath = "/tmp/stale-failure-after-retry";
      const oldExecutionCreatedAt = Date.now() - 10_000;
      const environment = createEnvironment(harness.db, harness.hub, {
        hostId: host.id,
        isGitRepo: false,
        managed: true,
        path: workspacePath,
        projectId: project.id,
        status: "destroying",
        workspaceProvisionType: "managed-worktree",
      });
      harness.db
        .update(environments)
        .set({
          destroyAttemptId: "rpc-stale-destroy",
          updatedAt: oldExecutionCreatedAt,
        })
        .where(eq(environments.id, environment.id))
        .run();

      await runStartupRecoverySweep(harness.deps);

      harness.db.transaction((tx) => {
        const sideEffects = settleEnvironmentDestroyCommandResult({
          command: {
            type: "environment.destroy",
            environmentId: environment.id,
            workspaceContext: {
              workspacePath,
              workspaceProvisionType: "managed-worktree",
            },
          },
          deps: {
            ...harness.deps,
            db: tx,
            hub: harness.hub,
          },
          execution: {
            createdAt: oldExecutionCreatedAt,
            hostId: host.id,
            id: "rpc-stale-destroy",
          },
          report: {
            completedAt: Date.now(),
            errorCode: "command_timeout",
            errorMessage: "Timed out waiting for command result",
            executionId: "rpc-stale-destroy",
            ok: false,
            type: "environment.destroy",
          },
        });
        expect(sideEffects.postCommitActions).toHaveLength(0);
      });

      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          environment.id,
        ),
      ).toHaveLength(0);
    });
  });

  it("settles a current destroy failure after cleanup request and updatedAt changes", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const workspacePath = "/tmp/current-failure-after-refresh";
      const environment = createEnvironment(harness.db, harness.hub, {
        hostId: host.id,
        isGitRepo: false,
        managed: true,
        path: workspacePath,
        projectId: project.id,
        status: "retiring",
        workspaceProvisionType: "managed-worktree",
      });

      await runEnvironmentCleanupAdvance(harness.deps, {
        environmentId: environment.id,
      });
      const destroyingEnvironment = getEnvironment(harness.db, environment.id);
      if (!destroyingEnvironment?.destroyAttemptId) {
        throw new Error("Expected a claimed destroy attempt");
      }
      const destroyAttemptId = destroyingEnvironment.destroyAttemptId;
      const destroyAttemptUpdatedAt = destroyingEnvironment.updatedAt;

      harness.db
        .update(environments)
        .set({ updatedAt: destroyAttemptUpdatedAt + 1 })
        .where(eq(environments.id, environment.id))
        .run();

      harness.db.transaction((tx) => {
        const sideEffects = settleEnvironmentDestroyCommandResult({
          command: {
            type: "environment.destroy",
            environmentId: environment.id,
            workspaceContext: {
              workspacePath,
              workspaceProvisionType: "managed-worktree",
            },
          },
          deps: {
            ...harness.deps,
            db: tx,
            hub: harness.hub,
          },
          execution: {
            createdAt: destroyAttemptUpdatedAt,
            hostId: host.id,
            id: destroyAttemptId,
          },
          report: {
            completedAt: Date.now(),
            errorCode: "command_timeout",
            errorMessage: "Timed out waiting for command result",
            executionId: destroyAttemptId,
            ok: false,
            type: "environment.destroy",
          },
        });
        expect(sideEffects.postCommitActions).toHaveLength(0);
      });

      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        destroyAttemptId: null,
        status: "retiring",
      });
    });
  });

  it("marks stale destroying cleanup requests without paths as error", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        hostId: host.id,
        managed: true,
        path: null,
        projectId: project.id,
        status: "destroying",
        workspaceProvisionType: "managed-worktree",
      });
      const staleUpdatedAt = Date.now() - 1;
      harness.db
        .update(environments)
        .set({
          destroyAttemptId: "rpc-stale-pathless",
          updatedAt: staleUpdatedAt,
        })
        .where(eq(environments.id, environment.id))
        .run();

      await runStartupRecoverySweep(harness.deps);

      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          environment.id,
        ),
      ).toHaveLength(0);
    });
  });

  it("does not log one cleanup deferral per environment while the host daemon is unavailable", async () => {
    await withTestHarness(async (harness) => {
      const logger = {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      };
      harness.deps.logger = logger;

      const { host, session } = seedHostSession(harness.deps);
      harness.hub.unregisterDaemon(session.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      for (const path of [
        "/tmp/unavailable-cleanup-one",
        "/tmp/unavailable-cleanup-two",
      ]) {
        createEnvironment(harness.db, harness.hub, {
          hostId: host.id,
          isGitRepo: false,
          managed: true,
          path,
          projectId: project.id,
          status: "retiring",
          workspaceProvisionType: "managed-worktree",
        });
      }

      await runStartupRecoverySweep(harness.deps);

      expect(logger.debug).not.toHaveBeenCalledWith(
        expect.objectContaining({ environmentId: expect.any(String) }),
        "Managed environment archive cleanup deferred until host reconnects",
      );
      expect(logger.debug).not.toHaveBeenCalledWith(
        expect.anything(),
        "Managed environment archive cleanup deferred some candidates until host reconnects",
      );
    });
  });

  it("logs a single aggregate cleanup deferral when a sweep partially advances", async () => {
    await withTestHarness(async (harness) => {
      const logger = {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      };
      harness.deps.logger = logger;

      const unavailable = seedHostSession(harness.deps, {
        id: "host-unavailable-cleanup",
      });
      harness.hub.unregisterDaemon(unavailable.session.id);
      const unavailableProject = seedProjectWithSource(harness.deps, {
        hostId: unavailable.host.id,
      });
      createEnvironment(harness.db, harness.hub, {
        hostId: unavailable.host.id,
        isGitRepo: false,
        managed: true,
        path: "/tmp/unavailable-cleanup-environment",
        projectId: unavailableProject.project.id,
        status: "retiring",
        workspaceProvisionType: "managed-worktree",
      });

      const available = seedHostSession(harness.deps, {
        id: "host-available-cleanup",
      });
      const availableProject = seedProjectWithSource(harness.deps, {
        hostId: available.host.id,
      });
      const availableEnvironment = createEnvironment(harness.db, harness.hub, {
        hostId: available.host.id,
        isGitRepo: false,
        managed: true,
        path: null,
        projectId: availableProject.project.id,
        status: "retiring",
        workspaceProvisionType: "managed-worktree",
      });

      await runStartupRecoverySweep(harness.deps);

      expect(getEnvironment(harness.db, availableEnvironment.id)?.status).toBe(
        "destroyed",
      );
      expect(logger.debug).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith(
        {
          deferredEnvironmentCount: 1,
          deferredHostIds: [unavailable.host.id],
        },
        "Managed environment archive cleanup deferred some candidates until host reconnects",
      );
    });
  });

  it("dedupes concurrent cleanup advances before dispatching destroy", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        hostId: host.id,
        isGitRepo: false,
        managed: true,
        path: "/tmp/concurrent-cleanup-environment",
        projectId: project.id,
        status: "retiring",
        workspaceProvisionType: "managed-worktree",
      });

      await Promise.all([
        runEnvironmentCleanupAdvance(harness.deps, {
          environmentId: environment.id,
        }),
        runEnvironmentCleanupAdvance(harness.deps, {
          environmentId: environment.id,
        }),
      ]);

      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "destroying",
      );
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          environment.id,
        ),
      ).toHaveLength(1);
    });
  });

  it("throttles recovery without arming the throttle on empty sweeps", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      await runManagedEnvironmentArchiveCleanupRecoverySweep(
        harness.deps,
        SWEEP_START_MS,
      );

      const firstEnvironment = createEnvironment(harness.db, harness.hub, {
        hostId: host.id,
        managed: true,
        projectId: project.id,
        status: "retiring",
        workspaceProvisionType: "managed-worktree",
      });

      await runManagedEnvironmentArchiveCleanupRecoverySweep(
        harness.deps,
        SWEEP_START_MS + 1,
      );

      expect(getEnvironment(harness.db, firstEnvironment.id)?.status).toBe(
        "destroyed",
      );

      const throttledEnvironment = createEnvironment(harness.db, harness.hub, {
        hostId: host.id,
        managed: true,
        projectId: project.id,
        status: "retiring",
        workspaceProvisionType: "managed-worktree",
      });

      await runManagedEnvironmentArchiveCleanupRecoverySweep(
        harness.deps,
        SWEEP_START_MS + 10_000,
      );

      expect(getEnvironment(harness.db, throttledEnvironment.id)?.status).toBe(
        "retiring",
      );

      await runManagedEnvironmentArchiveCleanupRecoverySweep(
        harness.deps,
        SWEEP_START_MS +
          1 +
          MANAGED_ENVIRONMENT_ARCHIVE_CLEANUP_RECOVERY_INTERVAL_MS,
      );

      expect(getEnvironment(harness.db, throttledEnvironment.id)?.status).toBe(
        "destroyed",
      );
    });
  });
});
