import type { JsonValue } from "@get-bb/plugin-sdk";
import type {
  PluginEnvironmentProviderCreateContext,
  PluginEnvironmentProviderInputsSchema,
  PluginEnvironmentProviderProgress,
  PluginEnvironmentProviderRestoreContext,
} from "@get-bb/plugin-sdk/environment-provider";
import type { PluginEnvironmentProviderRequirements } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeHostResponse,
  type FakePluginHarness,
  type FakeSdkOverrides,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { worktreeHostContract } from "./contract.js";
import { GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";
import plugin, { worktreeInputsSchema } from "./server.js";

type CreateContext = PluginEnvironmentProviderCreateContext<
  PluginEnvironmentProviderRequirements,
  PluginEnvironmentProviderInputsSchema
>;
type RestoreContext = PluginEnvironmentProviderRestoreContext<
  PluginEnvironmentProviderRequirements,
  PluginEnvironmentProviderInputsSchema
>;
type Project = CreateContext["project"];
type HostRpcCall = FakePluginHarness["experimental_hostRpcCalls"][number];

const HOST_ID = "host-a";
const PROJECT_ID = "project-1";
const THREAD_ID = "thr_1";
const SOURCE_PATH = "/checkouts/bb";
const WORKTREE_PATH =
  "/data/plugins/environment-git-worktree/worktrees/thr_1/bb";

const PROVISION_HOST = makeHostResponse({ id: HOST_ID, name: "Fake machine" });

const PROJECT: Project = {
  id: PROJECT_ID,
  kind: "standard",
  name: "bb",
  gitRemoteUrl: null,
  createdAt: 1,
  updatedAt: 1,
};

async function setup(
  callHost: (call: HostRpcCall) => Promise<unknown> | unknown = (call) => {
    if (call.method === "create") {
      return {
        status: "created",
        path: WORKTREE_PATH,
        baseBranch: "main",
        ownsBranch:
          worktreeHostContract.create.input.parse(call.input).branchMode ===
          "reset",
      };
    }
    if (call.method === "nameBranch") return { status: "named" };
    if (call.method === "remove") return { status: "removed" };
    throw new Error(`unexpected host method ${call.method}`);
  },
  sdk: FakeSdkOverrides = {},
) {
  const { bb, harness } = createFakePluginHost({
    experimental_callHostRpc: callHost,
    sdk,
  });
  await plugin(bb);
  const provider = harness.registrations.environmentProviders.get(
    GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
  );
  if (provider === undefined) throw new Error("Provider not registered");
  if (provider.apiVersion !== 2) throw new Error("Expected version 2");
  const steps: string[] = [];
  const logs: string[] = [];
  const report: PluginEnvironmentProviderProgress = {
    step: (text) => steps.push(text),
    log: (text) => logs.push(text),
  };
  const signal = new AbortController().signal;
  const order: string[] = [];
  const context: CreateContext = {
    environment: { id: "env_1", name: null, projectId: PROJECT_ID },
    project: PROJECT,
    host: PROVISION_HOST,
    projectCheckout: { ownsPath: false, path: SOURCE_PATH },
    gitRemote: null,
    inputs: { branch: { kind: "default" }, folders: [] },
    branchName: async () => {
      order.push("branchName");
      return "bb/test";
    },
    setup: async (path) => {
      order.push(`setup ${path}`);
    },
    adopt: async (id) => {
      order.push(`adopt ${id}`);
    },
    attempt: 1,
    pathKey: THREAD_ID,
    report,
    signal,
  };
  const restore = provider.restore;
  if (restore === null) throw new Error("Provider cannot restore");
  return {
    context,
    harness,
    logs,
    order,
    provider,
    report,
    restore,
    signal,
    steps,
  };
}

function restoreContext(
  context: CreateContext,
  branchName: string | null,
): RestoreContext {
  return {
    ...context,
    pathKey: "replacement",
    attempt: 2,
    previous: {
      environment: {
        id: "env-retired",
        name: null,
        projectId: PROJECT_ID,
        hostId: HOST_ID,
        path: WORKTREE_PATH,
        additionalPaths: [],
        replacedProjectFolders: [],
        isGitRepo: true,
        isWorktree: true,
        branchName,
        baseBranch: "main",
        defaultBranch: "main",
        mergeBaseBranch: "main",
        status: "destroyed",
        environmentProviderId: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
        lifecycle: {
          phase: "destroyed",
          retireAt: null,
          teardown: { status: "removed", attempt: 1, needsRecovery: false },
        },
        hostLifecycle: "active",
        environmentProviderSelection: null,
        environmentProviderInstanceKey: THREAD_ID,
        managed: true,
        heldBy: null,
        statusMessage: null,
        workspaceProvisionType: "managed-worktree",
        createdAt: 1,
        updatedAt: 2,
      },
      resource: null,
    },
  };
}

describe("worktree resource operations", () => {
  it("defaults omitted inputs and uses per-attempt path keys", async () => {
    expect(worktreeInputsSchema.parse({})).toEqual({
      branch: { kind: "default" },
      folders: [],
    });
    const { provider } = await setup();
    expect(provider.policy.pathKeys).toBe("per-attempt");
  });

  it("creates a detached worktree, starts setup there, then names its branch", async () => {
    const fixture = await setup();
    expect(await fixture.provider.create(fixture.context)).toEqual({
      status: "created",
      path: WORKTREE_PATH,
      ownsPath: true,
      mergeBaseBranch: "main",
      resource: {
        ownedBranch: {
          name: "bb/test",
          repositoryPath: SOURCE_PATH,
          baseBranch: "main",
        },
        folderBranches: [],
      },
    });
    expect(fixture.harness.experimental_hostRpcCalls).toMatchObject([
      {
        method: "create",
        hostId: HOST_ID,
        input: {
          operationId: `create#${THREAD_ID}#1`,
          branchName: null,
          pathKey: THREAD_ID,
          baseBranch: { kind: "default" },
          branchMode: "reset",
        },
        signal: fixture.signal,
      },
      {
        method: "nameBranch",
        input: {
          operationId: `name#${THREAD_ID}#1`,
          path: WORKTREE_PATH,
          branchName: "bb/test",
        },
      },
    ]);
    expect(fixture.order).toEqual([`setup ${WORKTREE_PATH}`, "branchName"]);
  });

  it("removes the worktree and the branch it may have made when naming fails", async () => {
    const fixture = await setup((call) => {
      if (call.method === "create")
        return {
          status: "created",
          path: WORKTREE_PATH,
          baseBranch: "main",
          ownsBranch: false,
        };
      if (call.method === "nameBranch")
        return { status: "failed", message: "switch failed" };
      if (call.method === "remove") return { status: "removed" };
      throw new Error(`unexpected host method ${call.method}`);
    });
    expect(await fixture.provider.create(fixture.context)).toEqual({
      status: "failed",
      message: "switch failed",
    });
    expect(fixture.harness.experimental_hostRpcCalls.at(-1)).toMatchObject({
      method: "remove",
      input: {
        path: WORKTREE_PATH,
        ownedBranch: {
          name: "bb/test",
          repositoryPath: SOURCE_PATH,
          baseBranch: "main",
        },
      },
    });
  });

  it("restores on the destroyed environment's branch, keeping its commits", async () => {
    const fixture = await setup();
    const restored = await fixture.restore({
      ...restoreContext(fixture.context, "bb/original-thread"),
      inputs: { branch: { kind: "named", name: "release" }, folders: [] },
    });
    expect(restored).not.toHaveProperty("resource");
    expect(fixture.harness.experimental_hostRpcCalls[0]?.input).toMatchObject({
      branchName: "bb/original-thread",
      baseBranch: { kind: "named", name: "release" },
      branchMode: "reuse-existing",
      pathKey: "replacement",
    });
  });

  it("refuses to restore a worktree that had no branch checked out", async () => {
    const fixture = await setup();
    expect(
      await fixture.restore(restoreContext(fixture.context, null)),
    ).toMatchObject({
      status: "failed",
      message: expect.stringContaining("no branch"),
    });
    expect(fixture.harness.experimental_hostRpcCalls).toHaveLength(0);
  });

  it("forwards host progress while create is running", async () => {
    let finish: (value: unknown) => void = () => {};
    const fixture = await setup((call) =>
      call.method === "nameBranch"
        ? { status: "named" }
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const creating = fixture.provider.create(fixture.context);
    await vi.waitFor(() => {
      expect(fixture.harness.experimental_hostRpcCalls).toHaveLength(1);
    });
    await fixture.harness.experimental_emitHostSignal(HOST_ID, "progress", {
      operationId: `create#${THREAD_ID}#1`,
      type: "step",
      text: "Creating worktree",
      status: "started",
    });
    await fixture.harness.experimental_emitHostSignal(HOST_ID, "progress", {
      operationId: `create#${THREAD_ID}#1`,
      type: "output",
      text: "cloning",
      status: null,
    });
    expect(fixture.steps).toEqual(["Creating worktree"]);
    expect(fixture.logs).toEqual(["cloning"]);
    finish({
      status: "created",
      path: WORKTREE_PATH,
      baseBranch: null,
      ownsBranch: true,
    });
    await expect(creating).resolves.toMatchObject({ status: "created" });
  });

  it("returns terminal creation failures for host and transport errors", async () => {
    const failed = await setup(() => ({ status: "failed", message: "dirty" }));
    await expect(failed.provider.create(failed.context)).resolves.toEqual({
      status: "failed",

      message: "dirty",
    });
    const offline = await setup(() => {
      throw new Error("offline");
    });
    await expect(offline.provider.create(offline.context)).resolves.toEqual({
      status: "failed",

      message: "offline",
    });
  });

  it("removes by path key even when create never returned a path", async () => {
    const fixture = await setup();
    expect(
      await fixture.provider.remove({
        environment: null,
        hostId: HOST_ID,
        path: null,
        pathKey: THREAD_ID,
        resource: null,
        attempt: 1,
        report: fixture.report,
        signal: fixture.signal,
      }),
    ).toEqual({ status: "removed" });
    const call = fixture.harness.experimental_hostRpcCalls[0];
    expect(worktreeHostContract.remove.input.parse(call?.input)).toMatchObject({
      pathKey: THREAD_ID,
      path: null,
      ownedBranch: null,
    });
  });

  it("asks the host to delete only the branch recorded as its own", async () => {
    const fixture = await setup();
    const ownedBranch = {
      name: "bb/test",
      repositoryPath: SOURCE_PATH,
      baseBranch: "origin/main",
    };
    const resources: JsonValue[] = [
      { ownedBranch },
      null,
      { unexpected: true },
    ];
    for (const resource of resources) {
      await fixture.provider.remove({
        environment: null,
        hostId: HOST_ID,
        path: WORKTREE_PATH,
        pathKey: THREAD_ID,
        resource,
        attempt: 1,
        report: fixture.report,
        signal: fixture.signal,
      });
    }
    expect(
      fixture.harness.experimental_hostRpcCalls.map(
        (call) =>
          worktreeHostContract.remove.input.parse(call.input).ownedBranch,
      ),
    ).toEqual([ownedBranch, null, null]);
  });
});

describe("branching project folders", () => {
  const API = "/code/api";
  const API_WORKTREE =
    "/data/plugins/environment-git-worktree/worktrees/thr_1/api";
  const FOLDER_SDK: FakeSdkOverrides = {
    projects: {
      get: () => ({
        sources: [
          {
            id: "src_1",
            type: "local_path",
            hostId: HOST_ID,
            path: SOURCE_PATH,
          },
        ],
      }),
      sources: {
        experimental_folders: {
          list: () => [
            { id: "fld_1", projectSourceId: "src_1", path: API, createdAt: 1 },
            {
              id: "fld_2",
              projectSourceId: "src_1",
              path: "/code/web",
              createdAt: 1,
            },
          ],
        },
      },
    },
  };

  function folderHost(
    folders: (input: unknown) => unknown = () => ({
      status: "created",
      folders: [
        {
          sourcePath: API,
          path: API_WORKTREE,
          baseBranch: "origin/main",
          ownsBranch: false,
        },
      ],
    }),
  ) {
    return (call: HostRpcCall) => {
      if (call.method === "create")
        return {
          status: "created",
          path: WORKTREE_PATH,
          baseBranch: "main",
          ownsBranch: false,
        };
      if (call.method === "createFolders") return folders(call.input);
      if (call.method === "nameBranch") return { status: "named" };
      if (call.method === "remove") return { status: "removed" };
      throw new Error(`unexpected host method ${call.method}`);
    };
  }

  it("makes a worktree of each chosen folder before setup, names it on the thread's branch, and replaces the folder with it", async () => {
    const fixture = await setup(folderHost(), FOLDER_SDK);
    const context = {
      ...fixture.context,
      inputs: { branch: { kind: "default" }, folders: [`${API}/`] },
    };
    expect(await fixture.provider.validate?.(context)).toEqual({
      action: "accept",
    });
    const created = await fixture.provider.create(context);
    expect(created).toEqual({
      status: "created",
      path: WORKTREE_PATH,
      ownsPath: true,
      mergeBaseBranch: "main",
      additionalPaths: [API_WORKTREE],
      replacedProjectFolders: [API],
      resource: {
        ownedBranch: {
          name: "bb/test",
          repositoryPath: SOURCE_PATH,
          baseBranch: "main",
        },
        folderBranches: [
          { name: "bb/test", repositoryPath: API, baseBranch: "origin/main" },
        ],
      },
    });
    expect(
      fixture.harness.experimental_hostRpcCalls.map((call) => [
        call.method,
        call.input,
      ]),
    ).toMatchObject([
      ["create", { branchName: null }],
      [
        "createFolders",
        {
          sourcePath: SOURCE_PATH,
          path: WORKTREE_PATH,
          folders: [API],
          branchName: null,
          branchMode: "reset",
        },
      ],
      ["nameBranch", { path: WORKTREE_PATH, branchName: "bb/test" }],
      [
        "nameBranch",
        { sourcePath: API, path: API_WORKTREE, branchName: "bb/test" },
      ],
    ]);
    expect(fixture.order).toEqual([`setup ${WORKTREE_PATH}`, "branchName"]);

    await fixture.provider.remove({
      environment: null,
      hostId: HOST_ID,
      path: WORKTREE_PATH,
      pathKey: THREAD_ID,
      resource:
        created.status === "created" ? (created.resource ?? null) : null,
      attempt: 1,
      report: fixture.report,
      signal: fixture.signal,
    });
    expect(fixture.harness.experimental_hostRpcCalls.at(-1)).toMatchObject({
      method: "remove",
      input: {
        path: WORKTREE_PATH,
        folderBranches: [
          { name: "bb/test", repositoryPath: API, baseBranch: "origin/main" },
        ],
      },
    });
  });

  it("refuses a folder that is not one of the project's folders on the machine", async () => {
    const fixture = await setup(folderHost(), FOLDER_SDK);
    const context = {
      ...fixture.context,
      inputs: { branch: { kind: "default" }, folders: ["/code/other"] },
    };
    expect(await fixture.provider.validate?.(context)).toEqual({
      action: "refuse",
      message: expect.stringContaining(
        "/code/other is not one of this project's folders",
      ),
    });
    expect(await fixture.provider.create(context)).toMatchObject({
      status: "failed",
    });
    expect(fixture.harness.experimental_hostRpcCalls).toEqual([]);
  });

  it("restores without a folder that left the project, and clears the recorded folder lists", async () => {
    const fixture = await setup(folderHost(), FOLDER_SDK);
    const restored = await fixture.restore({
      ...restoreContext(fixture.context, "bb/original-thread"),
      inputs: { branch: { kind: "default" }, folders: ["/code/gone"] },
    });
    expect(restored).toMatchObject({
      status: "created",
      path: WORKTREE_PATH,
      additionalPaths: [],
      replacedProjectFolders: [],
    });
    expect(fixture.steps).toContain(
      "Skipped /code/gone: it is no longer one of this project's folders",
    );
    expect(
      fixture.harness.experimental_hostRpcCalls.map((call) => call.method),
    ).toEqual(["create"]);
  });

  it("fails the create and removes the main worktree when a folder worktree fails", async () => {
    const fixture = await setup(
      folderHost(() => ({
        status: "failed",
        message: "api is not a repository",
      })),
      FOLDER_SDK,
    );
    expect(
      await fixture.provider.create({
        ...fixture.context,
        inputs: { branch: { kind: "default" }, folders: [API] },
      }),
    ).toEqual({ status: "failed", message: "api is not a repository" });
    expect(fixture.harness.experimental_hostRpcCalls.at(-1)).toMatchObject({
      method: "remove",
      input: { path: WORKTREE_PATH, ownedBranch: null, folderBranches: [] },
    });
    expect(fixture.order).toEqual([]);
  });
});

describe("adopting an existing worktree", () => {
  const EXISTING_PATH = "/code/bb-feature";

  async function setupAdoption(
    overrides: {
      resolve?: unknown;
    } = {},
  ) {
    const fixture = await setup((call) => {
      if (call.method === "resolveExistingWorktree") {
        return (
          overrides.resolve ?? {
            status: "resolved",
            path: EXISTING_PATH,
            branch: "feature",
          }
        );
      }
      if (call.method === "remove") return { status: "removed" };
      throw new Error(`unexpected host method ${call.method}`);
    });
    return {
      ...fixture,
      context: {
        ...fixture.context,
        inputs: { kind: "existing" as const, path: EXISTING_PATH },
      },
    };
  }

  it("attaches the existing path without taking ownership of it", async () => {
    const fixture = await setupAdoption();

    expect(
      await fixture.provider.locate?.({
        host: fixture.context.host,
        projectCheckout: fixture.context.projectCheckout,
        inputs: fixture.context.inputs,
      }),
    ).toEqual({ path: EXISTING_PATH, reuse: true });
    expect(await fixture.provider.create(fixture.context)).toEqual({
      status: "created",
      path: EXISTING_PATH,
      ownsPath: false,
      resource: { adopted: true },
    });
    expect(fixture.harness.experimental_hostRpcCalls).toHaveLength(1);
    expect(fixture.harness.experimental_hostRpcCalls[0]?.method).toBe(
      "resolveExistingWorktree",
    );
  });

  it("restores by adopting the same existing path again", async () => {
    const fixture = await setupAdoption();

    expect(
      await fixture.restore({
        ...restoreContext(fixture.context, "feature"),
        inputs: fixture.context.inputs,
      }),
    ).toEqual({
      status: "created",
      path: EXISTING_PATH,
      ownsPath: false,
      resource: { adopted: true },
    });
    expect(fixture.harness.experimental_hostRpcCalls[0]?.method).toBe(
      "resolveExistingWorktree",
    );
  });

  it("refuses a path the host will not resolve", async () => {
    const fixture = await setupAdoption({
      resolve: { status: "failed", message: "not a worktree of this repo" },
    });

    expect(await fixture.provider.create(fixture.context)).toEqual({
      status: "failed",
      message: "not a worktree of this repo",
    });
  });

  it("never asks the host to delete a directory it adopted", async () => {
    const fixture = await setupAdoption();

    expect(
      await fixture.provider.remove({
        environment: null,
        hostId: HOST_ID,
        path: EXISTING_PATH,
        pathKey: THREAD_ID,
        resource: { adopted: true },
        attempt: 1,
        report: fixture.report,
        signal: fixture.signal,
      }),
    ).toEqual({ status: "removed" });
    expect(fixture.harness.experimental_hostRpcCalls).toHaveLength(0);
  });

  it("still deletes a worktree it created", async () => {
    const fixture = await setupAdoption();

    await fixture.provider.remove({
      environment: null,
      hostId: HOST_ID,
      path: WORKTREE_PATH,
      pathKey: THREAD_ID,
      resource: null,
      attempt: 1,
      report: fixture.report,
      signal: fixture.signal,
    });
    expect(fixture.harness.experimental_hostRpcCalls[0]?.method).toBe("remove");
  });

  it("keeps parsing inputs persisted before adoption existed", () => {
    expect(worktreeInputsSchema.parse({ branch: { kind: "default" } })).toEqual(
      {
        branch: { kind: "default" },
        folders: [],
      },
    );
    expect(
      worktreeInputsSchema.parse({ branch: { kind: "named", name: "main" } }),
    ).toEqual({ branch: { kind: "named", name: "main" }, folders: [] });
    expect(
      worktreeInputsSchema.parse({ kind: "existing", path: "/code/wt" }),
    ).toEqual({ kind: "existing", path: "/code/wt" });
  });
});

describe("default branch label routing", () => {
  it.each([
    { hostId: "host-b", expectedHost: "host-b", expectedPath: "/b" },
    { hostId: null, expectedHost: "host-a", expectedPath: "/a" },
    { hostId: "missing", expectedHost: null, expectedPath: null },
  ])(
    "uses the selected source for $hostId",
    async ({ hostId, expectedHost, expectedPath }) => {
      const { bb, harness } = createFakePluginHost({
        sdk: {
          projects: {
            get: () => ({
              sources: [
                {
                  type: "local_path",
                  hostId: "host-a",
                  path: "/a",
                  isDefault: true,
                },
                {
                  type: "local_path",
                  hostId: "host-b",
                  path: "/b",
                  isDefault: false,
                },
              ],
            }),
          },
        },
        experimental_callHostRpc: () => ({ branch: "origin/main" }),
      });
      await plugin(bb);
      expect(
        await harness.callRpc("defaultBaseBranch", {
          projectId: PROJECT_ID,
          hostId,
        }),
      ).toEqual({ branch: expectedHost === null ? null : "origin/main" });
      if (expectedHost === null) {
        expect(harness.experimental_hostRpcCalls).toHaveLength(0);
      } else {
        expect(harness.experimental_hostRpcCalls).toHaveLength(1);
        expect(harness.experimental_hostRpcCalls[0]).toMatchObject({
          method: "defaultBaseBranch",
          hostId: expectedHost,
          input: { sourcePath: expectedPath },
        });
      }
    },
  );
});
