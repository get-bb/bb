import type {
  PluginEnvironmentProviderCreateContext,
  PluginEnvironmentProviderProgress,
} from "@get-bb/plugin-sdk/environment-provider";
import {
  createFakePluginHost,
  makeHostResponse,
  makeThreadResponse,
  type FakePluginHarness,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { worktreeHostContract } from "./contract.js";
import { GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";
import plugin, { worktreeInputsSchema } from "./server.js";

type Project = PluginEnvironmentProviderCreateContext["project"];
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
      };
    }
    if (call.method === "remove") return { status: "removed" };
    throw new Error(`unexpected host method ${call.method}`);
  },
) {
  const { bb, harness } = createFakePluginHost({
    experimental_callHostRpc: callHost,
  });
  await plugin(bb);
  const provider = harness.registrations.environmentProviders.get(
    GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
  );
  if (provider === undefined) throw new Error("Provider not registered");
  const steps: string[] = [];
  const logs: string[] = [];
  const report: PluginEnvironmentProviderProgress = {
    step: (text) => steps.push(text),
    log: (text) => logs.push(text),
  };
  const signal = new AbortController().signal;
  const context: PluginEnvironmentProviderCreateContext = {
    thread: makeThreadResponse({ id: THREAD_ID, projectId: PROJECT_ID }),
    project: PROJECT,
    host: PROVISION_HOST,
    projectCheckout: { experimental_ownsPath: false, path: SOURCE_PATH },
    gitRemote: null,
    inputs: { branch: { kind: "default" } },
    suggestedBranchName: "bb/test",
    attempt: 1,
    pathKey: THREAD_ID,
    rebuild: false,
    experimental_claimPath: async () => true,
    previous: null,
    report,
    signal,
  };
  return { context, harness, logs, provider, report, signal, steps };
}

describe("worktree resource operations", () => {
  it("defaults omitted inputs and uses per-attempt path keys", async () => {
    expect(worktreeInputsSchema.parse({})).toEqual({
      branch: { kind: "default" },
    });
    const { provider } = await setup();
    expect(provider.policy.pathKeys).toBe("per-attempt");
  });

  it("runs one long host create and returns its path and base branch", async () => {
    const fixture = await setup();
    expect(await fixture.provider.create(fixture.context)).toEqual({
      status: "created",
      path: WORKTREE_PATH,
      ownsPath: true,
      mergeBaseBranch: "main",
    });
    expect(fixture.harness.experimental_hostRpcCalls[0]).toMatchObject({
      method: "create",
      hostId: HOST_ID,
      input: {
        operationId: `create#${THREAD_ID}#1`,
        branchName: "bb/test",
        pathKey: THREAD_ID,
        baseBranch: { kind: "default" },
        branchMode: "reset",
      },
      signal: fixture.signal,
    });
  });

  it("passes a named base and reuses the branch during rebuild", async () => {
    const fixture = await setup();
    await fixture.provider.create({
      ...fixture.context,
      inputs: { branch: { kind: "named", name: "release" } },
      rebuild: true,
      pathKey: "replacement",
      attempt: 2,
    });
    expect(fixture.harness.experimental_hostRpcCalls[0]?.input).toMatchObject({
      baseBranch: { kind: "named", name: "release" },
      branchMode: "reuse-existing",
      pathKey: "replacement",
    });
  });

  it("rebuilds the previous environment branch after the thread is renamed", async () => {
    const fixture = await setup();
    await fixture.provider.create({
      ...fixture.context,
      suggestedBranchName: "bb/renamed-thread",
      rebuild: true,
      previous: {
        environment: {
          id: "env-retired",
          name: null,
          projectId: PROJECT_ID,
          hostId: HOST_ID,
          path: WORKTREE_PATH,
          isGitRepo: true,
          isWorktree: true,
          branchName: "bb/original-thread",
          baseBranch: "main",
          defaultBranch: "main",
          mergeBaseBranch: "main",
          status: "destroyed",
          environmentProviderId: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
          lifecycle: {
            phase: "destroyed",
            retireAt: null,
            teardown: { status: "removed", attempt: 1 },
          },
          hostLifecycle: "active",
          environmentProviderSelection: null,
          environmentProviderInstanceKey: THREAD_ID,
          managed: true,
          workspaceProvisionType: "managed-worktree",
          createdAt: 1,
          updatedAt: 2,
        },
        resource: null,
      },
      pathKey: "replacement",
      attempt: 2,
    });
    expect(fixture.harness.experimental_hostRpcCalls[0]?.input).toMatchObject({
      branchName: "bb/original-thread",
      branchMode: "reuse-existing",
    });
  });

  it("forwards host progress while create is running", async () => {
    let finish: (value: unknown) => void = () => {};
    const fixture = await setup(
      () =>
        new Promise((resolve) => {
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
    finish({ status: "created", path: WORKTREE_PATH, baseBranch: null });
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
    });
  });
});

describe("adopting an existing worktree", () => {
  const EXISTING_PATH = "/code/bb-feature";

  async function setupAdoption(
    overrides: {
      resolve?: unknown;
      claim?: boolean;
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
    const claimed = vi.fn(async () => overrides.claim ?? true);
    return {
      ...fixture,
      claimed,
      context: {
        ...fixture.context,
        inputs: { kind: "existing" as const, path: EXISTING_PATH },
        experimental_claimPath: claimed,
      },
    };
  }

  it("attaches the existing path without taking ownership of it", async () => {
    const fixture = await setupAdoption();

    expect(
      fixture.provider.experimental_existingPath?.(fixture.context.inputs),
    ).toBe(EXISTING_PATH);
    expect(await fixture.provider.create(fixture.context)).toEqual({
      status: "created",
      path: EXISTING_PATH,
      ownsPath: false,
      resource: { adopted: true },
    });
    expect(fixture.claimed).toHaveBeenCalledWith(EXISTING_PATH);
    expect(fixture.harness.experimental_hostRpcCalls).toHaveLength(1);
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
    expect(fixture.claimed).not.toHaveBeenCalled();
  });

  it("refuses a path another environment already claimed", async () => {
    const fixture = await setupAdoption({ claim: false });

    const result = await fixture.provider.create(fixture.context);
    expect(result.status).toBe("failed");
    expect(result).toMatchObject({
      message: expect.stringContaining("already in use"),
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
      },
    );
    expect(
      worktreeInputsSchema.parse({ branch: { kind: "named", name: "main" } }),
    ).toEqual({ branch: { kind: "named", name: "main" } });
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
