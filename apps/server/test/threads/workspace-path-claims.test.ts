import { createEnvironment } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  foreignProjectOwnedPathRefusal,
  suppliedWorkspacePathRefusal,
} from "../../src/services/threads/workspace-path-claims.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const HOST_DATA_DIR = "/home/agent/.bb";

describe("suppliedWorkspacePathRefusal", () => {
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
        environmentProviderId: "git-worktree",
        providerOwnsPath: true,
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Other",
        path: "/tmp/other",
      });

      expect(
        suppliedWorkspacePathRefusal(harness.deps.db, {
          dataDir: null,
          hostId: host.id,
          path: "/tmp/owned-worktree",
          projectId: project.id,
        }),
      ).toBe(
        "Workspace path is a bb-managed workspace owned by another project",
      );
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
        suppliedWorkspacePathRefusal(harness.deps.db, {
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
        environmentProviderId: "git-worktree",
        providerOwnsPath: true,
      });

      expect(
        suppliedWorkspacePathRefusal(harness.deps.db, {
          dataDir: HOST_DATA_DIR,
          hostId: host.id,
          path: ownPath,
          projectId: project.id,
        }),
      ).toBeNull();
    });
  });
  it("refuses a path inside a plugin's managed storage that this project has no environment for", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-claims-plugin-storage",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Owner",
      });

      expect(
        suppliedWorkspacePathRefusal(harness.deps.db, {
          dataDir: HOST_DATA_DIR,
          hostId: host.id,
          path: `${HOST_DATA_DIR}/plugins/environment-git-worktree/host-data/worktrees/thr_orphan-1/repo`,
          projectId: project.id,
        }),
      ).toBe(
        "Workspace path is inside bb-managed storage but is not a workspace of this project",
      );
    });
  });
});

describe("foreignProjectOwnedPathRefusal for provider-produced environments", () => {
  it("refuses another project attaching at or inside a provider's worktree", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-claims-provider",
      });
      const { project: owner } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Owner",
        path: "/tmp/owner-source",
      });
      createEnvironment(harness.db, harness.hub, {
        hostId: host.id,
        projectId: owner.id,
        path: "/plugins/environment-git-worktree/worktrees/thr_1/repo",
        status: "ready",
        providerOwnsPath: true,
        environmentProvider: {
          environmentProviderId: "git-worktree",
          instanceKey: null,
          selection: {
            machine: { type: "existing", hostId: host.id },
            inputs: null,
          },
        },
      });
      const { project: other } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Other",
        path: "/tmp/other-source",
      });

      for (const path of [
        "/plugins/environment-git-worktree/worktrees/thr_1/repo",
        "/plugins/environment-git-worktree/worktrees/thr_1/repo/packages/app",
      ]) {
        expect(
          foreignProjectOwnedPathRefusal(harness.deps.db, {
            hostId: host.id,
            path,
            projectId: other.id,
          }),
        ).toBe(
          "Workspace path is a bb-managed workspace owned by another project",
        );
      }
      expect(
        foreignProjectOwnedPathRefusal(harness.deps.db, {
          hostId: host.id,
          path: "/plugins/environment-git-worktree/worktrees/thr_1/repo",
          projectId: owner.id,
        }),
      ).toBeNull();
      expect(
        foreignProjectOwnedPathRefusal(harness.deps.db, {
          hostId: host.id,
          path: "/plugins/environment-git-worktree/worktrees/thr_10/repo",
          projectId: other.id,
        }),
      ).toBeNull();
    });
  });

  it("lets a second project attach to a checkout the first project only attached to", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-claims-shared-checkout",
      });
      const { project: first } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "First",
        path: "/tmp/shared-checkout",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: first.id,
        path: "/tmp/shared-checkout",
        environmentProviderId: "project-checkout",
        providerOwnsPath: false,
      });
      const { project: second } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Second",
        path: "/tmp/second-source",
      });

      expect(
        foreignProjectOwnedPathRefusal(harness.deps.db, {
          hostId: host.id,
          path: "/tmp/shared-checkout",
          projectId: second.id,
        }),
      ).toBeNull();
      expect(
        foreignProjectOwnedPathRefusal(harness.deps.db, {
          hostId: host.id,
          path: "/tmp/shared-checkout/packages/app",
          projectId: second.id,
        }),
      ).toBeNull();
    });
  });
});

describe("foreignProjectOwnedPathRefusal for freshly created workspaces", () => {
  it("accepts a path a provider just created inside its own plugin storage", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-claims-fresh",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Owner",
      });

      expect(
        foreignProjectOwnedPathRefusal(harness.deps.db, {
          hostId: host.id,
          path: `${HOST_DATA_DIR}/plugins/environment-git-worktree/host-data/worktrees/thr_new-1/repo`,
          projectId: project.id,
        }),
      ).toBeNull();
    });
  });
});
