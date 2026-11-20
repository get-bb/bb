import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeHostResponse,
  type ExperimentalFakeHostRpcCall,
} from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GitHubPullRequestView,
  HostPullRequestLookup,
} from "./contract.js";
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
    outsideActivity: null,
    ...overrides,
  };
}

type ViewRead = {
  path: string;
  known: { url: string; branchName: string | null } | null;
  refresh: boolean;
};

function viewResults(
  call: ExperimentalFakeHostRpcCall,
  lookup: (read: ViewRead) => HostPullRequestLookup = () => ({
    outcome: "found",
    pullRequest: view(),
  }),
  oid: string | null = null,
  branchName: string | null = "bb/pr",
) {
  return (call.input as { reads: ViewRead[] }).reads.map((read) => ({
    lookup: lookup(read),
    refs: { oid, branchName },
  }));
}

async function setup(options: {
  environments?: Record<string, Environment>;
  host?: Parameters<typeof makeHostResponse>[0];
  callHost?: (call: ExperimentalFakeHostRpcCall) => unknown;
  subscribe?: BbPluginApi["sdk"]["subscribe"];
  threads?: Partial<BbPluginApi["sdk"]["threads"]>;
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
      ...(options.subscribe === undefined
        ? {}
        : { subscribe: options.subscribe }),
      ...(options.threads === undefined ? {} : { threads: options.threads }),
    },
    experimental_callHostRpc:
      options.callHost ??
      ((call) => (call.method === "views" ? viewResults(call) : { ok: true })),
  });
  plugin(fake.bb);
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

  it("rediscovers the branch instead of re-reading a settled link, so a newer PR replaces it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const merged = view({
      state: "MERGED",
      url: "https://github.com/acme/bb/pull/6",
      number: 6,
    });
    let branchPullRequest = merged;
    const fake = await setup({
      callHost: (call) =>
        viewResults(call, (read) => ({
          outcome: "found",
          pullRequest: read.known === null ? branchPullRequest : merged,
        })),
    });
    await fake.harness.runCli(["show", "env-1"]);
    branchPullRequest = view({ number: 8 });
    vi.setSystemTime(Date.now() + 11_000);

    await expect(
      fake.harness.runCli(["show", "env-1", "--json"]),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining('"number":8'),
    });
    expect(
      fake.harness.experimental_hostRpcCalls
        .filter((call) => call.method === "views")
        .map((call) => call.input),
    ).toEqual([
      { reads: [{ path: "/work/env-1", known: null, refresh: false }] },
      { reads: [{ path: "/work/env-1", known: null, refresh: false }] },
    ]);
  });

  it("re-reads a known PR in one host call and reloads on a ref event only when the upstream moved", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let changed: ((event: { id: string; changes: string[] }) => void) | null =
      null;
    let upstream = "oid-1";
    const fake = await setup({
      subscribe: (({ callback }: { callback: typeof changed }) => {
        changed = callback;
        return () => {};
      }) as never,
      callHost: (call) =>
        call.method === "upstream"
          ? { oid: upstream, branchName: "bb/pr" }
          : viewResults(call, undefined, "oid-1"),
    });
    const methods = () =>
      fake.harness.experimental_hostRpcCalls.map((call) => call.method);
    const stop = fake.harness.experimental_watchRpc("pullRequests", {
      key: "env-1",
    });
    await vi.waitFor(() => expect(methods()).toEqual(["views"]));
    vi.setSystemTime(Date.now() + 11_000);
    await fake.harness.runCli(["show", "env-1"]);

    changed!({ id: "env-1", changes: ["git-refs-changed"] });
    await vi.waitFor(() => expect(methods()).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(methods()).toHaveLength(3);
    upstream = "oid-2";
    changed!({ id: "env-1", changes: ["git-refs-changed"] });
    await vi.waitFor(() => expect(methods()).toHaveLength(5));
    stop();

    expect(methods()).toEqual([
      "views",
      "views",
      "upstream",
      "upstream",
      "views",
    ]);
    expect(
      fake.harness.experimental_hostRpcCalls
        .filter((call) => call.method === "views")
        .map((call) => call.input),
    ).toEqual([
      { reads: [{ path: "/work/env-1", known: null, refresh: false }] },
      ...Array.from({ length: 2 }, () => ({
        reads: [
          {
            path: "/work/env-1",
            known: { url: view().url, branchName: "bb/pr" },
            refresh: false,
          },
        ],
      })),
    ]);
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
        return viewResults(call);
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
            { path: "/work/env-1", known: null, refresh: false },
            { path: "/work/env-2", known: null, refresh: false },
          ],
        },
        hostId: "host-1",
      },
      {
        method: "views",
        input: {
          reads: [{ path: "/work/env-1", known: null, refresh: false }],
        },
        hostId: "host-2",
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
          { path: "/work/env-1", known: null, refresh: false },
          { path: "/work/env-2", known: null, refresh: false },
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
          url: "https://github.com/acme/bb/pull/7",
          action: { operation: "merge", method: "rebase" },
        },
        hostId: "host-1",
      },
    ]);
  });

  it("prechecks a known pull request by its URL and acts on that URL", async () => {
    const fake = await setup({});
    await fake.harness.callRpc("pullRequests", { keys: ["env-1"] });

    await fake.harness.callRpc("merge", {
      environmentId: "env-1",
      method: "squash",
    });

    const calls = fake.harness.experimental_hostRpcCalls;
    expect(
      calls.filter((call) => call.method === "views").map((call) => call.input),
    ).toEqual([
      { reads: [{ path: "/work/env-1", known: null, refresh: false }] },
      {
        reads: [
          {
            path: "/work/env-1",
            known: {
              url: "https://github.com/acme/bb/pull/7",
              branchName: "bb/pr",
            },
            refresh: true,
          },
        ],
      },
    ]);
    expect(calls.find((call) => call.method === "act")?.input).toEqual({
      path: "/work/env-1",
      url: "https://github.com/acme/bb/pull/7",
      action: { operation: "merge", method: "squash" },
    });
  });

  function workspaceHost(workspace: {
    branchName: string;
    byUrl: Record<string, GitHubPullRequestView>;
    byBranch: Record<string, GitHubPullRequestView>;
  }) {
    return (call: ExperimentalFakeHostRpcCall) =>
      call.method === "views"
        ? (call.input as { reads: ViewRead[] }).reads.map((read) => ({
            lookup: {
              outcome: "found",
              pullRequest:
                read.known !== null &&
                read.known.branchName === workspace.branchName
                  ? workspace.byUrl[read.known.url]
                  : workspace.byBranch[workspace.branchName],
            },
            refs: { oid: null, branchName: workspace.branchName },
          }))
        : call.method === "upstream"
          ? { oid: null, branchName: workspace.branchName }
          : { ok: true };
  }

  it("rediscovers the branch when the known pull request has closed, and acts on the newer one", async () => {
    const closedUrl = "https://github.com/acme/bb/pull/6";
    const workspace = {
      branchName: "bb/pr",
      byUrl: {
        [closedUrl]: view({ number: 6, url: closedUrl, state: "CLOSED" }),
      },
      byBranch: { "bb/pr": view({ number: 6, url: closedUrl }) },
    };
    const fake = await setup({ callHost: workspaceHost(workspace) });
    await fake.harness.callRpc("pullRequests", { keys: ["env-1"] });
    workspace.byBranch["bb/pr"] = view({
      number: 8,
      url: "https://github.com/acme/bb/pull/8",
    });

    await fake.harness.callRpc("merge", {
      environmentId: "env-1",
      method: "squash",
    });

    expect(
      fake.harness.experimental_hostRpcCalls.find(
        (call) => call.method === "act",
      )?.input,
    ).toMatchObject({ url: "https://github.com/acme/bb/pull/8" });
  });

  it("acts on the current branch's pull request when the known one belongs to another branch", async () => {
    const oldUrl = "https://github.com/acme/bb/pull/6";
    const oldPullRequest = view({
      number: 6,
      url: oldUrl,
      headRefName: "bb/old",
    });
    const workspace = {
      branchName: "bb/old",
      byUrl: { [oldUrl]: oldPullRequest },
      byBranch: { "bb/old": oldPullRequest, "bb/pr": view() },
    };
    const fake = await setup({ callHost: workspaceHost(workspace) });
    await fake.harness.callRpc("pullRequests", { keys: ["env-1"] });
    workspace.branchName = "bb/pr";
    await expect(
      fake.harness.callRpc("markReady", { environmentId: "env-1" }),
    ).rejects.toMatchObject({ message: "Pull request is not a draft" });

    await fake.harness.callRpc("merge", {
      environmentId: "env-1",
      method: "squash",
    });

    expect(
      fake.harness.experimental_hostRpcCalls.find(
        (call) => call.method === "act",
      )?.input,
    ).toMatchObject({ url: "https://github.com/acme/bb/pull/7" });
  });

  it("returns the gh failure as a refusal and the CLI prints it", async () => {
    const fake = await setup({
      callHost: (call) =>
        call.method === "views"
          ? viewResults(call, () => ({
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

  describe("pull request watch", () => {
    const THREAD = "thr-1";
    const failing = (startedAt: string) =>
      view({
        checks: [
          {
            name: "lint",
            status: "completed",
            conclusion: "failure",
            url: "https://github.com/acme/bb/actions/runs/5/job/51",
            startedAt,
          },
        ],
      });

    async function watchSetup(
      options: {
        host?: Parameters<typeof makeHostResponse>[0];
        lookup?: () => HostPullRequestLookup;
      } = {},
    ) {
      let current: HostPullRequestLookup = {
        outcome: "found",
        pullRequest: view(),
      };
      let branchName: string | null = "bb/pr";
      const sent: string[] = [];
      const updated: string[] = [];
      const sendResults: (() => unknown)[] = [];
      const textOf = (input: readonly { type: string; text?: string }[]) =>
        input.map((part) => part.text ?? "").join("");
      const send = vi.fn(
        async (input: {
          threadId: string;
          input: readonly { type: string; text?: string }[];
        }) => {
          expect(input.threadId).toBe(THREAD);
          const next = sendResults.shift();
          const result = next === undefined ? { delivery: "sent" } : next();
          sent.push(textOf(input.input));
          return result as never;
        },
      );
      const update = vi.fn(
        async (input: {
          queuedMessageId: string;
          expectedUpdatedAt: number;
          input: readonly { type: string; text?: string }[];
        }) => {
          updated.push(textOf(input.input));
          return {
            id: input.queuedMessageId,
            updatedAt: input.expectedUpdatedAt + 1,
          } as never;
        },
      );
      const fake = await setup({
        host: options.host,
        subscribe: (() => () => {}) as never,
        callHost: (call) =>
          viewResults(
            call,
            () => options.lookup?.() ?? current,
            null,
            branchName,
          ),
        threads: {
          get: (async ({ threadId }: { threadId: string }) => ({
            id: threadId,
            environmentId: "env-1",
          })) as never,
          send: send as never,
          queuedMessages: { update } as never,
        },
      });
      return {
        fake,
        sent,
        updated,
        sendResults,
        set(lookup: HostPullRequestLookup) {
          current = lookup;
        },
        branch(name: string | null) {
          branchName = name;
        },
        async poll() {
          await fake.harness.callRpc("refresh", { environmentId: "env-1" });
          await vi.waitFor(() => Promise.resolve());
          for (let index = 0; index < 5; index += 1)
            await new Promise((resolve) => setImmediate(resolve));
        },
        watching: () => fake.harness.callRpc("watching", { threadId: THREAD }),
      };
    }

    it("messages the thread once per failed check run and ends when the pull request merges", async () => {
      const watch = await watchSetup();
      const started = await watch.fake.harness.runCli(["watch"], {
        threadId: THREAD,
      });
      expect(started).toMatchObject({ exitCode: 0 });
      expect(started.stdout).toContain("Watching #7 for thread thr-1.");
      expect(started.stdout).toContain("End your turn now instead of polling.");

      watch.set({
        outcome: "found",
        pullRequest: failing("2026-11-20T00:01:00Z"),
      });
      await watch.poll();
      await watch.poll();
      expect(watch.sent).toHaveLength(1);
      expect(watch.sent[0]).toContain(
        "- Check failed: lint (https://github.com/acme/bb/actions/runs/5/job/51)",
      );
      expect(watch.sent[0]).toContain("`bb pull-request logs env-1`");

      watch.set({
        outcome: "found",
        pullRequest: view({ state: "MERGED" }),
      });
      await watch.poll();
      expect(watch.sent).toHaveLength(2);
      expect(watch.sent[1]).toContain("- The pull request was merged.");
      await expect(watch.watching()).resolves.toEqual({ watch: null });
      expect(
        watch.fake.bb.storage
          .database()
          .prepare("SELECT thread_id FROM watches")
          .all(),
      ).toEqual([]);
    });

    it("ends the watch with a message when the environment's branch no longer has the pull request", async () => {
      const watch = await watchSetup();
      await expect(
        watch.fake.harness.runCli(["watch"], { threadId: THREAD }),
      ).resolves.toMatchObject({ exitCode: 0 });
      watch.set({ outcome: "none" });
      await watch.poll();
      expect(watch.sent).toHaveLength(1);
      expect(watch.sent[0]).toContain(
        "The environment's branch no longer has pull request #7, so the watch ended.",
      );
      await expect(watch.watching()).resolves.toEqual({ watch: null });
    });

    it("keeps watching through a detached HEAD, such as during a rebase", async () => {
      const watch = await watchSetup();
      await expect(
        watch.fake.harness.runCli(["watch"], { threadId: THREAD }),
      ).resolves.toMatchObject({ exitCode: 0 });
      watch.branch(null);
      watch.set({ outcome: "none" });
      await watch.poll();
      expect(watch.sent).toEqual([]);
      await expect(watch.watching()).resolves.not.toEqual({ watch: null });
      await expect(
        watch.fake.harness.runCli(["watching"], { threadId: THREAD }),
      ).resolves.toMatchObject({
        exitCode: 0,
        stdout: expect.stringContaining("Watching #7"),
      });
    });

    it("adds news to the waiting queued message instead of queuing another", async () => {
      const watch = await watchSetup();
      await watch.fake.harness.runCli(["watch"], { threadId: THREAD });
      watch.sendResults.push(() => ({
        delivery: "queued",
        queuedMessage: { id: "queued-1", updatedAt: 10 },
      }));
      watch.set({
        outcome: "found",
        pullRequest: failing("2026-11-20T00:01:00Z"),
      });
      await watch.poll();
      watch.set({
        outcome: "found",
        pullRequest: view({ mergeable: "CONFLICTING" }),
      });
      await watch.poll();
      expect(watch.sent).toHaveLength(1);
      expect(watch.updated).toHaveLength(1);
      expect(watch.updated[0]).toContain("- Check failed: lint");
      expect(watch.updated[0]).toContain(
        "- The branch now conflicts with main.",
      );
    });

    it("reports the news again on the next read when a send fails", async () => {
      const watch = await watchSetup();
      await watch.fake.harness.runCli(["watch"], { threadId: THREAD });
      watch.sendResults.push(() => {
        throw Object.assign(new Error("Bad gateway"), { status: 502 });
      });
      watch.set({
        outcome: "found",
        pullRequest: failing("2026-11-20T00:01:00Z"),
      });
      await watch.poll();
      await watch.poll();
      expect(watch.sent).toHaveLength(1);
      expect(watch.sent[0]).toContain("- Check failed: lint");
    });

    it("refuses to watch when the branch has no pull request", async () => {
      const watch = await watchSetup({ lookup: () => ({ outcome: "none" }) });
      await expect(
        watch.fake.harness.runCli(["watch"], { threadId: THREAD }),
      ).resolves.toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining("No pull request found"),
      });
      await expect(watch.fake.harness.runCli(["watch"])).resolves.toMatchObject(
        {
          exitCode: 1,
          stderr: expect.stringContaining("Pass --thread"),
        },
      );
    });

    it("restores a watch after a reload and ends it when the thread is deleted", async () => {
      const watch = await watchSetup();
      await expect(
        watch.fake.harness.runCli(["watch"], { threadId: THREAD }),
      ).resolves.toMatchObject({ exitCode: 0 });
      const next = await watch.fake.harness.reload(plugin);
      next.harness.runService("pull-request-watches");
      await expect(
        next.harness.callRpc("watching", { threadId: THREAD }),
      ).resolves.toMatchObject({
        watch: { threadId: THREAD, environmentId: "env-1", number: 7 },
      });
      await next.harness.emitThreadEvent("thread.deleted", {
        thread: { id: THREAD } as never,
      });
      await expect(
        next.harness.callRpc("watching", { threadId: THREAD }),
      ).resolves.toEqual({ watch: null });
      await next.harness.dispose();
    });

    it("ends after 15 minutes of failed reads while the machine is connected, and waits while it is away", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const host: NonNullable<Parameters<typeof makeHostResponse>[0]> = {};
      const watch = await watchSetup({ host });
      await expect(
        watch.fake.harness.runCli(["watch"], { threadId: THREAD }),
      ).resolves.toMatchObject({ exitCode: 0 });
      watch.set({ outcome: "unavailable", message: "gh auth expired" });

      Object.assign(host, {
        status: "disconnected",
        lifecycle: {
          phase: "suspended",
          suspendedAt: 1,
          message: null,
          pendingLog: "",
          teardown: null,
        },
      });
      await watch.poll();
      vi.setSystemTime(Date.now() + 20 * 60_000);
      await watch.poll();
      expect(watch.sent).toEqual([]);
      await expect(watch.watching()).resolves.not.toEqual({ watch: null });

      delete host.status;
      delete host.lifecycle;
      await watch.poll();
      vi.setSystemTime(Date.now() + 14 * 60_000);
      await watch.poll();
      expect(watch.sent).toEqual([]);
      vi.setSystemTime(Date.now() + 60_000);
      await watch.poll();
      expect(watch.sent).toHaveLength(1);
      expect(watch.sent[0]).toContain(
        "bb could not read this pull request for 15 minutes, so the watch ended: gh auth expired",
      );
      await expect(watch.watching()).resolves.toEqual({ watch: null });
    });

    it("prints failing check logs and re-runs checks on the environment's machine", async () => {
      const fake = await setup({
        callHost: (call) => {
          switch (call.method) {
            case "views":
              return viewResults(call, () => ({
                outcome: "found",
                pullRequest: failing("2026-11-20T00:01:00Z"),
              }));
            case "checkLogs":
              return {
                ok: true,
                checks: [
                  {
                    name: "lint",
                    url: "https://github.com/acme/bb/actions/runs/5/job/51",
                    log: "##[error]boom",
                    note: null,
                  },
                ],
              };
            default:
              return { ok: true, message: "Re-running lint" };
          }
        },
      });
      await expect(
        fake.harness.runCli(["logs", "env-1", "--lines", "20"]),
      ).resolves.toMatchObject({
        exitCode: 0,
        stdout:
          "== lint (https://github.com/acme/bb/actions/runs/5/job/51)\n##[error]boom",
      });
      await expect(
        fake.harness.runCli(["rerun", "env-1", "--check", "lint"]),
      ).resolves.toMatchObject({ exitCode: 0, stdout: "Re-running lint" });
      const calls = fake.harness.experimental_hostRpcCalls.filter(
        (call) => call.method !== "views",
      );
      expect(calls.map((call) => [call.method, call.input])).toEqual([
        [
          "checkLogs",
          {
            path: "/work/env-1",
            url: "https://github.com/acme/bb/pull/7",
            check: null,
            lines: 20,
          },
        ],
        [
          "rerunChecks",
          {
            path: "/work/env-1",
            url: "https://github.com/acme/bb/pull/7",
            check: "lint",
          },
        ],
      ]);
    });
  });

  it.each([
    [["status-changed"], "refresh"],
    [["environment-created"], "refresh"],
    [["environment-deleted"], "refresh"],
    [["metadata-changed"], "branch"],
    [["git-refs-changed", "metadata-changed"], "branch"],
    [["git-refs-changed"], "invalidate"],
    [["git-branches-changed"], null],
    [["work-status-changed"], null],
  ] as const)(
    "maps environment changes %j to %s, re-checking only where main did",
    (changes, effect) => {
      expect(environmentChangeEffect(changes)).toBe(effect);
    },
  );
});
