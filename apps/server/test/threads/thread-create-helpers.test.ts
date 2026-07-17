import { describe, expect, it } from "vitest";
import {
  createConnection,
  createEnvironment,
  createProject,
  createThreadSection,
  deleteThreadSection,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { ApiError } from "../../src/errors.js";
import {
  baseBranchSpecToStoredName,
  buildManagedBranchName,
  createThreadRecord,
} from "../../src/services/threads/thread-create-helpers.js";
import { sanitizeGeneratedBranchSlug } from "../../src/services/threads/title-generation.js";

describe("sanitizeGeneratedBranchSlug", () => {
  it("normalizes spaces, punctuation, and repeated separators", () => {
    expect(sanitizeGeneratedBranchSlug("  Fix: login -- flow!!  ")).toBe(
      "fix-login-flow",
    );
  });

  it("rejects empty slugs", () => {
    expect(sanitizeGeneratedBranchSlug("!!!")).toBeNull();
  });

  it("caps slugs before branch construction", () => {
    expect(sanitizeGeneratedBranchSlug("a".repeat(80))).toHaveLength(48);
  });
});

describe("buildManagedBranchName", () => {
  it("falls back to the full thread ID", () => {
    expect(buildManagedBranchName({ threadId: "thr_abc123def456" })).toBe(
      "bb/thr_abc123def456",
    );
  });

  it("includes a sanitized slug before the full thread ID", () => {
    expect(
      buildManagedBranchName({
        branchSlug: "Fix login flow!",
        threadId: "thr_abc123def456",
      }),
    ).toBe("bb/fix-login-flow-thr_abc123def456");
  });

  it("falls back to the full thread ID when the slug is empty after sanitizing", () => {
    expect(
      buildManagedBranchName({
        branchSlug: "!!!",
        threadId: "thr_abc123def456",
      }),
    ).toBe("bb/thr_abc123def456");
  });

  it("produces unique names for threads with the same slug", () => {
    const a = buildManagedBranchName({
      branchSlug: "same task",
      threadId: "thr_abc123def456",
    });
    const b = buildManagedBranchName({
      branchSlug: "same task",
      threadId: "thr_abc123xyz789",
    });
    expect(a).not.toBe(b);
  });
});

describe("baseBranchSpecToStoredName", () => {
  it("stores named base branches as their branch name", () => {
    expect(
      baseBranchSpecToStoredName({ kind: "named", name: "release/1.2" }),
    ).toBe("release/1.2");
  });

  it("stores default base branches as null", () => {
    expect(baseBranchSpecToStoredName({ kind: "default" })).toBeNull();
  });
});

describe("createThreadRecord", () => {
  it("returns section_not_found when the section is stale by create time", () => {
    const db = createConnection(":memory:");
    try {
      migrate(db);
      const deps = { db, hub: noopNotifier };
      const host = upsertHost(db, noopNotifier, {
        name: "Test Host",
        type: "persistent",
      });
      const { project } = createProject(db, noopNotifier, {
        name: "Test Project",
        source: {
          hostId: host.id,
          path: "/tmp/stale-section-create-project",
          type: "local_path",
        },
      });
      const environment = createEnvironment(db, noopNotifier, {
        hostId: host.id,
        path: "/tmp/stale-section-create-project",
        projectId: project.id,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      const sectionResult = createThreadSection(db, noopNotifier, {
        name: "Race",
      });
      if (sectionResult.status !== "created") {
        throw new Error("Expected section fixture to be created");
      }
      deleteThreadSection(db, noopNotifier, {
        id: sectionResult.section.id,
      });

      try {
        createThreadRecord(deps, {
          environmentId: environment.id,
          request: {
            environment: {
              environmentId: environment.id,
              type: "reuse",
            },
            sectionId: sectionResult.section.id,
            input: [],
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            startedOnBehalfOf: null,
            titleFallback: null,
          },
        });
        throw new Error("Expected createThreadRecord to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(404);
        expect((error as ApiError).body).toMatchObject({
          code: "section_not_found",
          message: "Section not found",
        });
      }
    } finally {
      db.$client.close();
    }
  });
});
