import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  type ExperimentalFakeHostRpcCall,
} from "@get-bb/plugin-sdk/testing";
import { makeWorkspaceStatus } from "./testing.js";
import { describe, expect, it } from "vitest";
import { gitPatchKey } from "./contract.js";
import plugin from "./server.js";

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
        value: {
          files: [],
          truncated: true,
          shortstat: "",
          mergeBaseRef: null,
          initialPatches: [],
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

async function setup(environments: Record<string, Environment>) {
  const updates: unknown[] = [];
  const fake = createFakePluginHost({
    pluginId: "bb--git",
    sdk: {
      subscribe: () => () => {},
      files: {
        read: async () => {
          throw Object.assign(new Error("HTTP 413: too large"), {
            status: 413,
            code: "file_too_large",
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
            throw Object.assign(new Error("Environment not found"), {
              status: 404,
            });
          }
          return found;
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
          runtime: { displayStatus: "idle" as const },
          activity: {
            activeBackgroundAgentCount: 0,
            activeBackgroundCommandCount: 0,
            activeGoalCount: 0,
            activePlanModeCount: 0,
            activeWorkflowCount: 0,
          },
          latestAttentionAt: 0,
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
        environments: { get: async () => environment() },
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
      "env-starting": environment({ id: "env-starting", status: "provisioning" }),
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
        environments: { get: async () => environment() },
      },
      experimental_callHostRpc: (call) => {
        if (call.method !== "patches") return hostResult(call);
        const [first, ...rest] = (call.input as { paths: string[] }).paths;
        return {
          outcome: "available",
          value: {
            patches: [{ path: first, patch: `patch ${first}`, truncated: false }],
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
    expect(updates).toEqual([{ environmentId: "env-1", mergeBaseBranch: null }]);
  });
});
