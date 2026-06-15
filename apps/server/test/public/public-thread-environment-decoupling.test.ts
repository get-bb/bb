import { archiveThread, getEnvironment, getThread } from "@bb/db";
import {
  applyEnvironmentLifecycleEvent,
  recordEnvironmentCleanupRequest,
  requireEnvironmentLifecycleEventApplied,
} from "@bb/db/internal-environment-lifecycle";
import type { EnvironmentStatus } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

/**
 * Decision B* (plans/lifecycle-target-state.md): the thread record-lifecycle
 * (archive/un-archive) is decoupled from the environment lifecycle. Un-archive
 * is a pure record op, and a thread pointing at a gone environment surfaces the
 * "environment is gone" condition instead of reprovisioning.
 */
describe("thread environment decoupling (B*)", () => {
  it("un-archives without touching a pending environment cleanup", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-unarchive-pure",
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
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      archiveThread(harness.db, harness.hub, thread.id);
      // A deferred cleanup is pending on the (still-ready) environment.
      recordEnvironmentCleanupRequest(harness.db, harness.hub, environment.id, {
        requestedAt: 1_000,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      // The thread is un-archived (pure record op)...
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
      // ...and the cleanup intent is left untouched — cleanup is monotonic and
      // un-archive never cancels it.
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupRequestedAt: 1_000,
        status: "ready",
      });
    });
  });

  it("un-archives a thread whose cleanup is already in progress without a 409", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-unarchive-destroying",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        projectId: project.id,
        path: "/tmp/unarchive-destroying",
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      archiveThread(harness.db, harness.hub, thread.id);
      recordEnvironmentCleanupRequest(harness.db, harness.hub, environment.id, {
        requestedAt: 1_000,
      });
      requireEnvironmentLifecycleEventApplied(
        applyEnvironmentLifecycleEvent(harness.db, harness.hub, {
          environmentId: environment.id,
          event: {
            type: "destroy.dispatched",
            destroyAttemptId: "rpc_unarchive_destroying",
          },
        }),
      );
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "destroying",
      );

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );

      // The old 409 "environment cleanup in progress" path is gone — un-archive
      // succeeds as a pure record op and the destroy keeps running.
      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "destroying",
      );
    });
  });

  for (const status of ["destroying", "destroyed"] as const satisfies readonly EnvironmentStatus[]) {
    it(`rejects a send to a thread whose environment is ${status} without reprovisioning`, async () => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: `host-send-${status}`,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          managed: true,
          projectId: project.id,
          path: "/tmp/send-gone",
          status,
          workspaceProvisionType: "managed-worktree",
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          status: "idle",
        });

        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "auto",
              input: [{ type: "text", text: "Try to send into a gone env" }],
            }),
          },
        );

        expect(response.status).toBe(409);
        const body = await readJson(response);
        expect(body).toMatchObject({
          code: "thread_environment_unavailable",
          details: { reason: status, environmentStatus: status },
        });
        // The environment was not reprovisioned: its status is unchanged.
        expect(getEnvironment(harness.db, environment.id)?.status).toBe(status);
      });
    });
  }
});
