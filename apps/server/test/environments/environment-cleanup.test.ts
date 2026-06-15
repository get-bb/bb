import { getEnvironment } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
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
  it("does not reprovision a destroying environment and finishes the destroy", async () => {
    // Decision B*: nothing reprovisions a dying environment, so a destroy runs
    // to completion. The ENVIRONMENT_LIFECYCLE table has no provision cell from
    // `destroying`, so a reprovision dispatch is a structural no-op — the race
    // between a stale provision settlement and a destroy is gone by
    // construction.
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-destroy-no-revive",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/destroy-no-revive-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/destroy-no-revive",
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
      const destroyingEnvironment = getEnvironment(harness.db, environment.id);
      expect(destroyingEnvironment).toMatchObject({
        destroyAttemptId: expect.any(String),
        status: "destroying",
      });
      if (!destroyingEnvironment) {
        throw new Error("Expected destroying environment");
      }

      // A reprovision dispatch against the destroying environment no-ops: the
      // provision.requested transition has no cell from `destroying`, so the
      // row is untouched.
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "starting",
      });
      await dispatchManagedEnvironmentReprovision(harness.deps, {
        environment: destroyingEnvironment,
        projectId: project.id,
        provisionEventSequence: 1,
        provisioningId: "tpv-destroy-no-revive",
        threadId: thread.id,
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "destroying",
      });

      // The destroy completes and the environment becomes terminal.
      await reportQueuedCommandSuccess(harness, destroyCommand, {});
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "destroyed",
      });
    });
  });
});
