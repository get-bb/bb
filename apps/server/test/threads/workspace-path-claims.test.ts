import { describe, expect, it } from "vitest";
import { unmanagedAttachRefusal } from "../../src/services/threads/workspace-path-claims.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const HOST_DATA_DIR = "/home/agent/.bb";

describe("unmanagedAttachRefusal", () => {
  it("still refuses a foreign managed workspace when the host data dir is unknown", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-claims" });
      const { project: owner } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Owner",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: owner.id,
        path: "/tmp/owned-worktree",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Other",
        path: "/tmp/other",
      });

      // A disconnected host leaves dataDir null. The row-based checks must
      // still run; only the workspace-root check degrades.
      expect(
        unmanagedAttachRefusal(harness.deps.db, {
          checksOutBranch: false,
          dataDir: null,
          hostId: host.id,
          path: "/tmp/owned-worktree",
          projectId: project.id,
        }),
      ).toMatchObject({ reason: "foreign-managed" });
    });
  });

  it("allows an ordinary directory when the host data dir is unknown", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-claims-ok" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/plain",
      });

      expect(
        unmanagedAttachRefusal(harness.deps.db, {
          checksOutBranch: false,
          dataDir: null,
          hostId: host.id,
          path: `${HOST_DATA_DIR}/worktrees/env_other/repo`,
          projectId: project.id,
        }),
      ).toBeNull();
    });
  });

  it("lets a project attach to a managed path it already owns", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-claims-own" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Owner",
      });
      const ownPath = `${HOST_DATA_DIR}/worktrees/env_own/repo`;
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: ownPath,
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });

      expect(
        unmanagedAttachRefusal(harness.deps.db, {
          checksOutBranch: false,
          dataDir: HOST_DATA_DIR,
          hostId: host.id,
          path: ownPath,
          projectId: project.id,
        }),
      ).toBeNull();
    });
  });

  it("ignores live threads unless the request checks out a branch", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-claims-busy",
      });
      const sharedPath = "/tmp/busy-shared";
      const { project: busy } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Busy",
        path: sharedPath,
      });
      const busyEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: busy.id,
        path: sharedPath,
      });
      seedThread(harness.deps, {
        projectId: busy.id,
        environmentId: busyEnvironment.id,
        status: "active",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Joiner",
        path: sharedPath,
      });

      const args = {
        dataDir: HOST_DATA_DIR,
        hostId: host.id,
        path: sharedPath,
        projectId: project.id,
      };
      // Sharing a directory is allowed; only rewriting the tree is not.
      expect(
        unmanagedAttachRefusal(harness.deps.db, {
          ...args,
          checksOutBranch: false,
        }),
      ).toBeNull();
      expect(
        unmanagedAttachRefusal(harness.deps.db, {
          ...args,
          checksOutBranch: true,
        }),
      ).toMatchObject({ reason: "live-thread" });
    });
  });
});
