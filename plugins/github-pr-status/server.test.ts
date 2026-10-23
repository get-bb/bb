import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeHostResponse,
  type ExperimentalFakeHostRpcCall,
} from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    headRefOid: null,
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
  const sdkCalls: string[] = [];
  const fake = createFakePluginHost({
    pluginId: "bb--github-pr-status",
    sdk: {
      environments: {
        get: async ({ environmentId }: { environmentId: string }) => {
          sdkCalls.push(`environments.get ${environmentId}`);
          const found = environments[environmentId];
          if (found === undefined) {
            throw Object.assign(new Error("Environment not found"), {
              status: 404,
            });
          }
          return found;
        },
      },
      hosts: {
        get: async () => {
          sdkCalls.push("hosts.get");
          return makeHostResponse(options.host);
        },
      },
    },
    experimental_callHostRpc:
      options.callHost ??
      ((call) =>
        call.method === "upstream"
          ? { oid: null, branchName: "bb/pr" }
          : call.method === "views"
            ? (call.input as { reads: unknown[] }).reads.map(() => ({
                outcome: "found",
                pullRequest: view(),
              }))
            : { ok: true }),
  });
  await plugin(fake.bb);
  return Object.assign(fake, { sdkCalls });
}

describe("GitHub PR Status server", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps identical snapshots unchanged across a real plugin database reload", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fake = await setup({});
    await fake.harness.callRpc("pullRequests", {
      keys: ["env-1"],
    });
    const next = await fake.harness.reload(plugin);
    const before = next.bb.storage
      .database()
      .prepare("SELECT total_changes() AS n")
      .get();
    vi.setSystemTime(Date.now() + 11_000);
    await next.harness.callRpc("pullRequests", {
      keys: ["env-1"],
    });
    expect(
      next.bb.storage.database().prepare("SELECT total_changes() AS n").get(),
    ).toEqual(before);
    await next.harness.dispose();
  });

  it.each([
    ["stale snapshot shape", JSON.stringify({ number: 7 })],
    ["malformed snapshot JSON", "{invalid"],
  ])("discards %s on reload and refetches", async (_, content) => {
    const fake = await setup({});
    await fake.harness.callRpc("pullRequests", {
      keys: ["env-1"],
    });
    fake.bb.storage
      .database()
      .prepare("UPDATE snapshots SET content = ?")
      .run(content);

    const next = await fake.harness.reload(plugin);
    expect(
      next.bb.storage.database().prepare("SELECT url FROM snapshots").all(),
    ).toEqual([]);
    await expect(
      next.harness.callRpc("pullRequests", { keys: ["env-1"] }),
    ).resolves.toMatchObject({
      "env-1": {
        outcome: "available",
        pullRequest: { number: 7, title: "Ship it" },
      },
    });
    expect(
      next.harness.experimental_hostRpcCalls.filter(
        (call) => call.method === "views",
      ),
    ).toHaveLength(1);
    await next.harness.dispose();
  });

  it("serves cached rows without looking up the environment or machine again", async () => {
    const fake = await setup({});
    await fake.harness.callRpc("pullRequests", { keys: ["env-1"] });
    fake.sdkCalls.length = 0;
    await expect(
      fake.harness.callRpc("pullRequests", { keys: ["env-1"] }),
    ).resolves.toMatchObject({
      "env-1": { outcome: "available", pullRequest: { number: 7 } },
    });
    expect(fake.sdkCalls).toEqual([]);
    expect(
      fake.harness.experimental_hostRpcCalls.filter(
        (call) => call.method === "views",
      ),
    ).toHaveLength(1);
  });

  it("reads every requested environment in one call and one batched host read", async () => {
    const fake = await setup({
      environments: {
        "env-1": environment(),
        "env-2": environment({ id: "env-2", path: "/work/env-2" }),
        "env-plain": environment({ id: "env-plain", isGitRepo: false }),
        "env-asleep": environment({ id: "env-asleep", hostId: "host-2" }),
      },
      callHost: (call) => {
        if (call.hostId === "host-2") throw new Error("Host is suspended");
        if (call.method === "upstream")
          return { oid: null, branchName: "bb/pr" };
        return (call.input as { reads: unknown[] }).reads.map(() => ({
          outcome: "found",
          pullRequest: view(),
        }));
      },
    });

    await expect(
      fake.harness.callRpc("pullRequests", {
        keys: ["env-1", "env-2", "env-plain", "env-asleep", "env-missing"],
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
      "env-2": {
        outcome: "available",
        pullRequest: expect.objectContaining({ number: 7 }),
      },
      "env-plain": { outcome: "absent" },
      "env-asleep": { outcome: "unavailable", message: "Host is suspended" },
      "env-missing": { outcome: "absent" },
    });
    expect(
      fake.harness.experimental_hostRpcCalls.filter(
        (call) => call.method === "views",
      ),
    ).toMatchObject([
      {
        method: "views",
        input: {
          reads: [
            { path: "/work/env-1", url: null, refresh: false },
            { path: "/work/env-2", url: null, refresh: false },
          ],
        },
        hostId: "host-1",
      },
    ]);
  });

  it("sends reads that start within a few milliseconds of each other in one batched host read", async () => {
    const fake = await setup({
      environments: {
        "env-1": environment(),
        "env-2": environment({ id: "env-2", path: "/work/env-2" }),
      },
    });
    await Promise.all([
      fake.harness.callRpc("pullRequests", { keys: ["env-1"] }),
      new Promise((resolve) => setTimeout(resolve, 5)).then(() =>
        fake.harness.callRpc("pullRequests", { keys: ["env-2"] }),
      ),
    ]);
    expect(
      fake.harness.experimental_hostRpcCalls
        .filter((call) => call.method === "views")
        .map((call) => call.input),
    ).toEqual([
      {
        reads: [
          { path: "/work/env-1", url: null, refresh: false },
          { path: "/work/env-2", url: null, refresh: false },
        ],
      },
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
        call.method === "upstream"
          ? { oid: null, branchName: "bb/pr" }
          : call.method === "upstream"
            ? { oid: null, branchName: "bb/pr" }
            : call.method === "views"
              ? (call.input as { reads: unknown[] }).reads.map(() => ({
                  outcome: "found",
                  pullRequest: view({ isDraft: true }),
                }))
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
