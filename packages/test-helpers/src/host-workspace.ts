import { makeWorkspaceStatus } from "./workspace-status.js";

/**
 * Minimal HostWorkspace stand-in for daemon/unit tests. Override only the
 * methods a test cares about; new HostWorkspace methods get a default here so
 * call sites do not each re-list the full surface.
 *
 * Structurally compatible with `@bb/host-workspace`'s `HostWorkspace` without
 * taking a package dependency (avoids a cycle with host-workspace's
 * devDependency on test-helpers).
 */
export function makeFakeHostWorkspace(
  overrides: Record<string, unknown> = {},
) {
  return {
    path: "/tmp/workspace",
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    getDefaultBranch: async () => "main",
    getCurrentBranch: async () => "main",
    getHeadSha: async () => "commit-1",
    getLocalStateFingerprint: async () => "local-1",
    getSharedGitRefsFingerprint: async () => "refs-1",
    getAdditionalWorkspaceWriteRoots: async () => [] as string[],
    getStatus: async () => makeWorkspaceStatus(),
    getDiff: async () => ({
      diff: "",
      truncated: false,
      shortstat: "",
      files: "",
      mergeBaseRef: null as string | null,
    }),
    diffFiles: async () => ({
      files: [] as never[],
      shortstat: "",
      mergeBaseRef: null as string | null,
      truncated: false,
    }),
    diffPatch: async () => [] as never[],
    getPullRequest: async () => ({ outcome: "none" as const }),
    runPullRequestAction: async () => undefined,
    createPullRequest: async () => ({
      provider: "github" as const,
      number: 1,
      url: "https://github.com/example/bb/pull/1",
    }),
    listBranches: async () => ["main"],
    listFiles: async () => [] as string[],
    commit: async () => ({
      commitSha: "commit-1",
      commitSubject: "commit",
    }),
    pushBranch: async (options: { branch: string; remote?: string }) => ({
      pushedBranch: options.branch,
      remote: options.remote ?? "origin",
      upstreamSet: true,
      alreadyUpToDate: false,
    }),
    reset: async () => undefined,
    fetch: async () => undefined,
    squashMerge: async () => ({
      merged: true,
      commitSha: "commit-1",
      commitSubject: "commit",
      targetBranch: "main",
    }),
    destroy: async () => undefined,
    ...overrides,
  };
}
