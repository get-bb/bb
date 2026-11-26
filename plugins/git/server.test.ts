import { experimental_BbHttpError, type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  type ExperimentalFakeHostRpcCall,
} from "@get-bb/plugin-sdk/testing";
import { makeWorkspaceStatus } from "./testing.js";
import { describe, expect, it, vi } from "vitest";
import {
  gitFilesTag,
  gitPatchKey,
  gitStatusTag,
  gitViewedTag,
} from "./contract.js";
import plugin from "./server.js";
import { VIEWED_MARKS_FROM_CORE_KEY } from "./server/viewed.js";

type Environment = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["get"]>
>;

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "env-1",
    name: null,
    projectId: "project-1",
    hostId: "host-1",
    path: "/work/env-1",
    isGitRepo: true,
    isWorktree: true,
    branchName: "feature",
    baseBranch: null,
    defaultBranch: "main",
    mergeBaseBranch: null,
    status: "ready",
    environmentProviderId: "git-worktree",
    lifecycle: { phase: "active", retireAt: null, teardown: null },
    hostLifecycle: "active",
    environmentProviderSelection: null,
    environmentProviderInstanceKey: null,
    managed: true,
    heldBy: null,
    statusMessage: null,
    workspaceProvisionType: "worktree",
    ...overrides,
  } as Environment;
}

function hostResult(call: ExperimentalFakeHostRpcCall): unknown {
  switch (call.method) {
    case "status":
      return { outcome: "available", value: makeWorkspaceStatus() };
    case "files":
      return {
        outcome: "available",
        fingerprint: "files-fingerprint",
        value: {
          files: [],
          truncated: true,
          shortstat: "",
          mergeBaseRef: null,
          initialPatches: [],
          reusedPatchPaths: [],
        },
      };
    case "patches": {
      const input = call.input as { paths: string[] };
      return {
        outcome: "available",
        value: {
          patches: input.paths.map((path) => ({
            path,
            patch: `patch ${path}`,
            truncated: false,
          })),
          deferred: [],
        },
      };
    }
    default:
      throw new Error(`unexpected host call ${call.method}`);
  }
}

function reposOf(environment: { isGitRepo: boolean; path: string | null }) {
  return {
    repos:
      environment.isGitRepo && environment.path !== null
        ? [
            {
              rootPath: environment.path,
              path: environment.path,
              label: "",
              source: "main" as const,
            },
          ]
        : [],
    truncated: false,
  };
}

async function setup(environments: Record<string, Environment>) {
  const updates: unknown[] = [];
  const fake = createFakePluginHost({
    pluginId: "bb--git",
    sdk: {
      subscribe: () => () => {},
      files: {
        read: async () => {
          throw new experimental_BbHttpError({
            status: 413,
            code: "file_too_large",
            message: "too large",
            body: {
              code: "file_too_large",
              message: "File size 30000000 bytes exceeds the 25 MB limit",
            },
          });
        },
      },
      environments: {
        get: async ({ environmentId }: { environmentId: string }) => {
          const found = environments[environmentId];
          if (found === undefined) {
            throw new experimental_BbHttpError({
              status: 404,
              code: null,
              message: "Environment not found",
              body: null,
            });
          }
          return found;
        },
        experimental_repos: async ({
          environmentId,
        }: {
          environmentId: string;
        }) => {
          const found = environments[environmentId];
          if (found === undefined) throw new Error("unknown environment");
          return reposOf(found);
        },
        update: async (args: unknown) => {
          updates.push(args);
          return environments["env-1"];
        },
      },
    },
    experimental_callHostRpc: hostResult,
  });
  plugin(fake.bb);
  return { fake, updates };
}

function statusOnBranch(currentBranch: string) {
  return makeWorkspaceStatus({
    branch: { currentBranch, defaultBranch: "main" },
  });
}

describe("Git plugin server", () => {
  function turnEndEvent(threadId: string) {
    return {
      type: "changed" as const,
      entity: "thread" as const,
      id: threadId,
      changes: ["status-changed" as const],
      metadata: {
        statusChange: {
          status: "idle" as const,
          runtime: { displayStatus: "idle" as const, failure: null },
          activity: {
            activeBackgroundAgentCount: 0,
            activeBackgroundCommandCount: 0,
            activePlanModeCount: 0,
            activeWorkflowCount: 0,
          },
          latestAttentionAt: 0,
          statusChangedAt: 0,
          updatedAt: 0,
        },
      },
    };
  }

  function turnEndHarness() {
    const subscriptions = new Set<
      Parameters<BbPluginApi["sdk"]["subscribe"]>[0]
    >();
    const state = { branch: "before-edit", threadReads: 0 };
    const fake = createFakePluginHost({
      pluginId: "bb--git",
      sdk: {
        environments: {
          get: async () => environment(),
          experimental_repos: async () => reposOf(environment()),
        },
        threads: {
          get: async () => {
            state.threadReads += 1;
            return { id: "thread-1", environmentId: "env-1" };
          },
        },
        subscribe: (args: Parameters<BbPluginApi["sdk"]["subscribe"]>[0]) => {
          subscriptions.add(args);
          return () => subscriptions.delete(args);
        },
      },
      experimental_callHostRpc: (call) =>
        call.method === "status"
          ? { outcome: "available", value: statusOnBranch(state.branch) }
          : hostResult(call),
    });
    plugin(fake.bb);
    const readBranch = async () =>
      (
        (await fake.harness.callRpc("status", { keys: ["env-1"] })) as Record<
          string,
          { workspace?: { branch: { currentBranch: string | null } } }
        >
      )["env-1"]?.workspace?.branch.currentBranch;
    const endTurn = async (threadId: string) => {
      for (const subscription of subscriptions) {
        if (subscription.event !== "thread:changed") continue;
        subscription.callback(turnEndEvent(threadId));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { fake, state, subscriptions, readBranch, endTurn };
  }

  it("refreshes status when a turn ends even if the watcher missed the edit", async () => {
    const { fake, state, readBranch, endTurn } = turnEndHarness();
    fake.harness.experimental_watchRpc("status", { key: "env-1" });

    expect(await readBranch()).toBe("before-edit");
    state.branch = "after-edit";
    expect(await readBranch()).toBe("before-edit");

    await endTurn("thread-1");
    expect(await readBranch()).toBe("after-edit");
  });

  it("asks nothing about ended turns while no environment is watched, and stops listening on dispose", async () => {
    const { fake, state, subscriptions, endTurn } = turnEndHarness();
    expect(subscriptions.size).toBe(0);
    const stop = fake.harness.experimental_watchRpc("status", { key: "env-1" });
    await endTurn("thread-1");
    await endTurn("thread-1");
    expect(state.threadReads).toBe(1);
    stop();
    expect(subscriptions.size).toBe(0);
    await endTurn("thread-2");
    expect(state.threadReads).toBe(1);

    fake.harness.experimental_watchRpc("status", { key: "env-1" });
    expect(subscriptions.size).toBeGreaterThan(0);
    await fake.harness.lifecycle.dispose();
    expect(subscriptions.size).toBe(0);
  });

  it("reads fresh status when an environment is watched again after its last viewer left", async () => {
    const { fake, state, readBranch } = turnEndHarness();
    const stop = fake.harness.experimental_watchRpc("status", { key: "env-1" });
    expect(await readBranch()).toBe("before-edit");
    stop();
    state.branch = "after-edit";
    fake.harness.experimental_watchRpc("status", { key: "env-1" });
    expect(await readBranch()).toBe("after-edit");
  });

  it("reads each environment's status against its merge base, one row per key", async () => {
    const { fake } = await setup({
      "env-1": environment({ mergeBaseBranch: "release" }),
      "env-plain": environment({ id: "env-plain", isGitRepo: false }),
      "env-starting": environment({
        id: "env-starting",
        status: "provisioning",
      }),
    });

    await expect(
      fake.harness.callRpc("status", {
        keys: ["env-1", "env-plain", "env-starting", "env-missing"],
      }),
    ).resolves.toEqual({
      "env-1": { outcome: "available", workspace: makeWorkspaceStatus() },
      "env-plain": expect.objectContaining({ outcome: "not_applicable" }),
      "env-starting": {
        outcome: "failed",
        message: "Workspace is still starting.",
      },
      "env-missing": {
        outcome: "failed",
        message: "Environment not found: env-missing",
      },
    });
    expect(fake.harness.experimental_hostRpcCalls).toMatchObject([
      {
        method: "status",
        hostId: "host-1",
        input: { path: "/work/env-1", mergeBaseBranch: "release" },
      },
    ]);
  });

  it("shares one host read for repeated status reads", async () => {
    const { fake } = await setup({ "env-1": environment() });
    await Promise.all([
      fake.harness.callRpc("status", { keys: ["env-1"] }),
      fake.harness.callRpc("status", { keys: ["env-1"] }),
    ]);
    await fake.harness.callRpc("status", { keys: ["env-1"] });
    expect(
      fake.harness.experimental_hostRpcCalls.filter(
        (call) => call.method === "status",
      ),
    ).toHaveLength(1);
  });

  it("reads status afresh for each workspaceStatus call", async () => {
    const { fake } = await setup({ "env-1": environment() });
    await fake.harness.callRpc("workspaceStatus", { environmentId: "env-1" });
    await fake.harness.callRpc("workspaceStatus", { environmentId: "env-1" });
    expect(
      fake.harness.experimental_hostRpcCalls.filter(
        (call) => call.method === "status",
      ),
    ).toHaveLength(2);
  });

  it("forwards the target and whitespace mode to the file list", async () => {
    const { fake } = await setup({ "env-1": environment() });
    await expect(
      fake.harness.callRpc("files", {
        environmentId: "env-1",
        target: { type: "all", mergeBaseBranch: "main" },
        ignoreWhitespace: true,
      }),
    ).resolves.toMatchObject({ outcome: "available", truncated: true });
    expect(fake.harness.experimental_hostRpcCalls).toMatchObject([
      {
        method: "files",
        input: {
          path: "/work/env-1",
          target: { type: "all", mergeBaseBranch: "main" },
          ignoreWhitespace: true,
        },
      },
    ]);
  });

  it("reuses a finished file list for the next read", async () => {
    const { fake } = await setup({ "env-1": environment() });
    const input = {
      environmentId: "env-1",
      target: { type: "all" as const, mergeBaseBranch: "main" },
      ignoreWhitespace: false,
    };
    await fake.harness.callRpc("files", input);
    await fake.harness.callRpc("files", input);
    expect(
      fake.harness.experimental_hostRpcCalls.filter(
        (call) => call.method === "files",
      ),
    ).toHaveLength(1);
  });

  it("asks the host again for patches it deferred to stay under its result cap", async () => {
    const fake = createFakePluginHost({
      pluginId: "bb--git",
      sdk: {
        subscribe: () => () => {},
        environments: {
          get: async () => environment(),
          experimental_repos: async () => reposOf(environment()),
        },
      },
      experimental_callHostRpc: (call) => {
        if (call.method !== "patches") return hostResult(call);
        const [first, ...rest] = (call.input as { paths: string[] }).paths;
        return {
          outcome: "available",
          value: {
            patches: [
              { path: first, patch: `patch ${first}`, truncated: false },
            ],
            deferred: rest,
          },
        };
      },
    });
    plugin(fake.bb);
    const keys = ["a.ts", "b.ts", "c.ts"].map((path) =>
      gitPatchKey({
        environmentId: "env-1",
        target: { type: "uncommitted" },
        ignoreWhitespace: false,
        path,
        revision: "rev",
      }),
    );
    const rows = (await fake.harness.callRpc("patches", { keys })) as Record<
      string,
      { outcome: string }
    >;
    expect(keys.map((key) => rows[key]?.outcome)).toEqual([
      "available",
      "available",
      "available",
    ]);
    expect(fake.harness.experimental_hostRpcCalls).toHaveLength(3);
  });

  it("reads patches for one diff in a single host call and answers every key", async () => {
    const { fake } = await setup({ "env-1": environment() });
    const key = (path: string, revision = `rev-${path}`) =>
      gitPatchKey({
        environmentId: "env-1",
        target: { type: "uncommitted" },
        ignoreWhitespace: false,
        path,
        revision,
      });
    const result = (await fake.harness.callRpc("patches", {
      keys: [key("a.ts"), key("b.ts"), key("a.ts", "rev-older")],
    })) as Record<string, unknown>;
    expect(result).toEqual({
      [key("a.ts")]: {
        outcome: "available",
        patch: { path: "a.ts", patch: "patch a.ts", truncated: false },
      },
      [key("a.ts", "rev-older")]: {
        outcome: "available",
        patch: { path: "a.ts", patch: "patch a.ts", truncated: false },
      },
      [key("b.ts")]: {
        outcome: "available",
        patch: { path: "b.ts", patch: "patch b.ts", truncated: false },
      },
    });
    expect(fake.harness.experimental_hostRpcCalls).toMatchObject([
      { method: "patches", input: { paths: ["a.ts", "b.ts"] } },
    ]);
  });

  it("returns core's file read failure codes for a file side", async () => {
    const { fake } = await setup({ "env-1": environment() });
    await expect(
      fake.harness.callRpc("fileSide", {
        environmentId: "env-1",
        query: { target: "uncommitted", path: "gone.ts", side: "new" },
      }),
    ).resolves.toEqual({
      outcome: "unavailable",
      code: "file_too_large",
      message: "File size 30000000 bytes exceeds the 25 MB limit",
    });
    await expect(
      fake.harness.callRpc("fileSide", {
        environmentId: "env-1",
        query: { target: "uncommitted", path: "../escape.ts", side: "new" },
      }),
    ).resolves.toMatchObject({ outcome: "unavailable", code: "invalid_path" });
  });

  it("stores no merge base override when the user picks the default", async () => {
    const { fake, updates } = await setup({
      "env-1": environment({ mergeBaseBranch: "release" }),
    });
    await fake.harness.callRpc("setMergeBase", {
      environmentId: "env-1",
      mergeBaseBranch: "main",
    });
    await fake.harness.callRpc("setMergeBase", {
      environmentId: "env-1",
      mergeBaseBranch: "develop",
    });
    expect(updates).toEqual([
      { environmentId: "env-1", mergeBaseBranch: null },
      { environmentId: "env-1", mergeBaseBranch: "develop" },
    ]);
  });

  it("treats the workspace's default branch as the default merge base", async () => {
    const { fake, updates } = await setup({
      "env-1": environment({ defaultBranch: null, mergeBaseBranch: "release" }),
    });
    await fake.harness.callRpc("setMergeBase", {
      environmentId: "env-1",
      mergeBaseBranch: makeWorkspaceStatus().branch.defaultBranch,
    });
    expect(updates).toEqual([
      { environmentId: "env-1", mergeBaseBranch: null },
    ]);
  });
});

describe("Git plugin workspace change refreshes", () => {
  const filesInput = {
    environmentId: "env-1",
    target: { type: "uncommitted" as const },
    ignoreWhitespace: false,
  };
  const changedFile = {
    path: "a.ts",
    previousPath: null,
    changeKind: "modified" as const,
    additions: 1,
    deletions: 1,
    binary: false,
    origin: "tracked" as const,
    loadMode: "auto" as const,
    revision: "100644:aaa:100644:bbb",
  };
  const patch = {
    path: "a.ts",
    patch: "@@ -1 +1 @@\n-a\n+b\n",
    truncated: false,
  };

  function changeHarness() {
    const subscriptions = new Set<
      Parameters<BbPluginApi["sdk"]["subscribe"]>[0]
    >();
    const state = {
      branch: "feature",
      revision: changedFile.revision,
      snapshotError: null as Error | null,
      statusDelay: null as Promise<void> | null,
    };
    const filesFingerprint = () => `files:${state.revision}`;
    const filesValue = (knownPatches: { path: string; revision: string }[]) => {
      const reused = knownPatches.some(
        (known) => known.path === "a.ts" && known.revision === state.revision,
      );
      return {
        files: [{ ...changedFile, revision: state.revision }],
        truncated: false,
        shortstat: " 1 file changed, 1 insertion(+), 1 deletion(-)\n",
        mergeBaseRef: null,
        initialPatches: reused ? [] : [patch],
        reusedPatchPaths: reused ? ["a.ts"] : [],
      };
    };
    const fake = createFakePluginHost({
      pluginId: "bb--git",
      sdk: {
        environments: {
          get: async () => environment(),
          experimental_repos: async () => reposOf(environment()),
        },
        subscribe: (args: Parameters<BbPluginApi["sdk"]["subscribe"]>[0]) => {
          subscriptions.add(args);
          return () => subscriptions.delete(args);
        },
      },
      experimental_callHostRpc: async (call) => {
        const status = {
          outcome: "available",
          value: statusOnBranch(state.branch),
        };
        switch (call.method) {
          case "status":
            await state.statusDelay;
            return status;
          case "files": {
            const input = call.input as {
              knownPatches: { path: string; revision: string }[];
            };
            return {
              outcome: "available",
              value: filesValue(input.knownPatches),
              fingerprint: filesFingerprint(),
            };
          }
          case "snapshot": {
            if (state.snapshotError) throw state.snapshotError;
            const input = call.input as {
              statusUnless?: string;
              files: {
                knownPatches: { path: string; revision: string }[];
                unless?: string;
              }[];
            };
            const statusFingerprint = `status:${state.branch}`;
            return {
              outcome: "available",
              value: {
                status:
                  input.statusUnless === statusFingerprint
                    ? { outcome: "unchanged" }
                    : { ...status, fingerprint: statusFingerprint },
                files: input.files.map((query) =>
                  query.unless === filesFingerprint()
                    ? { outcome: "unchanged" }
                    : {
                        outcome: "available",
                        value: filesValue(query.knownPatches),
                        fingerprint: filesFingerprint(),
                      },
                ),
              },
            };
          }
          default:
            return hostResult(call);
        }
      },
    });
    plugin(fake.bb);
    fake.harness.experimental_watchRpc("status", { key: "env-1" });
    fake.harness.experimental_watchRpc("files", { input: filesInput });
    const workspaceChanged = () => {
      for (const subscription of subscriptions) {
        if (subscription.event !== "environment:changed") continue;
        subscription.callback({
          type: "changed",
          entity: "environment",
          id: "env-1",
          changes: ["work-status-changed"],
        });
      }
    };
    const hostCalls = (method: string) =>
      fake.harness.experimental_hostRpcCalls.filter(
        (call) => call.method === method,
      ).length;
    const readBoth = () =>
      Promise.all([
        fake.harness.callRpc("status", { keys: ["env-1"] }),
        fake.harness.callRpc("files", filesInput),
      ]);
    return { fake, state, workspaceChanged, hostCalls, readBoth };
  }

  it("checks a burst of workspace writes with one host snapshot and refreshes nothing while the diff is unchanged", async () => {
    const { fake, workspaceChanged, hostCalls, readBoth } = changeHarness();
    await readBoth();
    workspaceChanged();
    workspaceChanged();
    await vi.waitFor(() => expect(hostCalls("snapshot")).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.harness.experimental_rpcInvalidations).toEqual([]);

    await readBoth();
    expect([hostCalls("status"), hostCalls("files")]).toEqual([1, 1]);
  });

  it("refreshes only the reads whose result changed and answers their refetch from the snapshot", async () => {
    const { fake, state, workspaceChanged, hostCalls, readBoth } =
      changeHarness();
    await readBoth();
    state.branch = "renamed";
    workspaceChanged();
    await vi.waitFor(() =>
      expect(fake.harness.experimental_rpcInvalidations).toEqual([
        [gitStatusTag("env-1")],
      ]),
    );

    const [status] = await readBoth();
    expect(status).toMatchObject({
      "env-1": { workspace: { branch: { currentBranch: "renamed" } } },
    });
    expect([
      hostCalls("status"),
      hostCalls("files"),
      hostCalls("snapshot"),
    ]).toEqual([1, 1, 1]);
  });

  it("reads a fresh revision when opening a file list the snapshot did not cover", async () => {
    const { fake, state, workspaceChanged, readBoth } = changeHarness();
    const alternate = { ...filesInput, ignoreWhitespace: true };
    await readBoth();
    await fake.harness.callRpc("files", alternate);
    state.revision = "100644:aaa:100644:ccc";
    workspaceChanged();
    await vi.waitFor(() =>
      expect(fake.harness.experimental_rpcInvalidations).toContainEqual([
        gitFilesTag("env-1"),
      ]),
    );
    fake.harness.experimental_watchRpc("files", { input: alternate });
    await expect(
      fake.harness.callRpc("files", alternate),
    ).resolves.toMatchObject({
      files: [{ revision: state.revision }],
    });
  });

  it("refreshes both reads after a snapshot transport failure", async () => {
    const { fake, state, workspaceChanged, readBoth } = changeHarness();
    await readBoth();
    state.snapshotError = new Error("Host disconnected");
    state.branch = "renamed";
    state.revision = "100644:aaa:100644:ccc";
    workspaceChanged();
    await vi.waitFor(() =>
      expect(fake.harness.experimental_rpcInvalidations).toContainEqual([
        gitStatusTag("env-1"),
        gitFilesTag("env-1"),
      ]),
    );
    await expect(readBoth()).resolves.toMatchObject([
      { "env-1": { workspace: { branch: { currentBranch: "renamed" } } } },
      { files: [{ revision: state.revision }] },
    ]);
  });

  it("lets the host answer unchanged for reads the server already holds", async () => {
    const { fake, workspaceChanged, hostCalls, readBoth } = changeHarness();
    await readBoth();
    workspaceChanged();
    await vi.waitFor(() => expect(hostCalls("snapshot")).toBe(1));
    workspaceChanged();
    await vi.waitFor(() => expect(hostCalls("snapshot")).toBe(2), {
      timeout: 3_000,
    });
    const snapshots = fake.harness.experimental_hostRpcCalls.filter(
      (call) => call.method === "snapshot",
    );
    expect(snapshots[0]?.input).toMatchObject({
      files: [{ unless: "files:100644:aaa:100644:bbb" }],
    });
    expect(snapshots[1]?.input).toMatchObject({
      statusUnless: "status:feature",
      files: [{ unless: "files:100644:aaa:100644:bbb" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.harness.experimental_rpcInvalidations).toEqual([]);
    const [status, files] = await readBoth();
    expect(status).toMatchObject({
      "env-1": { workspace: { branch: { currentBranch: "feature" } } },
    });
    expect(files).toMatchObject({ initialPatches: [patch] });
    expect([hostCalls("status"), hostCalls("files")]).toEqual([1, 1]);
  });

  it("does not let a read that started before a change stand in for the check after it", async () => {
    const { fake, state, workspaceChanged } = changeHarness();
    let release = () => {};
    state.statusDelay = new Promise((resolve) => {
      release = resolve;
    });
    const slowRead = fake.harness.callRpc("status", { keys: ["env-1"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    state.branch = "renamed";
    workspaceChanged();
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await slowRead;
    await vi.waitFor(() =>
      expect(fake.harness.experimental_rpcInvalidations).toContainEqual(
        expect.arrayContaining([gitStatusTag("env-1")]),
      ),
    );
    await expect(
      fake.harness.callRpc("status", { keys: ["env-1"] }),
    ).resolves.toMatchObject({
      "env-1": { workspace: { branch: { currentBranch: "renamed" } } },
    });
  });

  it("asks the host only for patches the server does not already hold", async () => {
    const { fake, state, workspaceChanged, hostCalls } = changeHarness();
    await expect(
      fake.harness.callRpc("files", filesInput),
    ).resolves.toMatchObject({ initialPatches: [patch] });

    state.branch = "renamed";
    workspaceChanged();
    await vi.waitFor(() => expect(hostCalls("snapshot")).toBe(1));
    const snapshot = fake.harness.experimental_hostRpcCalls.find(
      (call) => call.method === "snapshot",
    );
    expect(snapshot?.input).toMatchObject({
      files: [{ knownPatches: [{ path: "a.ts", revision: state.revision }] }],
    });
    await expect(
      fake.harness.callRpc("files", filesInput),
    ).resolves.toMatchObject({ initialPatches: [patch] });

    state.revision = "100644:aaa:100644:ccc";
    workspaceChanged();
    await vi.waitFor(
      () =>
        expect(fake.harness.experimental_rpcInvalidations.at(-1)).toContain(
          gitFilesTag("env-1"),
        ),
      { timeout: 3_000 },
    );
    await expect(
      fake.harness.callRpc("files", filesInput),
    ).resolves.toMatchObject({
      files: [{ revision: "100644:aaa:100644:ccc" }],
      initialPatches: [patch],
    });
    expect(hostCalls("files")).toBe(1);
  });
});

describe("Git plugin Viewed marks", () => {
  async function viewedHost(
    options: { coreMarks?: unknown; existing?: string[] } = {},
  ) {
    const existing = options.existing ?? ["env-1", "env-2"];
    const fake = createFakePluginHost({
      pluginId: "bb--git",
      sdk: {
        subscribe: () => () => {},
        environments: {
          get: async ({ environmentId }: { environmentId: string }) => {
            if (!existing.includes(environmentId)) {
              throw new experimental_BbHttpError({
                status: 404,
                code: null,
                message: "Environment not found",
                body: null,
              });
            }
            return environment({ id: environmentId });
          },
        },
      },
    });
    if (options.coreMarks !== undefined) {
      await fake.bb.storage.kv.set(
        VIEWED_MARKS_FROM_CORE_KEY,
        options.coreMarks,
      );
    }
    plugin(fake.bb);
    const call = (method: string, input: Record<string, unknown>) =>
      fake.harness.callRpc(method, { environmentId: "env-1", ...input });
    const list = (target: unknown, paths?: string[]) =>
      call("viewed", { target, ...(paths === undefined ? {} : { paths }) });
    return { fake, call, list };
  }

  const uncommitted = { type: "uncommitted" };

  it("keeps marks per environment and diff target", async () => {
    const { call, list } = await viewedHost();
    await call("markViewed", {
      target: uncommitted,
      path: "b.ts",
      revision: "rev-b",
    });
    await call("markViewed", {
      target: uncommitted,
      path: "a.ts",
      revision: "rev-1",
    });
    await expect(
      call("markViewed", {
        target: uncommitted,
        path: "a.ts",
        revision: "rev-2",
      }),
    ).resolves.toEqual({ ok: true });
    await call("markViewed", {
      target: { type: "commit", sha: "ABCDEF1" },
      path: "a.ts",
      revision: "rev-commit",
    });

    await expect(list(uncommitted)).resolves.toEqual({
      files: [
        { path: "a.ts", revision: "rev-2" },
        { path: "b.ts", revision: "rev-b" },
      ],
    });
    await expect(
      list(uncommitted, ["b.ts", "missing.ts", "b.ts"]),
    ).resolves.toEqual({
      files: [{ path: "b.ts", revision: "rev-b" }],
    });
    await expect(list(uncommitted, [])).resolves.toEqual({ files: [] });
    await expect(list({ type: "commit", sha: "abcdef1" })).resolves.toEqual({
      files: [{ path: "a.ts", revision: "rev-commit" }],
    });
    await expect(
      call("viewed", { environmentId: "env-2", target: uncommitted }),
    ).resolves.toEqual({ files: [] });

    await call("clearViewed", { target: uncommitted, path: "a.ts" });
    await expect(list(uncommitted)).resolves.toEqual({
      files: [{ path: "b.ts", revision: "rev-b" }],
    });
    await call("clearViewed", { target: uncommitted });
    await expect(list(uncommitted)).resolves.toEqual({ files: [] });
    await expect(list({ type: "commit", sha: "abcdef1" })).resolves.toEqual({
      files: [{ path: "a.ts", revision: "rev-commit" }],
    });

    await expect(
      call("markViewed", { target: uncommitted, path: "", revision: "rev" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      call("markViewed", {
        environmentId: "env-missing",
        target: uncommitted,
        path: "a.ts",
        revision: "rev",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("takes over the marks core stored once and forgets deleted environments", async () => {
    const mark = (environmentId: string, path: string) => ({
      environmentId,
      targetKey: "uncommitted",
      path,
      revision: `rev-${path}`,
      updatedAt: 1,
    });
    const { fake, list } = await viewedHost({
      coreMarks: [mark("env-1", "a.ts"), mark("env-gone", "b.ts")],
      existing: ["env-1"],
    });

    await expect(list(uncommitted)).resolves.toEqual({
      files: [{ path: "a.ts", revision: "rev-a.ts" }],
    });
    await expect(
      fake.bb.storage.kv.get(VIEWED_MARKS_FROM_CORE_KEY),
    ).resolves.toBeUndefined();
    await vi.waitFor(() =>
      expect(
        fake.bb.storage
          .database()
          .prepare("SELECT DISTINCT environment_id FROM viewed_files")
          .pluck()
          .all(),
      ).toEqual(["env-1"]),
    );
  });

  it("refreshes watched Viewed reads after a change", async () => {
    const { fake, call } = await viewedHost();
    fake.harness.experimental_watchRpc("viewed", {
      input: { environmentId: "env-1", target: uncommitted },
    });
    await call("markViewed", {
      target: uncommitted,
      path: "a.ts",
      revision: "rev",
    });
    await vi.waitFor(() =>
      expect(fake.harness.experimental_rpcInvalidations).toContainEqual([
        gitViewedTag("env-1"),
      ]),
    );
  });
});

describe("Git plugin server across several repos", () => {
  const REPOS = [
    {
      rootPath: "/mono",
      path: "/mono/packages/app",
      label: "",
      source: "main" as const,
    },
    {
      rootPath: "/work/api",
      path: "/work/api",
      label: "../../../work/api",
      source: "folder" as const,
    },
  ];

  function changed(path: string) {
    return {
      path,
      previousPath: null,
      changeKind: "modified" as const,
      additions: 1,
      deletions: 0,
      binary: false,
      origin: "tracked" as const,
      loadMode: "auto" as const,
      revision: `rev-${path}`,
    };
  }

  function multiRepoSetup() {
    const reads: unknown[] = [];
    const subscriptions = new Set<
      Parameters<BbPluginApi["sdk"]["subscribe"]>[0]
    >();
    const state = { apiFile: "server.ts" };
    const repoFiles = (path: string) => ({
      files: [
        changed(path === "/mono" ? "packages/app/file.txt" : state.apiFile),
      ],
      truncated: false,
      shortstat: " 1 file changed, 1 insertion(+)\n",
      mergeBaseRef: path === "/mono" ? "a".repeat(40) : null,
      initialPatches: [],
      reusedPatchPaths: [],
    });
    const fake = createFakePluginHost({
      pluginId: "bb--git",
      sdk: {
        subscribe: (args: Parameters<BbPluginApi["sdk"]["subscribe"]>[0]) => {
          subscriptions.add(args);
          return () => subscriptions.delete(args);
        },
        environments: {
          get: async () => environment({ path: "/mono/packages/app" }),
          experimental_repos: async () => ({ repos: REPOS, truncated: false }),
        },
        files: {
          read: async (args: unknown) => {
            reads.push(args);
            return {
              path: "/mono/packages/app/file.txt",
              content: "two",
              contentEncoding: "utf8" as const,
              sizeBytes: 3,
            };
          },
        },
      },
      experimental_callHostRpc: (call) => {
        const input = call.input as { path: string; paths?: string[] };
        switch (call.method) {
          case "status":
            return {
              outcome: "available",
              value: makeWorkspaceStatus({
                branch: { currentBranch: "feature", defaultBranch: "develop" },
              }),
            };
          case "files":
            return {
              outcome: "available",
              fingerprint: `files:${input.path}:${state.apiFile}`,
              value: repoFiles(input.path),
            };
          case "snapshot": {
            const snapshot = call.input as {
              files: { unless?: string }[];
            };
            const fingerprint = `files:${input.path}:${state.apiFile}`;
            return {
              outcome: "available",
              value: {
                status: {
                  outcome: "available",
                  fingerprint: "status",
                  value: makeWorkspaceStatus({
                    branch: {
                      currentBranch: "feature",
                      defaultBranch: "develop",
                    },
                  }),
                },
                files: snapshot.files.map((query) =>
                  query.unless === fingerprint
                    ? { outcome: "unchanged" }
                    : {
                        outcome: "available",
                        fingerprint,
                        value: repoFiles(input.path),
                      },
                ),
              },
            };
          }
          default:
            return hostResult(call);
        }
      },
    });
    plugin(fake.bb);
    const workspaceChanged = () => {
      for (const subscription of subscriptions) {
        if (subscription.event !== "environment:changed") continue;
        subscription.callback({
          type: "changed",
          entity: "environment",
          id: "env-1",
          changes: ["work-status-changed"],
        });
      }
    };
    return { fake, reads, state, workspaceChanged };
  }

  it("checks every repo in the workspace change snapshot and serves the grouped refetch from it", async () => {
    const { fake, state, workspaceChanged } = multiRepoSetup();
    const input = {
      environmentId: "env-1",
      target: { type: "all" as const, mergeBaseBranch: "main" },
      ignoreWhitespace: false,
    };
    fake.harness.experimental_watchRpc("files", { input });
    await fake.harness.callRpc("files", input);
    const hostCalls = (method: string) =>
      fake.harness.experimental_hostRpcCalls.filter(
        (call) => call.method === method,
      );
    const filesCalls = hostCalls("files").length;

    state.apiFile = "routes.ts";
    workspaceChanged();
    await vi.waitFor(() =>
      expect(fake.harness.experimental_rpcInvalidations.flat()).toContain(
        gitFilesTag("env-1"),
      ),
    );
    expect(
      hostCalls("snapshot").map((call) => {
        const snapshot = call.input as {
          path: string;
          files: { target: unknown; unless?: string }[];
        };
        return {
          path: snapshot.path,
          files: snapshot.files.map(({ target, unless }) => ({
            target,
            unless,
          })),
        };
      }),
    ).toEqual(
      expect.arrayContaining([
        { path: "/mono/packages/app", files: [] },
        {
          path: "/mono",
          files: [
            {
              target: { type: "all", mergeBaseBranch: "main" },
              unless: "files:/mono:server.ts",
            },
          ],
        },
        {
          path: "/work/api",
          files: [
            {
              target: { type: "all", mergeBaseBranch: "develop" },
              unless: "files:/work/api:server.ts",
            },
          ],
        },
      ]),
    );

    await expect(fake.harness.callRpc("files", input)).resolves.toMatchObject({
      repos: [{ label: "" }, { label: "../../../work/api" }],
      files: [
        { path: "packages/app/file.txt" },
        { path: "../../../work/api/routes.ts" },
      ],
    });
    expect(hostCalls("files")).toHaveLength(filesCalls);
  });

  it("lists every repo's changes under its label and compares extra repos with their own default branch", async () => {
    const { fake } = multiRepoSetup();

    const result = await fake.harness.callRpc("files", {
      environmentId: "env-1",
      target: { type: "all", mergeBaseBranch: "main" },
      ignoreWhitespace: false,
    });

    expect(result).toMatchObject({
      outcome: "available",
      repos: [
        { label: "", rootPath: "/mono", error: null },
        { label: "../../../work/api", rootPath: "/work/api", error: null },
      ],
      files: [
        { path: "packages/app/file.txt" },
        { path: "../../../work/api/server.ts" },
      ],
      mergeBaseRef: "a".repeat(40),
    });
    expect(
      fake.harness.experimental_hostRpcCalls
        .filter((call) => call.method === "files")
        .map((call) => call.input),
    ).toEqual([
      expect.objectContaining({
        path: "/mono",
        target: { type: "all", mergeBaseBranch: "main" },
      }),
      expect.objectContaining({
        path: "/work/api",
        target: { type: "all", mergeBaseBranch: "develop" },
      }),
    ]);

    const commit = await fake.harness.callRpc("files", {
      environmentId: "env-1",
      target: { type: "commit", sha: "abcdef1" },
      ignoreWhitespace: false,
    });
    expect(commit).toMatchObject({
      files: [{ path: "packages/app/file.txt" }],
    });
  });

  it("reads each patch from its own repo and keeps the labelled path", async () => {
    const { fake } = multiRepoSetup();
    const key = (path: string) =>
      gitPatchKey({
        environmentId: "env-1",
        target: { type: "uncommitted" },
        ignoreWhitespace: false,
        path,
        revision: `rev-${path}`,
      });

    const results = (await fake.harness.callRpc("patches", {
      keys: [key("packages/app/file.txt"), key("../../../work/api/server.ts")],
    })) as Record<string, unknown>;

    expect(Object.values(results)).toEqual([
      {
        outcome: "available",
        patch: {
          path: "packages/app/file.txt",
          patch: "patch packages/app/file.txt",
          truncated: false,
        },
      },
      {
        outcome: "available",
        patch: {
          path: "../../../work/api/server.ts",
          patch: "patch server.ts",
          truncated: false,
        },
      },
    ]);
    expect(
      fake.harness.experimental_hostRpcCalls
        .filter((call) => call.method === "patches")
        .map((call) => call.input),
    ).toEqual([
      expect.objectContaining({
        path: "/mono",
        paths: ["packages/app/file.txt"],
      }),
      expect.objectContaining({ path: "/work/api", paths: ["server.ts"] }),
    ]);
  });

  it("reads a file side from the repo root when the main folder is a subfolder of it", async () => {
    const { fake, reads } = multiRepoSetup();

    await fake.harness.callRpc("fileSide", {
      environmentId: "env-1",
      query: {
        target: "uncommitted",
        path: "packages/app/file.txt",
        side: "new",
      },
    });

    expect(reads).toEqual([
      expect.objectContaining({
        path: "/mono/packages/app/file.txt",
        rootPath: "/mono",
      }),
    ]);
  });
});
