import { getEnvironment, getThread, listEvents } from "@bb/db";
import {
  applyEnvironmentLifecycleEvent,
  recordEnvironmentCleanupRequest,
  requireEnvironmentLifecycleEventApplied,
} from "@bb/db/internal-environment-lifecycle";
import { describe, expect, it } from "vitest";
import {
  cancelPendingEnvironmentCleanup,
  requestEnvironmentCleanup,
  runEnvironmentCleanupAdvance,
} from "../../src/services/environments/environment-cleanup-internal.js";
import { dispatchManagedEnvironmentReprovision } from "../../src/services/environments/environment-provisioning-internal.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("environment cleanup", () => {
  it("does not cancel cleanup after destroy is in progress", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-cleanup-destroying",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        projectId: project.id,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      recordEnvironmentCleanupRequest(
        harness.db,
        harness.hub,
        environment.id,
        {},
      );
      requireEnvironmentLifecycleEventApplied(
        applyEnvironmentLifecycleEvent(harness.db, harness.hub, {
          environmentId: environment.id,
          event: {
            type: "destroy.dispatched",
            destroyAttemptId: "rpc_test_destroy",
          },
        }),
      );

      const result = cancelPendingEnvironmentCleanup(harness.deps, {
        environmentId: environment.id,
      });

      expect(result).toBe("in_progress");
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: "safe",
        status: "destroying",
      });
    });
  });

  it("ignores a late destroy success after the environment was revived", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-destroy-after-revive",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/destroy-after-revive-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/destroy-after-revive",
        projectId: project.id,
        status: "ready",
        workspaceProvisionType: "personal",
      });

      requestEnvironmentCleanup(harness.deps, {
        environmentId: environment.id,
      });
      await runEnvironmentCleanupAdvance(harness.deps, {
        environmentId: environment.id,
      });
      const destroyCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        destroyAttemptId: expect.any(String),
        status: "destroying",
      });

      // A new thread revives the environment while the destroy RPC is still
      // in flight.
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "provisioning",
      });
      const destroyingEnvironment = getEnvironment(harness.db, environment.id);
      if (!destroyingEnvironment) {
        throw new Error("Expected destroying environment");
      }
      await dispatchManagedEnvironmentReprovision(harness.deps, {
        environment: destroyingEnvironment,
        projectId: project.id,
        provisionEventSequence: 1,
        provisioningId: "tpv-destroy-after-revive",
        threadId: thread.id,
      });
      const revived = getEnvironment(harness.db, environment.id);
      expect(revived).toMatchObject({ status: "provisioning" });

      await reportQueuedCommandSuccess(harness, destroyCommand, {});

      // destroy.succeeded has no ENVIRONMENT_LIFECYCLE cell for
      // "provisioning": the late success is an illegal-transition no-op, the
      // environment row is untouched, and the revived thread is not marked
      // as having lost its workspace.
      expect(getEnvironment(harness.db, environment.id)).toEqual(revived);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "provisioning",
      });
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.type,
        ),
      ).not.toContain("system/error");
    });
  });
});
