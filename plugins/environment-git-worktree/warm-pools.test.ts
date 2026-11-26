import type {
  JsonValue,
  PluginEnvironmentProviderRequirements,
} from "@get-bb/plugin-sdk";
import type {
  PluginEnvironmentProviderCreateContext,
  PluginEnvironmentProviderInputsSchema,
} from "@get-bb/plugin-sdk/environment-provider";
import {
  createFakePluginHost,
  makeHostResponse,
  type ExperimentalFakeHostRpcCall,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";
import plugin from "./server.js";
import { warmPoolStatusSchema } from "./warm-pools.js";

type CreateContext = PluginEnvironmentProviderCreateContext<
  PluginEnvironmentProviderRequirements,
  PluginEnvironmentProviderInputsSchema
>;

const PLUGIN_ID = "environment-git-worktree";
const PROJECT_ID = "proj_1";
const HOST_ID = "host_1";
const SOURCE_PATH = "/checkouts/bb";

interface Member {
  id: string;
  status: "creating" | "provisioning" | "ready" | "error";
  path: string | null;
  branchName: string | null;
  createdAt: number;
  statusMessage?: string | null;
  additionalPaths?: { path: string; replaces: string | null }[];
}

function environment(member: Member) {
  return {
    id: member.id,
    name: null,
    projectId: PROJECT_ID,
    hostId: HOST_ID,
    path: member.path,
    additionalPaths: member.additionalPaths ?? [],
    status: member.status,
    statusMessage: member.statusMessage ?? null,
    branchName: member.branchName,
    heldBy: `plugin:${PLUGIN_ID}`,
    environmentProviderId: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
    lifecycle: { phase: "active", retireAt: null, teardown: null },
    createdAt: member.createdAt,
  };
}

async function setup(args: {
  members: Member[];
  size?: number;
  folders?: string[];
  check?: (
    call: ExperimentalFakeHostRpcCall,
  ) =>
    | { status: "usable"; head: string }
    | { status: "refused"; reason: string }
    | { status: "busy" }
    | { status: "timed-out" };
  remoteBase?: { ref: string; commit: string; offline: boolean } | null;
  baseCommit?: string;
  offBase?: string[];
  branches?: Record<string, string>;
  restore?: (call: ExperimentalFakeHostRpcCall) => unknown;
  heldBy?: Record<string, string>;
  projectLookups?: (call: number) => void;
  refuseAdopt?: string[];
  refresh?: () =>
    | { status: "no-repository" }
    | Promise<{ status: "no-repository" }>
    | undefined;
}) {
  const hostCalls: ExperimentalFakeHostRpcCall[] = [];
  const order: string[] = [];
  let remoteReads = 0;
  const created: unknown[] = [];
  const deleted: string[] = [];
  const members = [...args.members];
  let projectLookups = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: PLUGIN_ID,
    experimental_callHostRpc: async (call) => {
      hostCalls.push(call);
      order.push(`host:${call.method}`);
      if (call.method === "claimPoolMember") {
        const input = call.input as {
          base: { ref: string; commit: string; offline: boolean } | null;
        };
        let base = input.base;
        if (base === null) {
          remoteReads += 1;
          base =
            args.remoteBase === undefined
              ? { ref: "origin/main", commit: "base", offline: false }
              : args.remoteBase;
        }
        if (base === null) return { status: "no-base" };
        const checked = args.check?.(call) ?? {
          status: "usable",
          head: "base",
        };
        return checked.status === "timed-out" ? checked : { ...checked, base };
      }
      if (call.method === "nameHandedOffBranch") return null;
      if (call.method === "refreshPoolBase") {
        const refresh = args.refresh?.();
        if (refresh !== undefined) return refresh;
        const input = call.input as { memberPaths: string[] };
        return {
          status: "refreshed",
          ref: "origin/main",
          commit: args.baseCommit ?? "base",
          members: input.memberPaths.map((path) => ({
            path,
            head: args.offBase?.includes(path) ? "diverged" : "base",
            onBase: !(args.offBase?.includes(path) ?? false),
            branch:
              args.branches?.[path] ??
              members.find(
                (member) =>
                  member.path === path ||
                  (member.additionalPaths ?? []).some(
                    (entry) => entry.path === path,
                  ),
              )?.branchName ??
              null,
          })),
        };
      }
      if (call.method === "restorePoolMember")
        return args.restore?.(call) ?? { status: "restored" };
      if (call.method === "create")
        return {
          status: "created",
          path: "/worktrees/cold/bb",
          baseBranch: "origin/main",
          ownsBranch: true,
        };
      if (call.method === "nameBranch") return { status: "named" };
      if (call.method === "createFolders")
        return {
          status: "created",
          folders: [
            {
              sourcePath: "/code/api",
              path: "/worktrees/env_warm-1/api",
              baseBranch: "origin/main",
              ownsBranch: false,
            },
          ],
        };
      throw new Error(`Unexpected host call ${call.method}`);
    },
    sdk: {
      environments: {
        get: ({ environmentId }) => {
          const member = members.find((entry) => entry.id === environmentId);
          return member === undefined
            ? {
                id: environmentId,
                heldBy: args.heldBy?.[environmentId] ?? null,
              }
            : environment(member);
        },
        list: (filter) =>
          members
            .filter(
              (member) =>
                (filter?.projectId === undefined ||
                  filter.projectId === PROJECT_ID) &&
                !deleted.includes(member.id),
            )
            .map(environment),
        delete: ({ environmentId }) => {
          deleted.push(environmentId);
          return { progress: "in_progress" };
        },
        experimental_create: (input) => {
          created.push(input);
          const member: Member = {
            id: `env_new${created.length}`,
            status: "creating",
            path: null,
            branchName: null,
            createdAt: Date.now(),
          };
          members.push(member);
          return environment(member);
        },
      },
      projects: {
        get: () => {
          projectLookups += 1;
          args.projectLookups?.(projectLookups);
          return {
            id: PROJECT_ID,
            name: "bb",
            sources: [
              {
                id: "src_1",
                type: "local_path",
                hostId: HOST_ID,
                path: SOURCE_PATH,
                isDefault: true,
              },
            ],
          };
        },
        sources: {
          experimental_folders: {
            list: () => [
              {
                id: "fld_1",
                projectSourceId: "src_1",
                path: "/code/api",
                createdAt: 1,
              },
            ],
          },
        },
        list: () => [
          {
            id: PROJECT_ID,
            name: "bb",
            sources: [
              {
                type: "local_path",
                hostId: HOST_ID,
                path: SOURCE_PATH,
                isDefault: true,
              },
            ],
          },
        ],
      },
      hosts: {
        list: () => [{ id: HOST_ID, name: "Mac", status: "connected" }],
      },
    },
  });
  await bb.storage.kv.set("warm-pools", [
    {
      projectId: PROJECT_ID,
      size: args.size ?? 1,
      folders: args.folders === undefined ? {} : { [HOST_ID]: args.folders },
    },
  ]);
  await plugin(bb);
  const provider = harness.registrations.environmentProviders.get(
    GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
  );
  if (provider?.apiVersion !== 2) throw new Error("Expected version 2");
  const setups: string[] = [];
  const setupFolders: string[][] = [];
  const adopted: string[] = [];
  const adoptedResources: JsonValue[] = [];
  const steps: string[] = [];
  const context = (
    environmentId: string,
    branch: string | (() => Promise<string>),
  ): CreateContext => ({
    environment: { id: environmentId, name: null, projectId: PROJECT_ID },
    project: {
      id: PROJECT_ID,
      kind: "standard",
      name: "bb",
      gitRemoteUrl: null,
      createdAt: 1,
      updatedAt: 1,
    },
    host: makeHostResponse({ id: HOST_ID }),
    projectCheckout: { path: SOURCE_PATH, ownsPath: false },
    gitRemote: null,
    inputs: { branch: { kind: "default" }, folders: [] },
    branchName: typeof branch === "string" ? async () => branch : branch,
    setup: async (path, options) => {
      setups.push(path);
      setupFolders.push(options?.folders ?? []);
      order.push(`setup:${path}`);
    },
    adopt: async (id, resource) => {
      adopted.push(id);
      order.push(`adopt:${id}`);
      adoptedResources.push(resource);
      if (args.refuseAdopt?.includes(id))
        throw new Error(`Environment ${id} is not ready to hand over`);
    },
    attempt: 1,
    pathKey: environmentId,
    report: {
      step(text) {
        steps.push(text);
      },
      log() {},
    },
    signal: new AbortController().signal,
  });
  const resize = async (size: number) => {
    const before = harness.realtimeSignals.length;
    const status = await harness.callRpc("setWarmPoolSize", {
      projectId: PROJECT_ID,
      size,
    });
    await expect
      .poll(() =>
        harness.realtimeSignals
          .slice(before)
          .some((signal) => signal.channel === "warm-pools-changed"),
      )
      .toBe(true);
    return status;
  };
  const resizeHost = async (hostId: string, size: number | null) => {
    const before = harness.realtimeSignals.length;
    const status = await harness.callRpc("setWarmPoolHostSize", {
      projectId: PROJECT_ID,
      hostId,
      size,
    });
    await expect
      .poll(() =>
        harness.realtimeSignals
          .slice(before)
          .some((signal) => signal.channel === "warm-pools-changed"),
      )
      .toBe(true);
    return status as {
      pools: {
        size: number;
        checkouts: { size: number; hostSize: number | null }[];
      }[];
    };
  };
  return {
    bb,
    harness,
    resize,
    resizeHost,
    provider,
    context,
    hostCalls,
    order,
    remoteReads: () => remoteReads,
    steps,
    created,
    members,
    deleted,
    setups,
    setupFolders,
    adopted,
    adoptedResources,
  };
}

const READY: Member = {
  id: "env_warm",
  status: "ready",
  path: "/worktrees/env_warm-1/bb",
  branchName: "bb/env_warm",
  createdAt: Date.now() - 3_000,
};

describe("warm worktree handoff", () => {
  const ownedBranch = (name: string) => ({
    ownedBranch: {
      name,
      repositoryPath: SOURCE_PATH,
      baseBranch: "origin/main",
    },
    folderBranches: [],
  });

  function pendingTitle() {
    let settle: (name: string) => void = () => {};
    const title = () =>
      new Promise<string>((resolve) => {
        settle = resolve;
      });
    return { title, settle: (name: string) => settle(name) };
  }

  it("adopts a ready warm worktree on its placeholder, then renames it to the thread's branch", async () => {
    const fixture = await setup({ members: [READY] });
    const result = await fixture.provider.create(
      fixture.context("env_thread", "bb/fix-login-thr_1"),
    );
    expect(result).toEqual({
      status: "created",
      path: READY.path,
      ownsPath: true,
      mergeBaseBranch: "origin/main",
      resource: ownedBranch("bb/fix-login-thr_1"),
    });
    expect(fixture.adoptedResources).toEqual([ownedBranch("bb/env_warm")]);
    expect(fixture.order).toEqual([
      "host:claimPoolMember",
      `adopt:${READY.id}`,
      "host:nameHandedOffBranch",
    ]);
    expect(fixture.hostCalls[0]?.input).toEqual({
      sourcePath: SOURCE_PATH,
      path: READY.path,
      placeholder: "bb/env_warm",
      base: null,
      checkTimeoutMs: 15_000,
    });
    expect(fixture.hostCalls[0]?.timeoutMs).toBe(15 * 60 * 1000);
    expect(fixture.hostCalls[1]?.input).toEqual({
      path: READY.path,
      fromBranch: "bb/env_warm",
      toBranch: "bb/fix-login-thr_1",
    });
    expect(fixture.setups).toEqual([]);
    expect(fixture.steps).toEqual([
      "Using a warm worktree at origin/main (base)",
    ]);
    await fixture.harness.lifecycle.dispose();
  });

  const WARM_WITH_API: Member = {
    ...READY,
    additionalPaths: [
      { path: "/worktrees/env_warm-1/api", replaces: "/code/api" },
    ],
  };

  it("hands a warm worktree with its folder worktrees to a thread that branches the same folders, and renames every branch", async () => {
    const fixture = await setup({
      members: [WARM_WITH_API],
      folders: ["/code/api"],
    });
    const result = await fixture.provider.create({
      ...fixture.context("env_thread", "bb/fix-login-thr_1"),
      inputs: { branch: { kind: "default" }, folders: ["/code/api"] },
    });
    const apiBranch = (name: string) => ({
      name,
      repositoryPath: "/code/api",
      baseBranch: "origin/main",
    });
    expect(result).toEqual({
      status: "created",
      path: READY.path,
      ownsPath: true,
      mergeBaseBranch: "origin/main",
      additionalPaths: [
        { path: "/worktrees/env_warm-1/api", replaces: "/code/api" },
      ],
      resource: {
        ...ownedBranch("bb/fix-login-thr_1"),
        folderBranches: [apiBranch("bb/fix-login-thr_1")],
      },
    });
    expect(fixture.adoptedResources).toEqual([
      {
        ...ownedBranch(READY.branchName!),
        folderBranches: [apiBranch(READY.branchName!)],
      },
    ]);
    expect(fixture.order).toEqual([
      "host:claimPoolMember",
      "host:claimPoolMember",
      `adopt:${READY.id}`,
      "host:nameHandedOffBranch",
      "host:nameHandedOffBranch",
    ]);
    expect(fixture.hostCalls[1]?.input).toEqual({
      sourcePath: "/code/api",
      path: "/worktrees/env_warm-1/api",
      placeholder: READY.branchName,
      base: null,
      checkTimeoutMs: 15_000,
    });
    expect(
      fixture.hostCalls
        .filter((call) => call.method === "nameHandedOffBranch")
        .map((call) => call.input),
    ).toEqual([
      {
        path: READY.path,
        fromBranch: READY.branchName,
        toBranch: "bb/fix-login-thr_1",
      },
      {
        path: "/worktrees/env_warm-1/api",
        fromBranch: READY.branchName,
        toBranch: "bb/fix-login-thr_1",
      },
    ]);
    expect(fixture.setups).toEqual([]);
    await fixture.harness.lifecycle.dispose();
  });

  it("sets a folder worktree its claim moved forward up again before the main worktree", async () => {
    const fixture = await setup({
      members: [WARM_WITH_API],
      folders: ["/code/api"],
      check: (call) =>
        (call.input as { path: string }).path === "/worktrees/env_warm-1/api"
          ? { status: "usable", head: "0123456789abcdef" }
          : { status: "usable", head: "base" },
    });
    const result = await fixture.provider.create({
      ...fixture.context("env_thread", "bb/fix-login-thr_1"),
      inputs: { branch: { kind: "default" }, folders: ["/code/api"] },
    });
    expect(fixture.adopted).toEqual([READY.id]);
    expect(fixture.deleted).toEqual([]);
    expect(result).toMatchObject({ status: "created", path: READY.path });
    expect(fixture.hostCalls.map((call) => call.method)).toEqual([
      "claimPoolMember",
      "claimPoolMember",
      "nameHandedOffBranch",
      "nameHandedOffBranch",
    ]);
    expect(fixture.setups).toEqual([READY.path]);
    expect(fixture.setupFolders).toEqual([["/worktrees/env_warm-1/api"]]);
    expect(fixture.steps).toContain(
      "Moved the warm worktree of /code/api from 0123456 to base; its setup runs again",
    );
    await fixture.harness.lifecycle.dispose();
  });

  it.each([
    ["keeps the warm worktree when nothing in it moved", "base", []],
    [
      "deletes the warm worktree when its main worktree already moved",
      "0123456789abcdef",
      [READY.id],
    ],
  ])(
    "builds a fresh worktree when a folder worktree is busy, and %s",
    async (_case, mainHead, deleted) => {
      const fixture = await setup({
        members: [WARM_WITH_API],
        folders: ["/code/api"],
        check: (call) =>
          (call.input as { path: string }).path === "/worktrees/env_warm-1/api"
            ? { status: "busy" }
            : { status: "usable", head: mainHead },
      });
      const result = await fixture.provider.create({
        ...fixture.context("env_thread", "bb/fix-login-thr_1"),
        inputs: { branch: { kind: "default" }, folders: ["/code/api"] },
      });
      expect(result).toMatchObject({ path: "/worktrees/cold/bb" });
      expect(fixture.adopted).toEqual([]);
      expect(fixture.deleted).toEqual(deleted);
      await fixture.harness.lifecycle.dispose();
    },
  );

  it("hands a warm worktree only to a thread that branches exactly its folders", async () => {
    const withFolders = await setup({
      members: [WARM_WITH_API],
      folders: ["/code/api"],
    });
    await withFolders.provider.create(
      withFolders.context("env_thread", "bb/fix-login-thr_1"),
    );
    expect(withFolders.adopted).toEqual([]);
    await withFolders.harness.lifecycle.dispose();

    const without = await setup({ members: [READY] });
    const cold = await without.provider.create({
      ...without.context("env_thread", "bb/fix-login-thr_1"),
      inputs: { branch: { kind: "default" }, folders: ["/code/api"] },
    });
    expect(without.adopted).toEqual([]);
    expect(cold).toMatchObject({ path: "/worktrees/cold/bb" });
    expect(without.setupFolders).toEqual([["/worktrees/env_warm-1/api"]]);
    await without.harness.lifecycle.dispose();
  });

  it("reruns setup in a warm worktree the claim moved forward, before the title settles", async () => {
    const fixture = await setup({
      members: [READY],
      remoteBase: {
        ref: "origin/main",
        commit: "fedcba9876543210",
        offline: false,
      },
      check: () => ({ status: "usable", head: "0123456789abcdef" }),
    });
    const { title, settle } = pendingTitle();
    const creating = fixture.provider.create(
      fixture.context("env_thread", title),
    );
    await vi.waitFor(() =>
      expect(fixture.order).toEqual([
        "host:claimPoolMember",
        `adopt:${READY.id}`,
        `setup:${READY.path}`,
      ]),
    );
    settle("bb/behind-thr_b");
    expect(await creating).toMatchObject({
      status: "created",
      path: READY.path,
      resource: ownedBranch("bb/behind-thr_b"),
    });
    expect(fixture.order.at(-1)).toBe("host:nameHandedOffBranch");
    expect(fixture.steps).toEqual([
      "Moved the warm worktree from 0123456 to fedcba9; setup runs again",
      "Using a warm worktree at origin/main (fedcba9)",
    ]);
    expect(fixture.deleted).toEqual([]);
    await fixture.harness.lifecycle.dispose();
  });

  it("hands the warm worktree over while the title is pending, and names the branch once it settles", async () => {
    const fixture = await setup({ members: [READY] });
    const { title, settle } = pendingTitle();
    const creating = fixture.provider.create(
      fixture.context("env_thread", title),
    );
    await vi.waitFor(() => expect(fixture.adopted).toEqual([READY.id]));
    expect(fixture.remoteReads()).toBe(1);
    expect(
      fixture.hostCalls.some((call) => call.method === "nameHandedOffBranch"),
    ).toBe(false);
    settle("bb/titled-thr_t");
    expect(await creating).toMatchObject({ path: READY.path });
    expect(fixture.hostCalls.at(-1)?.input).toEqual({
      path: READY.path,
      fromBranch: "bb/env_warm",
      toBranch: "bb/titled-thr_t",
    });
    await fixture.harness.lifecycle.dispose();
  });

  it("keeps the warm worktree and builds a fresh one when the remote base cannot be read", async () => {
    const fixture = await setup({ members: [READY], remoteBase: null });
    const result = await fixture.provider.create(
      fixture.context("env_thread", "bb/unknown-thr_u"),
    );
    expect(result).toMatchObject({ path: "/worktrees/cold/bb" });
    expect(fixture.hostCalls.map((call) => call.method)).toEqual([
      "claimPoolMember",
      "create",
      "nameBranch",
    ]);
    expect(fixture.adopted).toEqual([]);
    expect(fixture.deleted).toEqual([]);
    await fixture.harness.lifecycle.dispose();
  });

  it("says a warm worktree may be out of date when the remote could not be reached", async () => {
    const fixture = await setup({
      members: [READY],
      remoteBase: {
        ref: "origin/main",
        commit: "0123456789abcdef",
        offline: true,
      },
      check: () => ({ status: "usable", head: "0123456789abcdef" }),
    });
    expect(
      await fixture.provider.create(
        fixture.context("env_thread", "bb/offline-thr_o"),
      ),
    ).toMatchObject({ path: READY.path });
    expect(fixture.steps).toEqual([
      "Using a warm worktree at the last fetched origin/main (0123456); it may be out of date",
    ]);
    await fixture.harness.lifecycle.dispose();
  });

  it.each([
    ["the user", "user"],
    ["a pool refill", `plugin:${PLUGIN_ID}`],
  ])(
    "gives a held environment created for %s a fresh worktree while the pool is on",
    async (_who, holder) => {
      const fixture = await setup({
        members: [READY],
        heldBy: { env_held: holder },
      });
      const result = await fixture.provider.create(
        fixture.context("env_held", "bb/env_held"),
      );
      expect(result).toMatchObject({ path: "/worktrees/cold/bb" });
      expect(fixture.hostCalls.map((call) => call.method)).toEqual([
        "create",
        "nameBranch",
      ]);
      expect(fixture.setups).toEqual(["/worktrees/cold/bb"]);
      expect(fixture.deleted).toEqual([]);
      await fixture.harness.lifecycle.dispose();
    },
  );

  it.each([
    ["the host lock is busy", () => ({ status: "busy" as const }), []],
    [
      "the host check runs out of time",
      () => ({ status: "timed-out" as const }),
      [],
    ],
    [
      "the claim times out",
      () => {
        throw new Error("Host RPC claimPoolMember timed out");
      },
      [READY.id],
    ],
  ])(
    "builds a fresh worktree at once when %s, without trying other members",
    async (_case, check, deleted) => {
      const second: Member = {
        ...READY,
        id: "env_second",
        path: "/worktrees/env_second-1/bb",
        branchName: "bb/env_second",
      };
      const fixture = await setup({ members: [READY, second], check });
      const result = await fixture.provider.create(
        fixture.context("env_thread", "bb/busy-thr_9"),
      );
      expect(result).toMatchObject({ path: "/worktrees/cold/bb" });
      expect(
        fixture.hostCalls.filter((call) => call.method === "claimPoolMember"),
      ).toHaveLength(1);
      expect(fixture.adopted).toEqual([]);
      expect(fixture.deleted).toEqual(deleted);
      await fixture.harness.lifecycle.dispose();
    },
  );

  it("deletes a warm worktree the host refuses and builds a fresh one", async () => {
    const fixture = await setup({
      members: [READY],
      check: () => ({ status: "refused", reason: "it is not on origin/main" }),
    });
    const result = await fixture.provider.create(
      fixture.context("env_thread", "bb/late-thr_2"),
    );
    expect(result).toMatchObject({ path: "/worktrees/cold/bb" });
    expect(fixture.deleted).toEqual([READY.id]);
    expect(fixture.hostCalls.map((call) => call.method)).toEqual([
      "claimPoolMember",
      "create",
      "nameBranch",
    ]);
    await fixture.harness.lifecycle.dispose();
  });

  it("gives another create the next member while a handed-over one waits for its title", async () => {
    const second: Member = {
      ...READY,
      id: "env_second",
      path: "/worktrees/env_second-1/bb",
      branchName: "bb/env_second",
    };
    const fixture = await setup({ members: [READY, second], size: 2 });
    const { title, settle } = pendingTitle();
    const waiting = fixture.provider.create(fixture.context("env_slow", title));
    await vi.waitFor(() => expect(fixture.adopted).toEqual([READY.id]));
    const meanwhile = await fixture.provider.create(
      fixture.context("env_fast", "bb/fast-thr_f"),
    );
    expect(meanwhile).toMatchObject({
      path: second.path,
      resource: ownedBranch("bb/fast-thr_f"),
    });
    settle("bb/slow-thr_s");
    expect(await waiting).toMatchObject({
      path: READY.path,
      resource: ownedBranch("bb/slow-thr_s"),
    });
    expect(fixture.setups).toEqual([]);
    await fixture.harness.lifecycle.dispose();
  });

  it("leaves the branch alone and tries the next option when core refuses the adopt", async () => {
    const fixture = await setup({ members: [READY], refuseAdopt: [READY.id] });
    const result = await fixture.provider.create(
      fixture.context("env_thread", "bb/refused-thr_r"),
    );
    expect(result).toMatchObject({ path: "/worktrees/cold/bb" });
    expect(fixture.adopted).toEqual([READY.id]);
    expect(fixture.hostCalls.map((call) => call.method)).toEqual([
      "claimPoolMember",
      "create",
      "nameBranch",
    ]);
    expect(fixture.deleted).toEqual([]);
    await fixture.harness.lifecycle.dispose();
  });

  it("deletes a warm worktree the claim moved forward when core refuses the adopt", async () => {
    const fixture = await setup({
      members: [READY],
      refuseAdopt: [READY.id],
      check: () => ({ status: "usable", head: "behind" }),
    });
    const result = await fixture.provider.create(
      fixture.context("env_thread", "bb/refused-thr_m"),
    );
    expect(result).toMatchObject({ path: "/worktrees/cold/bb" });
    expect(fixture.adopted).toEqual([READY.id]);
    expect(fixture.deleted).toEqual([READY.id]);
    await fixture.harness.lifecycle.dispose();
  });

  it("passes the remote base the first claim read to the claim of the next member", async () => {
    const second: Member = {
      ...READY,
      id: "env_second",
      path: "/worktrees/env_second-1/bb",
      branchName: "bb/env_second",
      createdAt: READY.createdAt + 1,
    };
    const fixture = await setup({
      members: [READY, second],
      size: 2,
      check: (call) =>
        (call.input as { path: string }).path === READY.path
          ? { status: "refused", reason: "it is not on origin/main" }
          : { status: "usable", head: "base" },
    });
    expect(
      await fixture.provider.create(
        fixture.context("env_thread", "bb/next-thr_n"),
      ),
    ).toMatchObject({ path: second.path });
    expect(
      fixture.hostCalls
        .filter((call) => call.method === "claimPoolMember")
        .map((call) => (call.input as { base: unknown }).base),
    ).toEqual([null, { ref: "origin/main", commit: "base", offline: false }]);
    expect(fixture.remoteReads()).toBe(1);
    expect(fixture.deleted).toEqual([READY.id]);
    await fixture.harness.lifecycle.dispose();
  });

  it("gives one warm worktree to only one of two simultaneous creates", async () => {
    const fixture = await setup({ members: [READY] });
    const [first, second] = await Promise.all([
      fixture.provider.create(fixture.context("env_a", "bb/a-thr_a")),
      fixture.provider.create(fixture.context("env_b", "bb/b-thr_b")),
    ]);
    expect(
      [first, second]
        .map((result) => result.status === "created" && result.path)
        .sort(),
    ).toEqual(["/worktrees/cold/bb", READY.path].sort());
    expect(
      fixture.hostCalls.filter((call) => call.method === "claimPoolMember"),
    ).toHaveLength(1);
    await fixture.harness.lifecycle.dispose();
  });

  it("builds a fresh worktree when the warm worktrees cannot be listed", async () => {
    const fixture = await setup({ members: [READY] });
    fixture.harness.sdk.stub("environments.list", () => {
      throw new Error("server unavailable");
    });
    const result = await fixture.provider.create(
      fixture.context("env_thread", "bb/offline-thr_4"),
    );
    expect(result).toMatchObject({ path: "/worktrees/cold/bb" });
    await fixture.harness.lifecycle.dispose();
  });

  it("only builds fresh worktrees for named bases", async () => {
    const fixture = await setup({ members: [READY] });
    await fixture.provider.create({
      ...fixture.context("env_thread", "bb/named-thr_3"),
      inputs: { branch: { kind: "named", name: "release" }, folders: [] },
    });
    expect(fixture.hostCalls.map((call) => call.method)).toEqual([
      "create",
      "nameBranch",
    ]);
    await fixture.harness.lifecycle.dispose();
  });
});

describe("warm worktree reconcile", () => {
  it("saves a new size without waiting for the pool to check its remote", async () => {
    let finishRefresh: () => void = () => {};
    const fixture = await setup({
      members: [READY],
      refresh: () =>
        new Promise((resolve) => {
          finishRefresh = () => resolve({ status: "no-repository" });
        }),
    });
    const status = (await fixture.harness.callRpc("setWarmPoolSize", {
      projectId: PROJECT_ID,
      size: 3,
    })) as { pools: { size: number }[] };
    expect(status.pools[0]?.size).toBe(3);
    expect(
      fixture.hostCalls.some((call) => call.method === "refreshPoolBase"),
    ).toBe(true);
    finishRefresh();
    await fixture.harness.lifecycle.dispose();
  });

  it("keeps a project's members when its lookup fails for a reason other than 404", async () => {
    const fixture = await setup({
      members: [READY],
      projectLookups: (call) => {
        if (call > 1)
          throw Object.assign(new Error("service unavailable"), {
            status: 503,
          });
      },
    });
    await fixture.resize(1);
    expect(fixture.deleted).toEqual([]);
    await fixture.harness.lifecycle.dispose();
  });

  it.each([
    [
      "restores an unused member to its placeholder and keeps it",
      "restored",
      [],
    ],
    ["discards a member that was used on its new branch", "used", ["env_warm"]],
  ] as const)("%s", async (_case, outcome, deleted) => {
    const fixture = await setup({
      members: [READY],
      branches: { [READY.path!]: "bb/orphan-thr_1" },
      restore: () =>
        outcome === "used"
          ? { status: "used", branch: "bb/orphan-thr_1" }
          : { status: "restored" },
    });
    await fixture.resize(1);
    expect(
      fixture.hostCalls.find((call) => call.method === "restorePoolMember")
        ?.input,
    ).toEqual({
      sourcePath: SOURCE_PATH,
      path: READY.path,
      placeholder: "bb/env_warm",
    });
    expect(fixture.deleted).toEqual(deleted);
    await fixture.harness.lifecycle.dispose();
  });

  it("replaces members no longer on the fetched base and refills one at a time, held by the plugin", async () => {
    const second: Member = {
      ...READY,
      id: "env_stale",
      path: "/worktrees/env_stale-1/bb",
      branchName: "bb/env_stale",
      createdAt: Date.now() - 2_000,
    };
    const fixture = await setup({
      members: [READY, second],
      size: 2,
      offBase: [second.path!],
    });
    await fixture.resize(2);
    expect(fixture.deleted).toEqual(["env_stale"]);
    await expect
      .poll(() => fixture.created)
      .toEqual([
        {
          projectId: PROJECT_ID,
          hostId: HOST_ID,
          provider: {
            id: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
            inputs: { branch: { kind: "default" }, folders: [] },
          },
          hold: "plugin",
        },
      ]);
    await fixture.harness.lifecycle.dispose();
  });

  it("replaces members whose folders differ from the pool's or fell behind, and refills with the pool's folders", async () => {
    const api = (member: string) => ({
      path: `/worktrees/${member}-1/api`,
      replaces: "/code/api",
    });
    const current: Member = {
      ...READY,
      additionalPaths: [api("env_warm")],
    };
    const withoutFolders: Member = {
      ...READY,
      id: "env_plain",
      path: "/worktrees/env_plain-1/bb",
      branchName: "bb/env_plain",
      createdAt: Date.now() - 2_000,
    };
    const staleFolder: Member = {
      ...READY,
      id: "env_stale_api",
      path: "/worktrees/env_stale_api-1/bb",
      branchName: "bb/env_stale_api",
      createdAt: Date.now() - 1_000,
      additionalPaths: [api("env_stale_api")],
    };
    const fixture = await setup({
      members: [current, withoutFolders, staleFolder],
      size: 3,
      folders: ["/code/api"],
      offBase: [api("env_stale_api").path],
    });
    await fixture.resize(3);
    expect(fixture.deleted.sort()).toEqual(["env_plain", "env_stale_api"]);
    expect(
      fixture.hostCalls
        .filter(
          (call) =>
            call.method === "refreshPoolBase" &&
            (call.input as { sourcePath: string }).sourcePath === "/code/api",
        )
        .at(-1)?.input,
    ).toEqual({
      sourcePath: "/code/api",
      memberPaths: [api("env_warm").path, api("env_stale_api").path],
    });
    await expect
      .poll(() => fixture.created.at(0))
      .toMatchObject({
        provider: {
          inputs: { branch: { kind: "default" }, folders: ["/code/api"] },
        },
      });
    await fixture.harness.lifecycle.dispose();
  });

  it("keeps the folders a machine's warm worktrees branch, refusing ones that are not that machine's project folders", async () => {
    const fixture = await setup({ members: [READY] });
    const status = await fixture.harness.callRpc("setWarmPoolFolders", {
      projectId: PROJECT_ID,
      hostId: HOST_ID,
      folders: ["/code/api/"],
    });
    expect(
      warmPoolStatusSchema.parse(status).pools[0]?.checkouts[0]?.folders,
    ).toEqual(["/code/api"]);
    expect(await fixture.bb.storage.kv.get("warm-pools")).toEqual([
      {
        projectId: PROJECT_ID,
        size: 1,
        hosts: {},
        folders: { [HOST_ID]: ["/code/api"] },
      },
    ]);
    await expect(
      fixture.harness.callRpc("setWarmPoolFolders", {
        projectId: PROJECT_ID,
        hostId: HOST_ID,
        folders: ["/code/other"],
      }),
    ).rejects.toThrow("not one of this project's folders on machine host_1");
    await expect(
      fixture.harness.callRpc("setWarmPoolFolders", {
        projectId: PROJECT_ID,
        hostId: "host_other",
        folders: ["/code/api"],
      }),
    ).rejects.toThrow("has no checkout on machine host_other");
    await fixture.harness.lifecycle.dispose();
  });

  it("starts the next refill as soon as the previous member finishes setup", async () => {
    const fixture = await setup({ members: [], size: 2 });
    await expect.poll(() => fixture.created.length, { timeout: 8_000 }).toBe(1);
    const first = fixture.members.find((member) => member.id === "env_new1")!;
    first.status = "provisioning";
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(fixture.created).toHaveLength(1);
    Object.assign(first, {
      status: "ready",
      path: "/worktrees/env_new1-1/bb",
      branchName: "bb/env_new1",
    });
    await expect.poll(() => fixture.created.length, { timeout: 5_000 }).toBe(2);
    await fixture.harness.lifecycle.dispose();
  }, 20_000);

  it("shows why a pool cannot refresh, and clears it once a later check succeeds", async () => {
    let refresh: "missing" | "fails" | "works" = "missing";
    const fixture = await setup({
      members: [READY],
      refresh: () => {
        if (refresh === "fails") throw new Error("ENOENT: owner");
        return refresh === "missing" ? { status: "no-repository" } : undefined;
      },
    });
    const lastError = async () =>
      (
        (await fixture.harness.callRpc("warmPoolStatus", {})) as {
          pools: { checkouts: { lastError: string | null }[] }[];
        }
      ).pools[0]?.checkouts[0]?.lastError;
    const resize = () => fixture.resize(1);
    await resize();
    expect(await lastError()).toBe(
      `The project folder ${SOURCE_PATH} is missing or is not a git repository.`,
    );
    refresh = "fails";
    await resize();
    expect(await lastError()).toBe(
      "Could not check the default branch for updates, trying again in 2 minutes.",
    );
    refresh = "works";
    await resize();
    expect(await lastError()).toBeNull();
    await fixture.harness.lifecycle.dispose();
  });

  it("deletes failed members and every member once the pool is turned off", async () => {
    const failed: Member = {
      id: "env_failed",
      status: "error",
      path: "/worktrees/env_failed-1/bb",
      branchName: null,
      createdAt: Date.now() - 1_000,
      statusMessage: ".bb-env-setup.sh failed",
    };
    const fixture = await setup({ members: [READY, failed], size: 2 });
    await fixture.resize(2);
    expect(fixture.deleted).toEqual(["env_failed"]);
    const status = (await fixture.harness.callRpc("warmPoolStatus", {})) as {
      pools: { checkouts: { lastError: string | null }[] }[];
    };
    expect(status.pools[0]?.checkouts[0]?.lastError).toBe(
      "Setup failed in a warm worktree, trying again in 10 minutes: .bb-env-setup.sh failed",
    );
    await fixture.resize(0);
    expect(fixture.deleted).toEqual(["env_failed", READY.id]);
    await fixture.harness.lifecycle.dispose();
  });

  it("lets a machine turn off a project's pool, then follow the project again", async () => {
    const fixture = await setup({ members: [READY], size: 1 });
    const off = await fixture.resizeHost(HOST_ID, 0);
    expect(off.pools[0]?.size).toBe(1);
    expect(off.pools[0]?.checkouts[0]).toMatchObject({ size: 0, hostSize: 0 });
    expect(fixture.deleted).toEqual([READY.id]);
    expect(await fixture.bb.storage.kv.get("warm-pools")).toEqual([
      { projectId: PROJECT_ID, size: 1, hosts: { [HOST_ID]: 0 }, folders: {} },
    ]);
    expect(
      await fixture.provider.create(fixture.context("env_thread", "feature")),
    ).toMatchObject({ path: "/worktrees/cold/bb" });
    expect(fixture.adopted).toEqual([]);
    const following = await fixture.resizeHost(HOST_ID, null);
    expect(following.pools[0]?.checkouts[0]).toMatchObject({
      size: 1,
      hostSize: null,
    });
    await expect.poll(() => fixture.created.length).toBe(1);
    await fixture.harness.lifecycle.dispose();
  });

  it("keeps a machine's own pool while the project's count is off", async () => {
    const fixture = await setup({ members: [READY], size: 1 });
    await fixture.resizeHost(HOST_ID, 1);
    await fixture.resize(0);
    expect(fixture.deleted).toEqual([]);
    expect(
      await fixture.provider.create(fixture.context("env_thread", "feature")),
    ).toMatchObject({ path: READY.path });
    await fixture.harness.lifecycle.dispose();
  });

  it("refuses a machine count for a machine without a checkout of the project", async () => {
    const fixture = await setup({ members: [READY], size: 1 });
    await expect(
      fixture.harness.callRpc("setWarmPoolHostSize", {
        projectId: PROJECT_ID,
        hostId: "host_other",
        size: 2,
      }),
    ).rejects.toThrow("has no checkout on machine host_other");
    await fixture.harness.lifecycle.dispose();
  });
});
