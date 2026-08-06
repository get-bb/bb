import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  createProjectId,
  createProjectSourceId,
} from "../../src/ids.js";
import {
  createProject,
  ensurePersonalProject,
  getProject,
  listProjects,
  listPublicProjects,
  markProjectDeleted,
  reorderProject,
  setProjectGitRemoteUrlIfMissing,
} from "../../src/data/projects.js";
import { listProjectSources } from "../../src/data/project-sources.js";
import { upsertHost } from "../../src/data/hosts.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "projects-host",
    type: "persistent",
  });
  return { db, host };
}

describe("projects", () => {
  it("sets a git remote anchor only while it is missing", () => {
    const { db, host } = setup();
    const { project } = createProject(db, noopNotifier, {
      name: "anchored-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/anchored-project",
      },
    });

    expect(project.gitRemoteUrl).toBeNull();
    expect(
      setProjectGitRemoteUrlIfMissing(
        db,
        noopNotifier,
        project.id,
        "ssh://git.example.test/first.git",
      )?.gitRemoteUrl,
    ).toBe("ssh://git.example.test/first.git");
    expect(
      setProjectGitRemoteUrlIfMissing(
        db,
        noopNotifier,
        project.id,
        "ssh://git.example.test/second.git",
      ),
    ).toBeNull();
    expect(getProject(db, project.id)?.gitRemoteUrl).toBe(
      "ssh://git.example.test/first.git",
    );
  });

  it("ensures the singleton personal project idempotently", () => {
    const { db } = setup();

    const first = ensurePersonalProject(db);
    const second = ensurePersonalProject(db);

    expect(first.id).toBe(PERSONAL_PROJECT_ID);
    expect(second.id).toBe(PERSONAL_PROJECT_ID);
    expect(
      listProjects(db).filter((project) => project.kind === "personal"),
    ).toEqual([expect.objectContaining({ id: PERSONAL_PROJECT_ID })]);
  });

  it("excludes deleted projects from public listings", () => {
    const { db, host } = setup();
    const { project: visibleProject } = createProject(db, noopNotifier, {
      name: "visible-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/visible-project",
      },
    });
    const { project: deletingProject } = createProject(db, noopNotifier, {
      name: "deleting-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/deleting-project",
      },
    });

    markProjectDeleted(db, noopNotifier, {
      projectId: deletingProject.id,
    });

    const allProjectIds = listProjects(db).map((project) => project.id);
    expect(allProjectIds).toHaveLength(3);
    expect(allProjectIds).toEqual(
      expect.arrayContaining([
        PERSONAL_PROJECT_ID,
        visibleProject.id,
        deletingProject.id,
      ]),
    );
    expect(listPublicProjects(db).map((project) => project.id)).toEqual([
      visibleProject.id,
    ]);
  });

  it("reorders public projects by neighboring projects", () => {
    const { db, host } = setup();
    const { project: firstProject } = createProject(db, noopNotifier, {
      name: "first-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/first-project",
      },
    });
    const { project: secondProject } = createProject(db, noopNotifier, {
      name: "second-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/second-project",
      },
    });
    const { project: thirdProject } = createProject(db, noopNotifier, {
      name: "third-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/third-project",
      },
    });

    const result = reorderProject({
      db,
      notifier: noopNotifier,
      projectId: thirdProject.id,
      previousProjectId: firstProject.id,
      nextProjectId: secondProject.id,
    });

    expect(result.kind).toBe("reordered");
    expect(listPublicProjects(db).map((project) => project.id)).toEqual([
      firstProject.id,
      thirdProject.id,
      secondProject.id,
    ]);
  });

  it("returns unchanged when project order already matches neighboring projects", () => {
    const { db, host } = setup();
    const { project: firstProject } = createProject(db, noopNotifier, {
      name: "first-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/first-project",
      },
    });
    const { project: secondProject } = createProject(db, noopNotifier, {
      name: "second-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/second-project",
      },
    });
    const { project: thirdProject } = createProject(db, noopNotifier, {
      name: "third-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/third-project",
      },
    });

    const result = reorderProject({
      db,
      notifier: noopNotifier,
      projectId: secondProject.id,
      previousProjectId: firstProject.id,
      nextProjectId: thirdProject.id,
    });

    expect(result.kind).toBe("unchanged");
    if (result.kind !== "unchanged") {
      throw new Error(`Expected unchanged reorder, received ${result.kind}`);
    }
    expect(result.projects.map((project) => project.id)).toEqual([
      firstProject.id,
      secondProject.id,
      thirdProject.id,
    ]);
  });

  it("returns not_found when reordering a missing project", () => {
    const { db } = setup();

    expect(
      reorderProject({
        db,
        notifier: noopNotifier,
        projectId: "proj_missing",
        previousProjectId: null,
        nextProjectId: null,
      }).kind,
    ).toBe("not_found");
  });

  it("rejects project reorder neighbors that are in reverse order", () => {
    const { db, host } = setup();
    const { project: firstProject } = createProject(db, noopNotifier, {
      name: "first-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/first-project",
      },
    });
    const { project: secondProject } = createProject(db, noopNotifier, {
      name: "second-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/second-project",
      },
    });
    const { project: thirdProject } = createProject(db, noopNotifier, {
      name: "third-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/third-project",
      },
    });

    expect(
      reorderProject({
        db,
        notifier: noopNotifier,
        projectId: thirdProject.id,
        previousProjectId: secondProject.id,
        nextProjectId: firstProject.id,
      }).kind,
    ).toBe("invalid_neighbor_order");
    expect(listPublicProjects(db).map((project) => project.id)).toEqual([
      firstProject.id,
      secondProject.id,
      thirdProject.id,
    ]);
  });

  it("appends new projects after existing project order", () => {
    const { db, host } = setup();
    const { project: firstProject } = createProject(db, noopNotifier, {
      name: "first-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/first-project",
      },
    });
    const { project: secondProject } = createProject(db, noopNotifier, {
      name: "second-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/second-project",
      },
    });

    reorderProject({
      db,
      notifier: noopNotifier,
      projectId: secondProject.id,
      previousProjectId: null,
      nextProjectId: firstProject.id,
    });

    const { project: thirdProject } = createProject(db, noopNotifier, {
      name: "third-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/third-project",
      },
    });

    expect(listPublicProjects(db).map((project) => project.id)).toEqual([
      secondProject.id,
      firstProject.id,
      thirdProject.id,
    ]);
  });

  it("rejects stale project reorder neighbors", () => {
    const { db, host } = setup();
    const { project: visibleProject } = createProject(db, noopNotifier, {
      name: "visible-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/visible-project",
      },
    });
    const { project: deletingProject } = createProject(db, noopNotifier, {
      name: "deleting-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/deleting-project",
      },
    });
    markProjectDeleted(db, noopNotifier, {
      projectId: deletingProject.id,
    });

    expect(
      reorderProject({
        db,
        notifier: noopNotifier,
        projectId: visibleProject.id,
        previousProjectId: deletingProject.id,
        nextProjectId: null,
      }).kind,
    ).toBe("stale_neighbor");
  });

  it("uses exact preallocated project and source identities", () => {
    const { db, host } = setup();
    const projectId = createProjectId();
    const projectSourceId = createProjectSourceId();

    const { project, source } = createProject(db, noopNotifier, {
      name: "preallocated-project",
      projectId,
      projectSourceId,
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/preallocated-project",
      },
    });

    expect(project.id).toBe(projectId);
    expect(source.id).toBe(projectSourceId);
    expect(getProject(db, projectId)?.id).toBe(projectId);
    expect(listProjectSources(db, projectId).map((row) => row.id)).toEqual([
      projectSourceId,
    ]);
  });

  it("rejects duplicate preallocated project identities atomically", () => {
    const { db, host } = setup();
    const projectId = createProjectId();
    const projectSourceId = createProjectSourceId();
    createProject(db, noopNotifier, {
      name: "original-project",
      projectId,
      projectSourceId,
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/original-project",
      },
    });
    const beforeProjectCount = listProjects(db).length;
    const beforeSourceCount = listProjectSources(db, projectId).length;

    expect(() =>
      createProject(db, noopNotifier, {
        name: "duplicate-project",
        projectId,
        projectSourceId: createProjectSourceId(),
        source: {
          type: "local_path",
          hostId: host.id,
          path: "/tmp/duplicate-project",
        },
      }),
    ).toThrow();
    expect(() =>
      createProject(db, noopNotifier, {
        name: "duplicate-source-project",
        projectId: createProjectId(),
        projectSourceId,
        source: {
          type: "local_path",
          hostId: host.id,
          path: "/tmp/duplicate-source-project",
        },
      }),
    ).toThrow();

    expect(listProjects(db)).toHaveLength(beforeProjectCount);
    expect(listProjectSources(db, projectId)).toHaveLength(beforeSourceCount);
    expect(getProject(db, projectId)?.name).toBe("original-project");
  });
});
