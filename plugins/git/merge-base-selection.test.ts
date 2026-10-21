import type { Environment } from "@bb/domain";
import type { WorkspaceStatus } from "bb-git-contract";
import { makeWorkspaceStatus as makeSharedWorkspaceStatus } from "@bb/test-helpers";
import { makeEnvironment } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  resolveEffectiveMergeBaseBranch,
  resolvePersistedMergeBaseBranch,
} from "./merge-base-selection.js";

type EnvironmentOverrides = Partial<Environment>;

function makeMergeBaseEnvironment(
  overrides: EnvironmentOverrides = {},
): Environment {
  return makeEnvironment({
    baseBranch: null,
    branchName: "bb/thread",
    createdAt: 1,
    hostId: "host-1",
    id: "env-1",
    path: "/tmp/workspace",
    projectId: "project-1",
    updatedAt: 1,
    ...overrides,
  });
}

function makeWorkspaceStatus(
  overrides: Partial<WorkspaceStatus> = {},
): WorkspaceStatus {
  return makeSharedWorkspaceStatus({
    branch: { currentBranch: "bb/thread", defaultBranch: "main" },
    checkout: { kind: "branch", branchName: "bb/thread", headSha: null },
    ...overrides,
  });
}

describe("resolveEffectiveMergeBaseBranch", () => {
  it("prefers the selected branch", () => {
    expect(
      resolveEffectiveMergeBaseBranch({
        environment: makeMergeBaseEnvironment({
          baseBranch: "release",
          mergeBaseBranch: "develop",
        }),
        selectedMergeBaseBranch: "main",
        workspaceStatus: makeWorkspaceStatus(),
      }),
    ).toBe("main");
  });

  it("uses the persisted merge-base override before the provisioned worktree base", () => {
    expect(
      resolveEffectiveMergeBaseBranch({
        environment: makeMergeBaseEnvironment({
          baseBranch: "release",
          mergeBaseBranch: "develop",
        }),
        workspaceStatus: makeWorkspaceStatus(),
      }),
    ).toBe("develop");
  });

  it("uses a managed worktree's base branch before the repository default", () => {
    expect(
      resolveEffectiveMergeBaseBranch({
        environment: makeMergeBaseEnvironment({ baseBranch: "release" }),
        workspaceStatus: makeWorkspaceStatus({
          branch: {
            currentBranch: "bb/thread",
            defaultBranch: "main",
          },
        }),
      }),
    ).toBe("release");
  });

  it("falls back to the live workspace default branch", () => {
    expect(
      resolveEffectiveMergeBaseBranch({
        environment: makeMergeBaseEnvironment({ defaultBranch: "master" }),
        workspaceStatus: makeWorkspaceStatus({
          branch: {
            currentBranch: "bb/thread",
            defaultBranch: "main",
          },
        }),
      }),
    ).toBe("main");
  });
});

describe("resolvePersistedMergeBaseBranch", () => {
  it("clears the persisted override when selecting the provisioned worktree base", () => {
    expect(
      resolvePersistedMergeBaseBranch({
        branch: "release",
        environment: makeMergeBaseEnvironment({ baseBranch: "release" }),
        workspaceStatus: makeWorkspaceStatus(),
      }),
    ).toBeNull();
  });

  it("persists the repository default branch when the worktree was based on another branch", () => {
    expect(
      resolvePersistedMergeBaseBranch({
        branch: "main",
        environment: makeMergeBaseEnvironment({ baseBranch: "release" }),
        workspaceStatus: makeWorkspaceStatus(),
      }),
    ).toBe("main");
  });

  it("clears the persisted override when selecting the repository default for a default-based worktree", () => {
    expect(
      resolvePersistedMergeBaseBranch({
        branch: "main",
        environment: makeMergeBaseEnvironment(),
        workspaceStatus: makeWorkspaceStatus(),
      }),
    ).toBeNull();
  });
});
