import type {
  PluginEnvironmentProviderCreateContext,
  PluginEnvironmentProviderRestoreContext,
  PluginEnvironmentProviderValidateContext,
} from "@get-bb/plugin-sdk/environment-provider";
import {
  createFakePluginHost,
  makeHostResponse,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";
import plugin from "./server.js";

type Environment =
  PluginEnvironmentProviderRestoreContext["previous"]["environment"];
type ThreadRow = { id: string; environmentId: string | null; status: string };

const HOST = makeHostResponse({ id: "host-a", name: "Fake machine" });
const PROJECT: PluginEnvironmentProviderCreateContext["project"] = {
  id: "project-1",
  kind: "standard",
  name: "bb",
  gitRemoteUrl: null,
  createdAt: 1,
  updatedAt: 1,
};
const CHECKOUT_PATH = "/checkouts/bb";

function environmentAt(path: string): Environment {
  return {
    id: "env_1",
    name: null,
    projectId: PROJECT.id,
    hostId: HOST.id,
    path,
    isGitRepo: true,
    branchName: "main",
    baseBranch: null,
    mergeBaseBranch: null,
    status: "ready",
    environmentProviderId: PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
    environmentProviderInstanceKey: null,
    environmentProviderSelection: null,
    createdAt: 1,
    updatedAt: 1,
  } as Environment;
}

async function validateWith(args: {
  environments: Environment[];
  threads: ThreadRow[];
  inputs: PluginEnvironmentProviderValidateContext["inputs"];
  inspectCheckout?: () => unknown;
}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "environment-project-checkout",
    experimental_callHostRpc: (call) => {
      if (call.method === "inspectCheckout" && args.inspectCheckout) {
        return args.inspectCheckout();
      }
      throw new Error(`unexpected host call ${call.method}`);
    },
    sdk: {
      environments: {
        list: (filters?: { hostId?: string; path?: string }) =>
          args.environments.filter(
            (row) =>
              (filters?.hostId === undefined ||
                row.hostId === filters.hostId) &&
              (filters?.path === undefined || row.path === filters.path),
          ),
      },
      threads: {
        list: (filters?: { environmentId?: string }) =>
          args.threads.filter(
            (row) =>
              filters?.environmentId === undefined ||
              row.environmentId === filters.environmentId,
          ),
      },
    },
  });
  await plugin(bb);
  const provider = harness.registrations.environmentProviders.get(
    PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
  );
  if (provider === undefined || provider.validate === null) {
    throw new Error("the checkout provider registered no validate");
  }
  return provider.validate({
    project: PROJECT,
    host: HOST,
    projectCheckout: { experimental_ownsPath: false, path: CHECKOUT_PATH },
    gitRemote: null,
    inputs: args.inputs,
  });
}

describe("checkout provider validate", () => {
  it("registers as Project checkout", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "environment-project-checkout",
    });
    await plugin(bb);

    expect(
      harness.registrations.environmentProviders.get(
        PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
      )?.displayName,
    ).toBe("Project checkout");
  });

  it("refuses a branch switch while another thread is live on the checkout", async () => {
    const decision = await validateWith({
      environments: [environmentAt(CHECKOUT_PATH)],
      threads: [{ id: "thr_other", environmentId: "env_1", status: "active" }],
      inputs: { branch: { kind: "existing", name: "release" } },
    });
    expect(decision).toEqual({
      action: "refuse",
      message:
        "Cannot checkout branch while another thread is using this workspace",
    });
  });

  it("accepts an attach without a branch switch even when the checkout is busy", async () => {
    const decision = await validateWith({
      environments: [environmentAt(CHECKOUT_PATH)],
      threads: [{ id: "thr_other", environmentId: "env_1", status: "active" }],
      inputs: {},
    });
    expect(decision).toEqual({ action: "accept" });
  });

  it("refuses a branch switch while another project's thread is idle on the checkout", async () => {
    const decision = await validateWith({
      environments: [environmentAt(CHECKOUT_PATH)],
      threads: [{ id: "thr_done", environmentId: "env_1", status: "idle" }],
      inputs: { branch: { kind: "new", baseBranch: "main" } },
    });
    expect(decision).toEqual({
      action: "refuse",
      message:
        "Cannot checkout branch while another thread is using this workspace",
    });
  });

  it("refuses a provider-owned directory and names the environment to reuse", async () => {
    const environment = {
      ...environmentAt(CHECKOUT_PATH),
      id: "env_worktree_42",
      environmentProviderId: "git-worktree",
    };
    const decision = await validateWith({
      environments: [environment],
      threads: [],
      inputs: { path: CHECKOUT_PATH },
    });

    expect(decision).toEqual({
      action: "refuse",
      message:
        "This directory belongs to environment env_worktree_42; reuse that environment instead.",
    });
  });

  it("refuses a branch switch while the checkout has uncommitted changes", async () => {
    const decision = await validateWith({
      environments: [],
      threads: [],
      inputs: { branch: { kind: "existing", name: "release" } },
      inspectCheckout: () => ({
        isGitRepo: true,
        checkout: { kind: "branch", branchName: "main", headSha: "abc123" },
        hasUncommittedChanges: true,
        operation: { kind: "none" },
      }),
    });
    expect(decision).toEqual({
      action: "refuse",
      message: "Checkout blocked by uncommitted changes",
    });
  });

  it("refuses a branch switch while HEAD is detached", async () => {
    const decision = await validateWith({
      environments: [],
      threads: [],
      inputs: { branch: { kind: "existing", name: "release" } },
      inspectCheckout: () => ({
        isGitRepo: true,
        checkout: { kind: "detached", headSha: "abc123" },
        hasUncommittedChanges: false,
        operation: { kind: "none" },
      }),
    });
    expect(decision).toEqual({
      action: "refuse",
      message: "Checkout blocked while HEAD is detached",
    });
  });

  it("refuses a branch switch during an in-progress rebase before reporting dirt", async () => {
    const decision = await validateWith({
      environments: [],
      threads: [],
      inputs: { branch: { kind: "existing", name: "release" } },
      inspectCheckout: () => ({
        isGitRepo: true,
        checkout: { kind: "branch", branchName: "main", headSha: "abc123" },
        hasUncommittedChanges: true,
        operation: { kind: "rebase", hasConflicts: false },
      }),
    });
    expect(decision).toEqual({
      action: "refuse",
      message: "Checkout blocked by an in-progress rebase",
    });
  });

  it("refuses a branch switch with unresolved conflicts", async () => {
    const decision = await validateWith({
      environments: [],
      threads: [],
      inputs: { branch: { kind: "existing", name: "release" } },
      inspectCheckout: () => ({
        isGitRepo: true,
        checkout: { kind: "branch", branchName: "main", headSha: "abc123" },
        hasUncommittedChanges: true,
        operation: { kind: "merge", hasConflicts: true },
      }),
    });
    expect(decision).toEqual({
      action: "refuse",
      message: "Checkout blocked by unresolved conflicts",
    });
  });

  it("accepts a dirty checkout when the branch is already the current one", async () => {
    const decision = await validateWith({
      environments: [],
      threads: [],
      inputs: { branch: { kind: "existing", name: "main" } },
      inspectCheckout: () => ({
        isGitRepo: true,
        checkout: { kind: "branch", branchName: "main", headSha: "abc123" },
        hasUncommittedChanges: true,
        operation: { kind: "none" },
      }),
    });
    expect(decision).toEqual({ action: "accept" });
  });

  it("accepts a branch switch when the checkout inspection call fails", async () => {
    const decision = await validateWith({
      environments: [],
      threads: [],
      inputs: { branch: { kind: "existing", name: "release" } },
      inspectCheckout: () => {
        throw new Error("machine is offline");
      },
    });
    expect(decision).toEqual({ action: "accept" });
  });

  it("checks the directory the inputs name rather than the project checkout", async () => {
    const decision = await validateWith({
      environments: [environmentAt("/elsewhere/bb")],
      threads: [
        { id: "thr_other", environmentId: "env_1", status: "starting" },
      ],
      inputs: {
        path: "/elsewhere/bb",
        branch: { kind: "existing", name: "release" },
      },
    });
    expect(decision.action).toBe("refuse");
  });
});

it.each([false, true])(
  "reports source ownership %s to core's hook policy",
  async (owned) => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "environment-project-checkout",
      experimental_callHostRpc: (call) => {
        if (call.method !== "attach") throw new Error("Unexpected host method");
        return { status: "attached", path: CHECKOUT_PATH, branchName: "main" };
      },
      sdk: { environments: { list: () => [] }, threads: { list: () => [] } },
    });
    try {
      await plugin(bb);
      const provider = harness.registrations.environmentProviders.get(
        PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
      );
      if (!provider) throw new Error("Missing provider");
      const result = await provider.create({
        project: PROJECT,
        host: HOST,
        projectCheckout: { path: CHECKOUT_PATH, experimental_ownsPath: owned },
        gitRemote: null,
        inputs: {},
        thread: makeThreadResponse(),
        suggestedBranchName: "bb/test",
        attempt: 1,
        pathKey: "fixture",
        experimental_claimPath: async () => true,
        report: { step() {}, log() {} },
        signal: new AbortController().signal,
      });
      expect(result).toMatchObject({
        status: "created",
        path: CHECKOUT_PATH,
        ownsPath: owned,
      });
    } finally {
      await harness.lifecycle.dispose();
    }
  },
);

it.each(["branch", "timeout", "abort"] as const)(
  "ends a blocked path claim on %s without attaching",
  async (mode) => {
    const hostCall = vi.fn(() => {
      throw new Error("Unexpected host call");
    });
    const { bb, harness } = createFakePluginHost({
      pluginId: "environment-project-checkout",
      experimental_callHostRpc: hostCall,
    });
    const controller = new AbortController();
    const claim = vi.fn(async () => false);
    try {
      await plugin(bb);
      const provider = harness.registrations.environmentProviders.get(
        PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
      );
      if (!provider) throw new Error("Missing provider");
      vi.useFakeTimers();
      const result = provider.create({
        project: PROJECT,
        host: HOST,
        projectCheckout: { path: CHECKOUT_PATH, experimental_ownsPath: false },
        gitRemote: null,
        inputs:
          mode === "branch"
            ? { branch: { kind: "existing", name: "release" } }
            : {},
        thread: makeThreadResponse(),
        suggestedBranchName: "bb/test",
        attempt: 1,
        pathKey: "blocked",
        experimental_claimPath: claim,
        report: { step() {}, log() {} },
        signal: controller.signal,
      });
      if (mode === "abort") {
        const assertion = expect(result).rejects.toThrow();
        controller.abort();
        await assertion;
      } else {
        if (mode === "timeout") {
          vi.setSystemTime(Date.now() + 15 * 60 * 1000);
          await vi.advanceTimersByTimeAsync(50);
        }
        await expect(result).resolves.toMatchObject({
          status: "failed",
          message: "Workspace is being prepared by another thread",
        });
      }
      expect(hostCall).not.toHaveBeenCalled();
      if (mode === "branch") expect(claim).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      await harness.lifecycle.dispose();
    }
  },
);

describe("checkout provider existing path", () => {
  it.each([
    [{ path: CHECKOUT_PATH }, CHECKOUT_PATH],
    [{}, null],
    [
      { path: CHECKOUT_PATH, branch: { kind: "new", baseBranch: "main" } },
      null,
    ],
    [{ path: CHECKOUT_PATH, branch: { kind: "existing", name: "main" } }, null],
  ] as const)(
    "reuses the recorded environment for %j: %s",
    async (inputs, expected) => {
      const { bb, harness } = createFakePluginHost({
        pluginId: "environment-project-checkout",
      });
      await plugin(bb);
      const provider = harness.registrations.environmentProviders.get(
        PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
      );
      expect(provider?.experimental_existingPath?.(inputs)).toBe(expected);
    },
  );
});

describe("restoring a destroyed checkout environment", () => {
  async function restoreWith(args: {
    inputs: PluginEnvironmentProviderRestoreContext["inputs"];
    branchName: string | null;
  }) {
    const attachCalls: unknown[] = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "environment-project-checkout",
      experimental_callHostRpc: (call) => {
        if (call.method !== "attach") throw new Error("Unexpected host method");
        attachCalls.push(call.input);
        return { status: "attached", path: CHECKOUT_PATH, branchName: null };
      },
      sdk: { environments: { list: () => [] }, threads: { list: () => [] } },
    });
    try {
      await plugin(bb);
      const provider = harness.registrations.environmentProviders.get(
        PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
      );
      const restore = provider?.restore;
      if (!restore) throw new Error("Missing restore");
      const result = await restore({
        project: PROJECT,
        host: HOST,
        projectCheckout: { path: CHECKOUT_PATH, experimental_ownsPath: false },
        gitRemote: null,
        inputs: args.inputs,
        thread: makeThreadResponse(),
        attempt: 2,
        pathKey: "restored",
        experimental_claimPath: async () => true,
        previous: {
          environment: {
            ...environmentAt(CHECKOUT_PATH),
            status: "destroyed",
            branchName: args.branchName,
          },
          resource: null,
        },
        report: { step() {}, log() {} },
        signal: new AbortController().signal,
      });
      return { attachCalls, result };
    } finally {
      await harness.lifecycle.dispose();
    }
  }

  it("switches back to the thread's own branch instead of recreating it from its base", async () => {
    const { attachCalls, result } = await restoreWith({
      inputs: { branch: { kind: "new", baseBranch: "main" } },
      branchName: "bb/thread-branch",
    });
    expect(result).toMatchObject({ status: "created", path: CHECKOUT_PATH });
    expect(attachCalls).toEqual([
      expect.objectContaining({
        path: CHECKOUT_PATH,
        branch: { kind: "existing", name: "bb/thread-branch" },
      }),
    ]);
  });

  it("re-attaches a checkout used as-is without switching branches", async () => {
    const { attachCalls } = await restoreWith({
      inputs: {},
      branchName: "feature",
    });
    expect(attachCalls).toEqual([expect.objectContaining({ branch: null })]);
  });

  it("refuses when the thread's branch was never recorded", async () => {
    const { attachCalls, result } = await restoreWith({
      inputs: { branch: { kind: "new", baseBranch: "main" } },
      branchName: null,
    });
    expect(result).toMatchObject({
      status: "failed",
      message: expect.stringContaining("no branch"),
    });
    expect(attachCalls).toHaveLength(0);
  });
});
