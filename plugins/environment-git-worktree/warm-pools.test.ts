import type { PluginEnvironmentProviderRequirements } from "@get-bb/plugin-sdk";
import type {
  PluginEnvironmentProviderCreateContext,
  PluginEnvironmentProviderInputsSchema,
} from "@get-bb/plugin-sdk/environment-provider";
import {
  createFakePluginHost,
  makeHostResponse,
  type ExperimentalFakeHostRpcCall,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";
import plugin from "./server.js";

type CreateContext = PluginEnvironmentProviderCreateContext<
  PluginEnvironmentProviderRequirements,
  PluginEnvironmentProviderInputsSchema,
  2
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
}

function environment(member: Member) {
  return {
    id: member.id,
    name: null,
    projectId: PROJECT_ID,
    hostId: HOST_ID,
    path: member.path,
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
  handOff?: (
    call: ExperimentalFakeHostRpcCall,
  ) =>
    | { status: "handed-off"; baseBranch: string }
    | { status: "refused"; reason: string }
    | { status: "busy" };
  baseCommit?: string;
  heads?: Record<string, string>;
  branches?: Record<string, string>;
  restore?: (call: ExperimentalFakeHostRpcCall) => unknown;
  heldBy?: Record<string, string>;
  projectLookups?: (call: number) => void;
  refuseAdopt?: string[];
}) {
  const hostCalls: ExperimentalFakeHostRpcCall[] = [];
  const created: unknown[] = [];
  const deleted: string[] = [];
  const members = [...args.members];
  let projectLookups = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: PLUGIN_ID,
    experimental_callHostRpc: async (call) => {
      hostCalls.push(call);
      if (call.method === "handOff")
        return (
          args.handOff?.(call) ?? {
            status: "handed-off",
            baseBranch: "origin/main",
          }
        );
      if (call.method === "refreshPoolBase") {
        const input = call.input as { memberPaths: string[] };
        return {
          ref: "origin/main",
          commit: args.baseCommit ?? "base",
          members: input.memberPaths.map((path) => ({
            path,
            head: args.heads?.[path] ?? "base",
            branch:
              args.branches?.[path] ??
              members.find((member) => member.path === path)?.branchName ??
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
      throw new Error(`Unexpected host call ${call.method}`);
    },
    sdk: {
      environments: {
        get: ({ environmentId }) => ({
          id: environmentId,
          heldBy: args.heldBy?.[environmentId] ?? null,
        }),
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
          return environment({
            id: `env_new${created.length}`,
            status: "creating",
            path: null,
            branchName: null,
            createdAt: Date.now(),
          });
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
                type: "local_path",
                hostId: HOST_ID,
                path: SOURCE_PATH,
                isDefault: true,
              },
            ],
          };
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
    { projectId: PROJECT_ID, size: args.size ?? 1 },
  ]);
  await plugin(bb);
  const provider = harness.registrations.environmentProviders.get(
    GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
  );
  if (provider?.apiVersion !== 2) throw new Error("Expected version 2");
  const setups: string[] = [];
  const adopted: string[] = [];
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
    inputs: { branch: { kind: "default" } },
    branchName: typeof branch === "string" ? async () => branch : branch,
    setup: async (path) => {
      setups.push(path);
    },
    adopt: async (id) => {
      adopted.push(id);
      if (args.refuseAdopt?.includes(id))
        throw new Error(`Environment ${id} is not ready to hand over`);
    },
    attempt: 1,
    pathKey: environmentId,
    report: { step() {}, log() {} },
    signal: new AbortController().signal,
  });
  return {
    harness,
    provider,
    context,
    hostCalls,
    created,
    deleted,
    setups,
    adopted,
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
  it("hands a ready warm worktree to a default-base create on its new branch", async () => {
    const fixture = await setup({ members: [READY] });
    const result = await fixture.provider.create(
      fixture.context("env_thread", "bb/fix-login-thr_1"),
    );
    expect(result).toEqual({
      status: "created",
      path: READY.path,
      ownsPath: true,
      mergeBaseBranch: "origin/main",
      resource: {
        ownedBranch: {
          name: "bb/fix-login-thr_1",
          repositoryPath: SOURCE_PATH,
          baseBranch: "origin/main",
        },
      },
    });
    expect(fixture.hostCalls.map((call) => call.method)).toEqual(["handOff"]);
    expect(fixture.hostCalls[0]?.input).toEqual({
      sourcePath: SOURCE_PATH,
      path: READY.path,
      fromBranch: "bb/env_warm",
      toBranch: "bb/fix-login-thr_1",
    });
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
    ["the host lock is busy", () => ({ status: "busy" as const })],
    [
      "the handoff call times out",
      () => {
        throw new Error("Host RPC handOff timed out");
      },
    ],
  ])(
    "builds a fresh worktree at once when %s, without trying other members",
    async (_case, handOff) => {
      const second: Member = {
        ...READY,
        id: "env_second",
        path: "/worktrees/env_second-1/bb",
        branchName: "bb/env_second",
      };
      const fixture = await setup({ members: [READY, second], handOff });
      const result = await fixture.provider.create(
        fixture.context("env_thread", "bb/busy-thr_9"),
      );
      expect(result).toMatchObject({ path: "/worktrees/cold/bb" });
      expect(
        fixture.hostCalls.filter((call) => call.method === "handOff"),
      ).toHaveLength(1);
      expect(fixture.deleted).toEqual([]);
      await fixture.harness.lifecycle.dispose();
    },
  );

  it("deletes a warm worktree the host refuses and builds a fresh one", async () => {
    const fixture = await setup({
      members: [READY],
      handOff: () => ({
        status: "refused",
        reason: "it is behind origin/main",
      }),
    });
    const result = await fixture.provider.create(
      fixture.context("env_thread", "bb/late-thr_2"),
    );
    expect(result).toMatchObject({ path: "/worktrees/cold/bb" });
    expect(fixture.deleted).toEqual([READY.id]);
    expect(fixture.hostCalls.map((call) => call.method)).toEqual([
      "handOff",
      "create",
      "nameBranch",
    ]);
    await fixture.harness.lifecycle.dispose();
  });

  it("reserves a member, waits for the branch name outside the pool lock, and never runs setup", async () => {
    const second: Member = {
      ...READY,
      id: "env_second",
      path: "/worktrees/env_second-1/bb",
      branchName: "bb/env_second",
    };
    const fixture = await setup({ members: [READY, second], size: 2 });
    let nameBranch: (name: string) => void = () => {};
    const waiting = fixture.provider.create(
      fixture.context(
        "env_slow",
        () =>
          new Promise<string>((resolve) => {
            nameBranch = resolve;
          }),
      ),
    );
    const meanwhile = await fixture.provider.create(
      fixture.context("env_fast", "bb/fast-thr_f"),
    );
    expect(meanwhile).toMatchObject({ path: second.path });
    expect(fixture.hostCalls.map((call) => call.input)).toEqual([
      expect.objectContaining({ path: second.path, toBranch: "bb/fast-thr_f" }),
    ]);
    nameBranch("bb/slow-thr_s");
    expect(await waiting).toMatchObject({
      path: READY.path,
      resource: { ownedBranch: { name: "bb/slow-thr_s" } },
    });
    expect(fixture.hostCalls.map((call) => call.input)).toEqual([
      expect.objectContaining({ path: second.path }),
      expect.objectContaining({ path: READY.path, toBranch: "bb/slow-thr_s" }),
    ]);
    expect(fixture.setups).toEqual([]);
    await fixture.harness.lifecycle.dispose();
  });

  it("renames the branch only before an adopt core accepts, and renames it back when core refuses", async () => {
    const fixture = await setup({ members: [READY], refuseAdopt: [READY.id] });
    const result = await fixture.provider.create(
      fixture.context("env_thread", "bb/refused-thr_r"),
    );
    expect(result).toMatchObject({ path: "/worktrees/cold/bb" });
    expect(fixture.adopted).toEqual([READY.id]);
    expect(
      fixture.hostCalls.map((call) => [call.method, call.input]),
    ).toEqual([
      [
        "handOff",
        expect.objectContaining({
          path: READY.path,
          fromBranch: "bb/env_warm",
          toBranch: "bb/refused-thr_r",
        }),
      ],
      [
        "restorePoolMember",
        expect.objectContaining({
          path: READY.path,
          placeholder: "bb/env_warm",
        }),
      ],
      ["create", expect.objectContaining({ branchName: null })],
      ["nameBranch", expect.objectContaining({ branchName: "bb/refused-thr_r" })],
    ]);
    expect(fixture.deleted).toEqual([]);
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
      fixture.hostCalls.filter((call) => call.method === "handOff"),
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
      inputs: { branch: { kind: "named", name: "release" } },
    });
    expect(fixture.hostCalls.map((call) => call.method)).toEqual([
      "create",
      "nameBranch",
    ]);
    await fixture.harness.lifecycle.dispose();
  });
});

describe("warm worktree reconcile", () => {
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
    await fixture.harness.callRpc("setWarmPoolSize", {
      projectId: PROJECT_ID,
      size: 1,
    });
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
    await fixture.harness.callRpc("setWarmPoolSize", {
      projectId: PROJECT_ID,
      size: 1,
    });
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

  it("replaces members behind the fetched base and refills one at a time, held by the plugin", async () => {
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
      heads: { [second.path!]: "old" },
    });
    await fixture.harness.callRpc("setWarmPoolSize", {
      projectId: PROJECT_ID,
      size: 2,
    });
    expect(fixture.deleted).toEqual(["env_stale"]);
    await expect
      .poll(() => fixture.created)
      .toEqual([
        {
          projectId: PROJECT_ID,
          hostId: HOST_ID,
          provider: {
            id: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
            inputs: { branch: { kind: "default" } },
          },
          hold: "plugin",
        },
      ]);
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
    await fixture.harness.callRpc("setWarmPoolSize", {
      projectId: PROJECT_ID,
      size: 2,
    });
    expect(fixture.deleted).toEqual(["env_failed"]);
    const status = (await fixture.harness.callRpc("warmPoolStatus", {})) as {
      pools: { checkouts: { lastError: string | null }[] }[];
    };
    expect(status.pools[0]?.checkouts[0]?.lastError).toBe(
      ".bb-env-setup.sh failed",
    );
    await fixture.harness.callRpc("setWarmPoolSize", {
      projectId: PROJECT_ID,
      size: 0,
    });
    expect(fixture.deleted).toEqual(["env_failed", READY.id]);
    await fixture.harness.lifecycle.dispose();
  });
});
