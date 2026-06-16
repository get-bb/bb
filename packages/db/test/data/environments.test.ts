import { describe, expect, it, vi } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import type { DbNotifier } from "../../src/notifier.js";
import {
  createEnvironment,
  listRetiredLoadedEnvironmentIdsOnHost,
  recordProvisionedEnvironmentWorkspace,
  updateEnvironmentMetadata,
} from "../../src/data/environments.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, host, project };
}

function createNotifierSpy(): DbNotifier {
  return {
    notifyThread: vi.fn(),
    notifyProject: vi.fn(),
    notifyEnvironment: vi.fn(),
    notifyHost: vi.fn(),
    notifySystem: vi.fn(),
  };
}

describe("environments", () => {
  it("emits metadata-changed when merge base branch changes", () => {
    const { db, host, project } = setup();
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const notifier = createNotifierSpy();

    const updated = updateEnvironmentMetadata(db, notifier, environment.id, {
      mergeBaseBranch: "release",
    });

    expect(updated?.mergeBaseBranch).toBe("release");
    expect(notifier.notifyEnvironment).toHaveBeenCalledWith(environment.id, [
      "metadata-changed",
    ]);
  });

  it("emits metadata-changed when environment name changes", () => {
    const { db, host, project } = setup();
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      workspaceProvisionType: "managed-worktree",
      status: "ready",
    });
    const notifier = createNotifierSpy();

    const updated = updateEnvironmentMetadata(db, notifier, environment.id, {
      name: "Review workspace",
    });

    expect(updated?.name).toBe("Review workspace");
    expect(notifier.notifyEnvironment).toHaveBeenCalledWith(environment.id, [
      "metadata-changed",
    ]);
  });

  it("does not emit metadata-changed when merge base branch is unchanged", () => {
    const { db, host, project } = setup();
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      workspaceProvisionType: "unmanaged",
      mergeBaseBranch: "main",
      status: "ready",
    });
    const notifier = createNotifierSpy();

    const updated = updateEnvironmentMetadata(db, notifier, environment.id, {
      mergeBaseBranch: "main",
    });

    expect(updated?.mergeBaseBranch).toBe("main");
    expect(notifier.notifyEnvironment).not.toHaveBeenCalled();
  });

  it("does not emit metadata-changed when environment name is unchanged", () => {
    const { db, host, project } = setup();
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      workspaceProvisionType: "managed-worktree",
      name: "Review workspace",
      status: "ready",
    });
    const notifier = createNotifierSpy();

    const updated = updateEnvironmentMetadata(db, notifier, environment.id, {
      name: "Review workspace",
    });

    expect(updated?.name).toBe("Review workspace");
    expect(notifier.notifyEnvironment).not.toHaveBeenCalled();
  });

  it("records provisioned workspace metadata without touching status", () => {
    const { db, host, project } = setup();
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      workspaceProvisionType: "unmanaged",
      status: "provisioning",
    });
    const notifier = createNotifierSpy();

    const updated = recordProvisionedEnvironmentWorkspace(
      db,
      notifier,
      environment.id,
      {
        path: "/tmp/project",
        isGitRepo: true,
        isWorktree: false,
        branchName: "bb/test",
        defaultBranch: "main",
      },
    );

    expect(updated).toMatchObject({
      path: "/tmp/project",
      status: "provisioning",
      isGitRepo: true,
      branchName: "bb/test",
      defaultBranch: "main",
    });
    expect(notifier.notifyEnvironment).toHaveBeenCalledWith(environment.id, [
      "metadata-changed",
    ]);
  });

  it("lists loaded environments that no longer belong to the host as live records", () => {
    const { db, host, project } = setup();
    const otherHost = upsertHost(db, noopNotifier, {
      name: "other-host",
      type: "persistent",
    });
    const { project: otherProject } = createProject(db, noopNotifier, {
      name: "other-project",
      source: {
        type: "local_path",
        hostId: otherHost.id,
        path: "/tmp/other",
      },
    });
    const retainedEnvironment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const destroyedEnvironment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      workspaceProvisionType: "unmanaged",
      status: "destroyed",
    });
    const otherHostEnvironment = createEnvironment(db, noopNotifier, {
      projectId: otherProject.id,
      hostId: otherHost.id,
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });

    expect(
      listRetiredLoadedEnvironmentIdsOnHost(db, {
        hostId: host.id,
        environmentIds: [
          retainedEnvironment.id,
          destroyedEnvironment.id,
          otherHostEnvironment.id,
          "env_missing",
        ],
      }),
    ).toEqual([
      destroyedEnvironment.id,
      otherHostEnvironment.id,
      "env_missing",
    ]);
  });
});
