import type { Environment, Thread } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildForkThreadRequest,
  isThreadForkable,
} from "./fork-thread-request";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  const base: Thread = {
    id: "thr_source",
    projectId: "proj_test",
    environmentId: "env_source",
    providerId: "codex",
    title: "Investigate flaky test",
    titleFallback: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...base, ...overrides };
}

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  const base: Environment = {
    id: "env_source",
    name: null,
    projectId: "proj_test",
    hostId: "hst_local",
    path: "/Users/dev/Projects/bb",
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    branchName: "feature/source-branch",
    baseBranch: "main",
    defaultBranch: "main",
    mergeBaseBranch: null,
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...base, ...overrides };
}

describe("buildForkThreadRequest", () => {
  it("branches a managed worktree from the source's current branch by name", () => {
    const request = buildForkThreadRequest({
      sourceThread: makeThread(),
      sourceEnvironment: makeEnvironment({
        branchName: "feature/source-branch",
      }),
      model: "gpt-5",
      permissionMode: "readonly",
    });

    expect(request).not.toBeNull();
    expect(request?.environment).toEqual({
      type: "host",
      hostId: "hst_local",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "feature/source-branch" },
      },
    });
  });

  it("uses a personal workspace (not a managed worktree) for a personal-workspace source", () => {
    // A personal-project thread has a host but its workspace is personal; the
    // server rejects a managed worktree there ("Personal project threads must
    // use a personal workspace"), so the fork must stay on a personal workspace.
    const request = buildForkThreadRequest({
      sourceThread: makeThread({ projectId: "proj_personal" }),
      sourceEnvironment: makeEnvironment({
        projectId: "proj_personal",
        workspaceProvisionType: "personal",
      }),
      model: "gpt-5",
      permissionMode: "readonly",
    });

    expect(request).not.toBeNull();
    expect(request?.environment).toEqual({
      type: "host",
      hostId: "hst_local",
      workspace: { type: "personal" },
    });
  });

  it("carries lineage, provider and execution options with empty input (native fork)", () => {
    const request = buildForkThreadRequest({
      sourceThread: makeThread({ id: "thr_source", providerId: "codex" }),
      sourceEnvironment: makeEnvironment(),
      model: "gpt-5",
      permissionMode: "workspace-write",
    });

    expect(request).toMatchObject({
      projectId: "proj_test",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "workspace-write",
      sourceThreadId: "thr_source",
      originKind: "fork",
      startedOnBehalfOf: null,
    });
    // Empty input: a native fork establishes the cloned session idle (no first
    // turn) and the user steers the first turn. No anchor seed, no snapshot.
    expect(request?.input).toEqual([]);
  });

  it('omits the title so the fork auto-titles from its first turn (no "(fork)" suffix)', () => {
    const request = buildForkThreadRequest({
      sourceThread: makeThread({ title: "Investigate flaky test" }),
      sourceEnvironment: makeEnvironment(),
      model: "gpt-5",
      permissionMode: "readonly",
    });

    expect(request?.title).toBeUndefined();
  });

  it("falls back to the source's default branch when no current branch is known", () => {
    const request = buildForkThreadRequest({
      sourceThread: makeThread(),
      sourceEnvironment: makeEnvironment({ branchName: null }),
      model: "gpt-5",
      permissionMode: "readonly",
    });

    expect(request?.environment).toMatchObject({
      type: "host",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });
  });

  it("returns null when the source has no host to base a worktree fork on", () => {
    const request = buildForkThreadRequest({
      sourceThread: makeThread({ environmentId: null }),
      sourceEnvironment: null,
      model: "gpt-5",
      permissionMode: "readonly",
    });

    expect(request).toBeNull();
  });
});

describe("isThreadForkable", () => {
  it("is true when the source has a resolved environment and a fork-capable provider", () => {
    expect(isThreadForkable(makeEnvironment(), "codex")).toBe(true);
  });

  it("is false for a host-less (null-environment) personal source", () => {
    // The Fork button/handler is dropped in this case so it never renders as a
    // dead no-op on a personal/no-host source.
    expect(isThreadForkable(null, "codex")).toBe(false);
  });

  it("is false when the provider does not support forking", () => {
    // ACP/Cursor declares supportsFork: false (no session-fork primitive), so
    // the Fork button is dropped even on a fully-hosted source.
    expect(isThreadForkable(makeEnvironment(), "acp-cursor")).toBe(false);
  });

  it("is false for an unknown provider id", () => {
    expect(isThreadForkable(makeEnvironment(), "not-a-provider")).toBe(false);
  });

  it("agrees with buildForkThreadRequest's null gates", () => {
    // Host-less source.
    expect(isThreadForkable(null, "codex")).toBe(false);
    expect(
      buildForkThreadRequest({
        sourceThread: makeThread({ environmentId: null }),
        sourceEnvironment: null,
        model: "gpt-5",
        permissionMode: "readonly",
      }),
    ).toBeNull();
    // Fork-incapable provider on a hosted source.
    expect(isThreadForkable(makeEnvironment(), "acp-cursor")).toBe(false);
    expect(
      buildForkThreadRequest({
        sourceThread: makeThread({ providerId: "acp-cursor" }),
        sourceEnvironment: makeEnvironment(),
        model: "gpt-5",
        permissionMode: "readonly",
      }),
    ).toBeNull();
  });
});
