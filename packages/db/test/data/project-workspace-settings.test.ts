import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { deleteProject, createProject } from "../../src/data/projects.js";
import {
  getProjectWorkspaceSettings,
  upsertProjectWorkspaceSettings,
} from "../../src/data/project-workspace-settings.js";
import { upsertHost } from "../../src/data/hosts.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "workspace-settings-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "workspace-settings-project",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/workspace-settings-project",
    },
  });
  return { db, project };
}

describe("project workspace settings", () => {
  it("returns empty settings when none are stored", () => {
    const { db, project } = setup();

    expect(getProjectWorkspaceSettings(db, project.id)).toEqual({
      setupScript: null,
      runScript: null,
    });
  });

  it("stores setup and run scripts independently", () => {
    const { db, project } = setup();

    expect(
      upsertProjectWorkspaceSettings(db, noopNotifier, {
        projectId: project.id,
        setupScript: "corepack pnpm install",
        runScript: null,
      }),
    ).toEqual({
      setupScript: "corepack pnpm install",
      runScript: null,
    });

    expect(
      upsertProjectWorkspaceSettings(db, noopNotifier, {
        projectId: project.id,
        setupScript: null,
        runScript: "corepack pnpm dev",
      }),
    ).toEqual({
      setupScript: null,
      runScript: "corepack pnpm dev",
    });
  });

  it("keeps settings independent and deletes them with the project", () => {
    const { db, project } = setup();
    const host = upsertHost(db, noopNotifier, {
      name: "other-settings-host",
      type: "persistent",
    });
    const { project: otherProject } = createProject(db, noopNotifier, {
      name: "other-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/other-project",
      },
    });
    upsertProjectWorkspaceSettings(db, noopNotifier, {
      projectId: project.id,
      setupScript: "first setup",
      runScript: "first run",
    });
    upsertProjectWorkspaceSettings(db, noopNotifier, {
      projectId: otherProject.id,
      setupScript: "other setup",
      runScript: "other run",
    });

    deleteProject(db, noopNotifier, project.id);

    expect(getProjectWorkspaceSettings(db, project.id)).toEqual({
      setupScript: null,
      runScript: null,
    });
    expect(getProjectWorkspaceSettings(db, otherProject.id)).toEqual({
      setupScript: "other setup",
      runScript: "other run",
    });
  });
});
