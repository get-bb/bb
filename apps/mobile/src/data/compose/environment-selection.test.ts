import { PERSONAL_PROJECT_ID, type ProjectSource } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { threadListEntry } from "../test/fixtures";
import {
  buildReuseEnvironmentOptions,
  resolveEffectiveEnvironmentSelection,
  resolveExecutionOptionsRouting,
  resolveWorktreeDisabledReason,
  type ReuseEnvironmentOption,
} from "./environment-selection";

const source = (hostId: string): ProjectSource => ({
  id: `src_${hostId}`,
  projectId: "proj_1",
  type: "local_path",
  hostId,
  path: "/repo",
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
});

describe("buildReuseEnvironmentOptions", () => {
  it("groups worktree threads per environment, previews most-recent threads first, sorts by label, and names the host only when a map is given", () => {
    const threads = [
      threadListEntry({
        id: "a1",
        environmentId: "env_a",
        environmentWorkspaceDisplayKind: "managed-worktree",
        environmentBranchName: "feat/zebra",
        environmentName: null,
        environmentHostId: "host_1",
        latestAttentionAt: 1,
        title: "older",
      }),
      threadListEntry({
        id: "a2",
        environmentId: "env_a",
        environmentWorkspaceDisplayKind: "managed-worktree",
        environmentBranchName: "feat/zebra",
        environmentHostId: "host_1",
        latestAttentionAt: 9,
        title: "newer",
      }),
      threadListEntry({
        id: "b1",
        environmentId: "env_b",
        environmentWorkspaceDisplayKind: "unmanaged-worktree",
        environmentName: "apple",
        environmentBranchName: "main",
        environmentHostId: "host_2",
      }),
      // Not a worktree: the project checkout itself.
      threadListEntry({
        id: "c1",
        environmentId: "env_c",
        environmentWorkspaceDisplayKind: "other",
      }),
      threadListEntry({ id: "d1", environmentId: null }),
    ];
    const options = buildReuseEnvironmentOptions(threads);
    expect(options.map((option) => option.environmentId)).toEqual([
      "env_b",
      "env_a",
    ]);
    expect(options[1].threads.map((thread) => thread.title)).toEqual([
      "newer",
      "older",
    ]);
    expect(options[1].hostName).toBeNull();
    const withHosts = buildReuseEnvironmentOptions(
      threads,
      new Map([["host_1", "Desk"]]),
    );
    expect(withHosts.map((option) => option.hostName)).toEqual([null, "Desk"]);
  });
});

describe("resolveEffectiveEnvironmentSelection", () => {
  const reuseOptions: ReuseEnvironmentOption[] = [
    {
      environmentId: "env_1",
      branchName: "b",
      name: null,
      hostName: null,
      threads: [],
    },
  ];
  const base = {
    projectId: "proj_1",
    knownHostIds: new Set(["host_1", "host_2"]),
    projectSources: [source("host_1")],
    reuseOptions,
    reuseOptionsLoading: false,
  };

  it("keeps a host selection only for a known host with a source; personal projects accept any known host", () => {
    const worktree = {
      type: "host",
      hostId: "host_1",
      workspace: { type: "managed-worktree", baseBranch: null },
    } as const;
    expect(
      resolveEffectiveEnvironmentSelection({ ...base, selection: worktree }),
    ).toEqual(worktree);
    expect(
      resolveEffectiveEnvironmentSelection({
        ...base,
        selection: { ...worktree, hostId: "host_2" },
      }),
    ).toEqual({ type: "project-default" });
    expect(
      resolveEffectiveEnvironmentSelection({
        ...base,
        selection: { ...worktree, hostId: "ghost" },
      }),
    ).toEqual({ type: "project-default" });
    expect(
      resolveEffectiveEnvironmentSelection({
        ...base,
        projectId: PERSONAL_PROJECT_ID,
        selection: { ...worktree, hostId: "host_2" },
      }),
    ).toEqual({
      type: "host",
      hostId: "host_2",
      workspace: { type: "personal" },
    });
  });

  it("keeps reuse while the worktree exists or is still loading, and falls back otherwise", () => {
    expect(
      resolveEffectiveEnvironmentSelection({
        ...base,
        selection: { type: "reuse", environmentId: "env_1" },
      }),
    ).toEqual({ type: "reuse", environmentId: "env_1" });
    expect(
      resolveEffectiveEnvironmentSelection({
        ...base,
        selection: { type: "reuse", environmentId: "gone" },
      }),
    ).toEqual({ type: "project-default" });
    expect(
      resolveEffectiveEnvironmentSelection({
        ...base,
        reuseOptionsLoading: true,
        selection: { type: "reuse", environmentId: "gone" },
      }),
    ).toEqual({ type: "reuse", environmentId: null });
    expect(
      resolveEffectiveEnvironmentSelection({
        ...base,
        reuseOptions: [],
        selection: { type: "reuse", environmentId: null },
      }),
    ).toEqual({ type: "project-default" });
    expect(
      resolveEffectiveEnvironmentSelection({
        ...base,
        projectId: PERSONAL_PROJECT_ID,
        selection: { type: "reuse", environmentId: "env_1" },
      }),
    ).toEqual({ type: "project-default" });
  });
});

describe("routing and worktree availability", () => {
  it("routes provider discovery through the selected host or reused environment", () => {
    expect(resolveExecutionOptionsRouting({ type: "project-default" })).toEqual(
      {},
    );
    expect(
      resolveExecutionOptionsRouting({ type: "reuse", environmentId: "env_1" }),
    ).toEqual({ environmentId: "env_1" });
    expect(
      resolveExecutionOptionsRouting({ type: "reuse", environmentId: null }),
    ).toEqual({});
    expect(
      resolveExecutionOptionsRouting({
        type: "host",
        hostId: "h",
        workspace: { type: "personal" },
      }),
    ).toEqual({ hostId: "h" });
  });

  it("explains why a checkout cannot host new worktrees", () => {
    expect(resolveWorktreeDisabledReason(undefined)).toBeNull();
    expect(
      resolveWorktreeDisabledReason({
        checkout: { kind: "unborn", branchName: null },
      }),
    ).toMatch(/no commits/);
    expect(
      resolveWorktreeDisabledReason({
        checkout: { kind: "unknown", reason: "not a repo" },
      }),
    ).toMatch(/Git repository/);
    expect(
      resolveWorktreeDisabledReason({
        checkout: { kind: "branch", branchName: "main", headSha: "abc" },
      }),
    ).toBeNull();
  });
});
