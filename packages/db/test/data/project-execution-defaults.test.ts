import { describe, expect, it } from "vitest";
import { noopNotifier } from "../../src/notifier.js";
import { deleteProject, createProject } from "../../src/data/projects.js";
import {
  getProjectExecutionDefaults,
  listProjectExecutionDefaultsByProjectIds,
  upsertProjectExecutionDefaults,
} from "../../src/data/project-execution-defaults.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "defaults-host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "defaults-project",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/defaults-project",
    },
  });
  return { db, host, project };
}

describe("project-execution-defaults", () => {
  it("returns null when a project has no stored defaults for a provider", () => {
    const { db, project } = setup();

    expect(
      getProjectExecutionDefaults(db, {
        projectId: project.id,
      }),
    ).toBeNull();
  });

  it("upserts provider-scoped execution defaults", () => {
    const { db, project } = setup();

    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
    });

    expect(
      getProjectExecutionDefaults(db, {
        projectId: project.id,
      }),
    ).toEqual({
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
    });
  });

  it("replaces the previous defaults for the same project and provider", () => {
    const { db, project } = setup();

    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
    });
    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5-mini",
      reasoningLevel: "high",
      permissionMode: "accept-edits",
      serviceTier: "fast",
    });

    expect(
      getProjectExecutionDefaults(db, {
        projectId: project.id,
      }),
    ).toEqual({
      providerId: "codex",
      model: "gpt-5-mini",
      reasoningLevel: "high",
      permissionMode: "accept-edits",
      serviceTier: "fast",
    });
  });

  it("retains defaults for each provider and returns the last-used provider", () => {
    const { db, project } = setup();

    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
    });
    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "claude-code",
      model: "claude-opus-4-1",
      reasoningLevel: "high",
      permissionMode: "auto",
      serviceTier: "fast",
    });

    expect(getProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
    })).toMatchObject({
      providerId: "codex",
      model: "gpt-5",
    });
    expect(getProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "claude-code",
    })).toMatchObject({
      providerId: "claude-code",
      model: "claude-opus-4-1",
    });
    expect(getProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "unknown-provider",
    })).toBeNull();
    expect(getProjectExecutionDefaults(db, { projectId: project.id })).toEqual({
      providerId: "claude-code",
      model: "claude-opus-4-1",
      reasoningLevel: "high",
      permissionMode: "auto",
      serviceTier: "fast",
    });
    expect(listProjectExecutionDefaultsByProjectIds(db, {
      projectIds: [project.id],
    })).toEqual(new Map([
      [project.id, {
        providerId: "claude-code",
        model: "claude-opus-4-1",
        reasoningLevel: "high",
        permissionMode: "auto",
        serviceTier: "fast",
      }],
    ]));
  });

  it("keeps A as last used after an A-B-A sequence with equal requested timestamps", () => {
    const { db, project } = setup();

    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
      updatedAt: 100,
    });
    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "claude-code",
      model: "claude-opus-4-1",
      reasoningLevel: "high",
      permissionMode: "auto",
      serviceTier: "fast",
      updatedAt: 100,
    });
    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5-mini",
      reasoningLevel: "low",
      permissionMode: "accept-edits",
      serviceTier: "default",
      updatedAt: 100,
    });

    expect(getProjectExecutionDefaults(db, { projectId: project.id })).toEqual({
      providerId: "codex",
      model: "gpt-5-mini",
      reasoningLevel: "low",
      permissionMode: "accept-edits",
      serviceTier: "default",
    });
  });

  it("lists the latest provider defaults for each project", () => {
    const { db, host, project } = setup();
    const secondProject = createProject(db, noopNotifier, {
      name: "second-defaults-project",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/second-defaults-project",
      },
    }).project;

    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
      updatedAt: 100,
    });
    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "claude-code",
      model: "claude-opus-4-1",
      reasoningLevel: "high",
      permissionMode: "auto",
      serviceTier: "fast",
      updatedAt: 100,
    });
    upsertProjectExecutionDefaults(db, {
      projectId: secondProject.id,
      providerId: "pi",
      model: "pi-model",
      reasoningLevel: "low",
      permissionMode: "accept-edits",
      serviceTier: "default",
      updatedAt: 100,
    });

    expect(
      listProjectExecutionDefaultsByProjectIds(db, {
        projectIds: [project.id, secondProject.id],
      }),
    ).toEqual(
      new Map([
        [project.id, {
          providerId: "claude-code",
          model: "claude-opus-4-1",
          reasoningLevel: "high",
          permissionMode: "auto",
          serviceTier: "fast",
        }],
        [secondProject.id, {
          providerId: "pi",
          model: "pi-model",
          reasoningLevel: "low",
          permissionMode: "accept-edits",
          serviceTier: "default",
        }],
      ]),
    );
  });

  it("deletes defaults when the project is deleted", () => {
    const { db, project } = setup();

    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
    });

    expect(deleteProject(db, noopNotifier, project.id)).toBe(true);
    expect(
      getProjectExecutionDefaults(db, {
        projectId: project.id,
      }),
    ).toBeNull();
  });
});
