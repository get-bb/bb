import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  resolveRootComposeThreadEnvironment,
  type RootComposeSelectedBranch,
} from "./root-compose-thread-environment";

const projectId = "proj_123";
const hostWorktreeEnvironmentValue = "host:host_123:worktree";
const hostLocalEnvironmentValue = "host:host_123:local";

function selectedBranch(name: string): RootComposeSelectedBranch {
  return { name, isNew: false };
}

describe("resolveRootComposeThreadEnvironment", () => {
  it("omits unmanaged branch checkout when no branch is selected", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: null,
        defaultWorktreeBaseBranch: null,
        environmentValue: hostLocalEnvironmentValue,
        projectId,
        selectedBranch: null,
      }),
    ).toEqual({
      type: "host",
      hostId: "host_123",
      workspace: {
        type: "unmanaged",
        path: null,
      },
    });
  });

  it("sends explicit existing branch checkout for host local", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: null,
        defaultWorktreeBaseBranch: null,
        environmentValue: hostLocalEnvironmentValue,
        projectId,
        selectedBranch: selectedBranch("develop"),
      }),
    ).toMatchObject({
      workspace: {
        type: "unmanaged",
        branch: {
          kind: "existing",
          name: "develop",
        },
      },
    });
  });

  it("sends explicit new branch checkout for host local", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: null,
        defaultWorktreeBaseBranch: null,
        environmentValue: hostLocalEnvironmentValue,
        projectId,
        selectedBranch: { name: "develop", isNew: true },
      }),
    ).toMatchObject({
      workspace: {
        type: "unmanaged",
        branch: { kind: "new", baseBranch: "develop" },
      },
    });
  });

  it("submits the resolved local default displayed by the selector", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "main",
        environmentValue: hostWorktreeEnvironmentValue,
        projectId,
        selectedBranch: null,
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "main" },
      },
    });
  });

  it("submits the resolved remote default displayed by the selector", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "origin/main",
        environmentValue: hostWorktreeEnvironmentValue,
        projectId,
        selectedBranch: null,
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "origin/main" },
      },
    });
  });

  it("falls back to default while branch metadata is unavailable", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: undefined,
        defaultWorktreeBaseBranch: undefined,
        environmentValue: hostWorktreeEnvironmentValue,
        projectId,
        selectedBranch: null,
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });
  });

  it("sends a named base branch when the selected branch matches the env's current", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "origin/main",
        environmentValue: hostWorktreeEnvironmentValue,
        projectId,
        selectedBranch: selectedBranch("develop"),
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "develop" },
      },
    });
  });

  it("attaches a discovered worktree as an unmanaged path with no branch intent", () => {
    const canonicalPath = "/Users/dev/worktrees/spike branch:odd";
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: null,
        environmentValue: `path:${encodeURIComponent("host_123")}:${encodeURIComponent(canonicalPath)}`,
        projectId,
        // A branch pick from an earlier host-mode state must not leak into
        // the discovered-worktree attachment.
        selectedBranch: selectedBranch("develop"),
      }),
    ).toEqual({
      type: "host",
      hostId: "host_123",
      workspace: { type: "unmanaged", path: canonicalPath },
    });
  });

  it("uses personal workspaces for the personal project", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: null,
        defaultWorktreeBaseBranch: null,
        environmentValue: hostLocalEnvironmentValue,
        projectId: PERSONAL_PROJECT_ID,
        selectedBranch: selectedBranch("develop"),
      }),
    ).toEqual({
      type: "host",
      hostId: "host_123",
      workspace: { type: "personal" },
    });
  });
});
