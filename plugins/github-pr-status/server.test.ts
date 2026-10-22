import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeHostResponse,
  type ExperimentalFakeHostRpcCall,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import type { GitHubPullRequestView } from "./contract.js";
import plugin, { environmentChangeEffect } from "./server.js";

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
    branchName: "bb/pr",
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

function view(
  overrides: Partial<GitHubPullRequestView> = {},
): GitHubPullRequestView {
  return {
    number: 7,
    title: "Ship it",
    state: "OPEN",
    url: "https://github.com/acme/bb/pull/7",
    isDraft: false,
    autoMerge: false,
    inMergeQueue: false,
    baseRefName: "main",
    headRefName: "bb/pr",
    updatedAt: "2026-10-01T00:00:00Z",
    checks: [],
    reviewDecision: null,
    reviewRequestCount: 0,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    ...overrides,
  };
}

async function setup(options: {
  environments?: Record<string, Environment>;
  host?: Parameters<typeof makeHostResponse>[0];
  callHost?: (call: ExperimentalFakeHostRpcCall) => unknown;
}) {
  const environments = options.environments ?? { "env-1": environment() };
  const fake = createFakePluginHost({
    pluginId: "bb--github-pr-status",
    sdk: {
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
      },
      hosts: { get: async () => makeHostResponse(options.host) },
    },
    experimental_callHostRpc:
      options.callHost ??
      ((call) =>
        call.method === "view"
          ? { outcome: "found", pullRequest: view() }
          : { ok: true }),
  });
  await plugin(fake.bb);
  return fake;
}

describe("GitHub PR Status server", () => {
  it("reads every requested environment in one call", async () => {
    const fake = await setup({
      environments: {
        "env-1": environment(),
        "env-plain": environment({ id: "env-plain", isGitRepo: false }),
        "env-asleep": environment({ id: "env-asleep", hostId: "host-2" }),
      },
      callHost: (call) => {
        if (call.hostId === "host-2") throw new Error("Host is suspended");
        return { outcome: "found", pullRequest: view() };
      },
    });

    await expect(
      fake.harness.callRpc("pullRequests", {
        keys: ["env-1", "env-plain", "env-asleep", "env-missing"],
      }),
    ).resolves.toEqual({
      "env-1": {
        outcome: "available",
        pullRequest: expect.objectContaining({
          number: 7,
          state: "open",
          attention: "none",
        }),
      },
      "env-plain": { outcome: "absent" },
      "env-asleep": { outcome: "unavailable", message: "Host is suspended" },
      "env-missing": { outcome: "absent" },
    });
    expect(fake.harness.experimental_hostRpcCalls).toMatchObject([
      { method: "view", input: { path: "/work/env-1" }, hostId: "host-1" },
      { method: "view", hostId: "host-2" },
    ]);
  });

  it("refuses actions without calling a machine that isn't available", async () => {
    const fake = await setup({
      host: {
        name: "Sandbox",
        status: "disconnected",
        lifecycle: {
          phase: "suspended",
          suspendedAt: 1,
          message: null,
          pendingLog: "",
          teardown: null,
        },
      },
    });

    await expect(
      fake.harness.callRpc("merge", {
        environmentId: "env-1",
        method: "squash",
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("Sandbox isn't available"),
    });
    expect(fake.harness.experimental_hostRpcCalls).toEqual([]);
  });

  it("checks the current pull request state before running an action", async () => {
    const fake = await setup({});

    await expect(
      fake.harness.callRpc("markReady", { environmentId: "env-1" }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "Pull request is not a draft",
    });
    await expect(
      fake.harness.callRpc("merge", {
        environmentId: "env-1",
        method: "rebase",
      }),
    ).resolves.toEqual({ message: "Pull request merge started" });
    expect(
      fake.harness.experimental_hostRpcCalls.filter(
        (call) => call.method === "act",
      ),
    ).toMatchObject([
      {
        input: {
          path: "/work/env-1",
          action: { operation: "merge", method: "rebase" },
        },
        hostId: "host-1",
      },
    ]);
  });

  it("returns the gh failure as a refusal and the CLI prints it", async () => {
    const fake = await setup({
      callHost: (call) =>
        call.method === "view"
          ? { outcome: "found", pullRequest: view({ isDraft: true }) }
          : { ok: false, message: "gh pr ready failed: HTTP 403" },
    });

    await expect(
      fake.harness.callRpc("markReady", { environmentId: "env-1" }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "gh pr ready failed: HTTP 403",
    });
    await expect(
      fake.harness.runCli(["ready", "env-1"]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("gh pr ready failed: HTTP 403"),
    });
  });

  it.each([
    [["status-changed"], "refresh"],
    [["environment-created"], "refresh"],
    [["environment-deleted"], "refresh"],
    [["metadata-changed"], "branch"],
    [["git-refs-changed", "metadata-changed"], "branch"],
    [["git-refs-changed"], "invalidate"],
    [["work-status-changed"], null],
    [["thread-storage-changed", "diff-viewed-changed"], null],
  ] as const)(
    "maps environment changes %j to %s, re-checking only where main did",
    (changes, effect) => {
      expect(environmentChangeEffect(changes)).toBe(effect);
    },
  );
});
