import { getEnvironment } from "@bb/db";
import {
  applyEnvironmentLifecycleEvent,
  recordEnvironmentCleanupRequest,
  requireEnvironmentLifecycleEventApplied,
} from "@bb/db/internal-environment-lifecycle";
import { describe, expect, it } from "vitest";
import { cancelPendingEnvironmentCleanup } from "../../src/services/environments/environment-cleanup-internal.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
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
});
