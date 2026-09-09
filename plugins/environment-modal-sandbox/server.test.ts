import type { BbPluginApi, JsonValue } from "@get-bb/plugin-sdk";
import type {
  PluginMachineProviderCreateContext,
  PluginMachineProviderProgress,
} from "@get-bb/plugin-sdk/machine-provider";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  SandboxBackend,
  SandboxCreateRequest,
  SandboxHandle,
} from "./sandbox-backend.js";
import { readModalMachineResource } from "./lifecycle.js";
import { createModalSandboxPlugin, PROVIDER_ID } from "./server.js";

const PLUGIN_ID = "environment-modal-sandbox";
const HOST_ID = "host_modal";
const PROJECT = {
  id: "proj_1",
  kind: "standard" as const,
  name: "bb",
  gitRemoteUrl: "https://github.com/get-bb/bb.git",
  createdAt: 1,
  updatedAt: 1,
};
const SETTINGS = {
  tokenId: "tok-id",
  tokenSecret: "tok-secret",
};
const report: PluginMachineProviderProgress = {
  step() {},
  log() {},
};
type Host = Awaited<ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>>[number];

function host(status: Host["status"]): Host {
  return {
    id: HOST_ID,
    name: "Modal sandbox odal",
    status,
    machineProviderId: null,
    machineProviderSelection: null,
    lifecycle: {
      phase: "active",
      suspendedAt: null,
      retireAt: null,
      progress: null,
      teardown: null,
    },
    maxPermissionMode: "full",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

interface FakeSandboxState {
  id: string;
  name: string;
  connected: boolean;
  terminated: boolean;
}

function createBackend(
  options: {
    crashAfterTerminateOnce?: boolean;
    failSnapshotOnce?: boolean;
  } = {},
) {
  const creates: SandboxCreateRequest[] = [];
  const states: FakeSandboxState[] = [];
  const deletedSnapshots: string[] = [];
  let nextSandbox = 0;
  let nextSnapshot = 0;
  let crashAfterTerminate = options.crashAfterTerminateOnce === true;
  let failSnapshot = options.failSnapshotOnce === true;

  function handle(state: FakeSandboxState): SandboxHandle {
    return {
      sandboxId: state.id,
      async exec(command) {
        if (command[0] === "bootstrap-test") state.connected = true;
        if (command.join(" ").includes("machine stop --host-id"))
          state.connected = false;
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
      async terminate() {
        state.terminated = true;
        state.connected = false;
        if (crashAfterTerminate) {
          crashAfterTerminate = false;
          throw new Error("server crashed after sandbox termination");
        }
      },
      async snapshotFilesystem() {
        if (state.connected)
          throw new Error("snapshot requires a stopped daemon");
        if (failSnapshot) {
          failSnapshot = false;
          throw new Error("snapshot creation failed");
        }
        nextSnapshot += 1;
        return `image-${nextSnapshot}`;
      },
    };
  }

  const image = vi.fn(async () => "im-standard");
  const backend: SandboxBackend = {
    accountIdentity: async () => "modal-account",
    ensureStandardImage: image,
    close() {},
    async observe({ sandboxId }) {
      return {
        running: states.some(
          (state) => state.id === sandboxId && !state.terminated,
        ),
        expiresAt: 24 * 60 * 60_000,
      };
    },
    async create(request) {
      creates.push(request);
      nextSandbox += 1;
      const state = {
        id: `sandbox-${nextSandbox}`,
        name: request.name,
        connected: false,
        terminated: false,
      } satisfies FakeSandboxState;
      states.push(state);
      return handle(state);
    },
    async fromId(sandboxId) {
      const state = states.find(
        (candidate) => candidate.id === sandboxId && !candidate.terminated,
      );
      return state === undefined ? null : handle(state);
    },
    async fromName(_appName, name) {
      const state = states.find(
        (candidate) => candidate.name === name && !candidate.terminated,
      );
      return state === undefined ? null : handle(state);
    },
    async deleteSnapshot(imageId) {
      deletedSnapshots.push(imageId);
    },
  };
  return {
    backend,
    image,
    creates,
    states,
    deletedSnapshots,
    crashAfterNextTerminate() {
      crashAfterTerminate = true;
    },
  };
}

async function setup(
  settings: Record<string, string> = SETTINGS,
  options: {
    crashAfterTerminateOnce?: boolean;
    failSnapshotOnce?: boolean;
  } = {},
) {
  const backend = createBackend(options);
  const fake = createFakePluginHost({
    pluginId: PLUGIN_ID,
    settings,
    sdk: {
      hosts: {
        list: async () => [
          host(
            backend.states.some((state) => state.connected && !state.terminated)
              ? "connected"
              : "disconnected",
          ),
        ],
      },
    },
  });
  const bootstrap = vi.fn(
    async (request: {
      key: string;
      executor: {
        exec(request: {
          command: string[];
          timeoutMs: number;
          signal: AbortSignal;
          stdin?: string;
        }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
      };
      daemon: { kind: "install" | "preinstalled" };
      report: PluginMachineProviderProgress;
      signal: AbortSignal;
    }) => {
      await request.executor.exec({
        command: ["bootstrap-test"],
        timeoutMs: 1000,
        signal: request.signal,
        stdin: "bootstrap-secret",
      });
      return { hostId: HOST_ID };
    },
  );
  const prepareEnrollment = vi.fn(async () => ({
    id: "enrollment-1",
    hostId: HOST_ID,
    state: "pending",
    bootstrap: { credential: "bootstrap-secret" },
  }));
  Object.assign(fake.bb.experimental_machines, {
    bootstrap,
    prepareEnrollment,
  });
  await createModalSandboxPlugin({
    backendFactory: (credentials) => ({
      ...backend.backend,
      accountIdentity: async () =>
        credentials.tokenId === SETTINGS.tokenId
          ? "modal-account"
          : "changed-account",
      create: (request) => backend.backend.create(request),
      fromName: (appName, name) => backend.backend.fromName(appName, name),
    }),
    now: () => Date.now(),
    sleep: async () => {},
  })(fake.bb);
  const provider = fake.harness.registrations.machineProviders.get(PROVIDER_ID);
  if (provider === undefined)
    throw new Error("machine provider not registered");
  return {
    ...fake,
    provider,
    backend,
    bootstrap,
    prepareEnrollment,
  };
}

function createContext(
  key = "modal-machine-key",
): PluginMachineProviderCreateContext {
  return {
    project: PROJECT,
    gitRemote: null,
    inputs: null,
    key,
    attempt: 1,
    report,
    signal: new AbortController().signal,
    checkpoint: vi.fn(async (_resource: JsonValue) => {}),
  };
}

describe("Modal machine provider", () => {
  it("bundles Modal's official one-color icon mark", () => {
    const svg = readFileSync(
      new URL("./modal-logo.svg", import.meta.url),
      "utf8",
    );
    expect(svg).toContain('width="611" height="317"');
    expect(svg).toContain('viewBox="0 0 611 317"');
    expect(svg).toContain('fill="black"');
  });

  it("registers only a machine provider with the Modal asset and picker sugar", async () => {
    const harness = await setup();
    expect(harness.harness.registrations.environmentProviders.size).toBe(0);
    expect(harness.provider).toMatchObject({
      id: PROVIDER_ID,
      displayName: "Modal sandbox",
      icon: "./modal-logo.svg",
      environmentRow: {
        displayName: "New sandbox",
        environmentProviderId: "project-checkout",
      },
      policy: {
        idleSuspendMs: 900_000,
        retire: { after: "last-thread", graceMs: 2_592_000_000 },
        removeRetryMs: 30_000,
      },
    });
  });

  it("reports setup-required without credentials", async () => {
    const harness = await setup({});
    await expect(
      harness.provider.availability?.({ project: PROJECT, gitRemote: null }),
    ).resolves.toMatchObject({ status: "setup-required" });
  });

  it("creates once by key and recovers the same host", async () => {
    const harness = await setup();
    const first = await harness.provider.create(createContext());
    const second = await harness.provider.create(createContext());
    expect(first).toMatchObject({ status: "created", hostId: HOST_ID });
    expect(second).toEqual(first);
    expect(harness.backend.creates).toHaveLength(1);
    expect(harness.bootstrap).toHaveBeenCalledTimes(2);
    expect(harness.bootstrap).toHaveBeenLastCalledWith({
      key: "modal-machine-key",
      executor: { exec: expect.any(Function) },
      daemon: { kind: "install" },
      report,
      signal: expect.any(AbortSignal),
    });
  });

  it("reuses vendor allocation after bootstrap fails and passes cancellation through", async () => {
    const harness = await setup();
    const context = createContext();
    harness.bootstrap.mockRejectedValueOnce(new Error("connection timed out"));
    await expect(harness.provider.create(context)).resolves.toMatchObject({
      status: "failed",
      failure: "transient",
    });
    expect(harness.backend.states[0]?.terminated).toBe(false);
    await expect(harness.provider.create(context)).resolves.toMatchObject({
      status: "created",
      hostId: HOST_ID,
    });
    expect(harness.backend.creates).toHaveLength(1);
    expect(harness.bootstrap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        key: context.key,
        signal: context.signal,
      }),
    );
  });

  it("rejects a changed bootstrap identity on resume without deleting the snapshot", async () => {
    const harness = await setup();
    const created = await harness.provider.create(createContext());
    if (created.status !== "created") throw new Error(created.message);
    const context = {
      hostId: HOST_ID,
      resource: created.resource,
      report,
      signal: new AbortController().signal,
      async checkpoint() {},
    };
    const suspended = await harness.provider.suspend?.(context);
    if (suspended === undefined) throw new Error("suspend not registered");
    harness.bootstrap.mockResolvedValueOnce({ hostId: "different-host" });
    await expect(
      harness.provider.resume?.({ ...context, resource: suspended.resource }),
    ).rejects.toThrow("different machine identity");
    expect(harness.backend.deletedSnapshots).toEqual([]);
    await expect(
      harness.provider.resume?.({ ...context, resource: suspended.resource }),
    ).resolves.toMatchObject({
      resource: { sandboxId: "sandbox-2", snapshotImageId: "image-1" },
    });
    expect(harness.backend.creates).toHaveLength(2);
  });

  it.each(["create", "lookup"])(
    "checkpoints a %s result despite cancellation so core can remove without bootstrap",
    async (phase) => {
      const test = await setup();
      if (phase === "lookup") {
        await test.provider.create(createContext());
        test.bootstrap.mockClear();
        test.prepareEnrollment.mockClear();
      }
      const controller = new AbortController();
      if (phase === "create") {
        const create = test.backend.backend.create;
        vi.spyOn(test.backend.backend, "create").mockImplementationOnce(
          async (request) => {
            const sandbox = await create(request);
            controller.abort(new Error("cancelled"));
            return sandbox;
          },
        );
      } else {
        const fromName = test.backend.backend.fromName;
        vi.spyOn(test.backend.backend, "fromName").mockImplementationOnce(
          async (appName, name) => {
            const sandbox = await fromName(appName, name);
            controller.abort(new Error("cancelled"));
            return sandbox;
          },
        );
      }
      const checkpoint = vi.fn(async (_resource: JsonValue) => {});
      await expect(
        test.provider.create({
          ...createContext(),
          signal: controller.signal,
          checkpoint,
        }),
      ).rejects.toThrow("cancelled");
      const resource = checkpoint.mock.calls[0]?.[0];
      expect(resource).toMatchObject({
        version: 5,
        key: "modal-machine-key",
        sandboxId: "sandbox-1",
        snapshotImageId: null,
        pendingSnapshotImageIds: [],
      });
      expect(test.bootstrap).not.toHaveBeenCalled();
      expect(test.prepareEnrollment.mock.invocationCallOrder[0]).toBeLessThan(
        checkpoint.mock.invocationCallOrder[0]!,
      );
      expect(test.backend.states[0]?.terminated).toBe(false);
      if (resource === undefined) throw new Error("missing checkpoint");
      await test.provider.remove({
        hostId: HOST_ID,
        resource,
        report,
        signal: new AbortController().signal,
      });
      expect(test.backend.states[0]?.terminated).toBe(true);
      expect(test.prepareEnrollment).toHaveBeenCalledOnce();
    },
  );

  it("does not bootstrap or tear down when checkpoint persistence fails", async () => {
    const test = await setup();
    const checkpoint = vi.fn(async (_resource: JsonValue) => {
      throw new Error("checkpoint failed");
    });
    expect(
      await test.provider.create({ ...createContext(), checkpoint }),
    ).toMatchObject({ status: "failed", failure: "transient" });
    expect(test.bootstrap).not.toHaveBeenCalled();
    expect(test.backend.states[0]?.terminated).toBe(false);
    expect(await test.provider.create(createContext())).toMatchObject({
      status: "created",
    });
    expect(test.backend.creates).toHaveLength(1);
  });

  it("rejects projectless image launches before allocating", async () => {
    const harness = await setup();
    const result = await harness.provider.create({
      ...createContext(),
      project: null,
      gitRemote: null,
    });
    expect(result).toMatchObject({
      status: "failed",
      message: "Select a project before creating a Modal machine",
    });
    expect(harness.backend.creates).toHaveLength(0);
  });

  it("suspends to a snapshot, resumes, and removes the machine resource", async () => {
    const harness = await setup({
      ...SETTINGS,
      environmentVariables: "GH_TOKEN=image-secret-sentinel",
    });
    const created = await harness.provider.create(createContext());
    if (created.status !== "created") throw new Error(created.message);
    const lifecycleContext = {
      hostId: HOST_ID,
      resource: created.resource,
      report,
      signal: new AbortController().signal,
      async checkpoint() {},
    };
    expect(JSON.stringify(harness.backend.creates)).not.toContain(
      "image-secret-sentinel",
    );
    expect(harness.backend.creates[0]?.environmentVariables).not.toHaveProperty(
      "GH_TOKEN",
    );
    expect(harness.backend.creates[0]?.environmentVariables).not.toHaveProperty(
      "GIT_CONFIG_COUNT",
    );
    expect(harness.bootstrap.mock.calls[0]?.[0]).not.toHaveProperty(
      "contributedEnv",
    );
    const suspended = await harness.provider.suspend?.(lifecycleContext);
    expect(suspended?.resource).toMatchObject({
      sandboxId: null,
      snapshotImageId: "image-1",
    });
    if (suspended === undefined) throw new Error("suspend not registered");
    const resumed = await harness.provider.resume?.({
      ...lifecycleContext,
      resource: suspended.resource,
    });
    expect(harness.bootstrap).toHaveBeenLastCalledWith({
      key: "modal-machine-key",
      executor: { exec: expect.any(Function) },
      daemon: { kind: "install" },
      report,
      signal: lifecycleContext.signal,
    });
    expect(harness.backend.creates[1]?.environmentVariables).not.toHaveProperty(
      "GH_TOKEN",
    );
    expect(harness.backend.creates[1]?.environmentVariables).not.toHaveProperty(
      "GIT_CONFIG_COUNT",
    );
    expect(JSON.stringify(harness.backend.creates)).not.toContain(
      "contributedEnv",
    );
    expect(resumed?.resource).toMatchObject({
      sandboxId: "sandbox-2",
      snapshotImageId: "image-1",
    });
    if (resumed === undefined) throw new Error("resume not registered");
    await expect(
      harness.provider.remove({
        ...lifecycleContext,
        resource: resumed.resource,
      }),
    ).resolves.toEqual({ status: "removed" });
    expect(harness.backend.deletedSnapshots).toEqual(["image-1"]);
  });

  it("awaits the resume allocation checkpoint before bootstrap and recovers without allocating again", async () => {
    const harness = await setup();
    const created = await harness.provider.create(createContext());
    if (created.status !== "created") throw new Error(created.message);
    const context = {
      hostId: HOST_ID,
      resource: created.resource,
      report,
      signal: new AbortController().signal,
      checkpoint: vi.fn(async (_resource: JsonValue) => {}),
    };
    const suspended = await harness.provider.suspend?.(context);
    if (suspended === undefined) throw new Error("suspend missing");
    let persisted: JsonValue | null = null;
    harness.bootstrap.mockClear();
    await expect(
      harness.provider.resume?.({
        ...context,
        resource: suspended.resource,
        checkpoint: async (resource) => {
          persisted = resource;
          throw new Error("crash after durable checkpoint");
        },
      }),
    ).rejects.toThrow("crash after durable checkpoint");
    expect(harness.bootstrap).not.toHaveBeenCalled();
    if (persisted === null) throw new Error("checkpoint missing");
    expect(persisted).toMatchObject({ sandboxId: "sandbox-2" });
    const resumed = await harness.provider.resume?.({
      ...context,
      resource: persisted,
    });
    expect(resumed?.resource).toMatchObject({ sandboxId: "sandbox-2" });
    expect(context.checkpoint.mock.invocationCallOrder[0]).toBeLessThan(
      harness.bootstrap.mock.invocationCallOrder[0]!,
    );
    expect(harness.bootstrap).toHaveBeenCalledOnce();
  });

  it("checkpoints a restorable snapshot before termination and recovers a crashed suspend", async () => {
    const harness = await setup(SETTINGS, { crashAfterTerminateOnce: true });
    const created = await harness.provider.create(createContext());
    if (created.status !== "created") throw new Error(created.message);
    let checkpoint: JsonValue | null = null;
    await expect(
      harness.provider.suspend?.({
        hostId: HOST_ID,
        resource: created.resource,
        report,
        signal: new AbortController().signal,
        checkpoint(resource) {
          checkpoint = resource;
        },
      }),
    ).rejects.toThrow("server crashed after sandbox termination");
    expect(checkpoint).toMatchObject({
      sandboxId: "sandbox-1",
      snapshotImageId: "image-1",
    });
    expect(harness.backend.states[0]?.terminated).toBe(true);
    if (checkpoint === null) throw new Error("checkpoint was not persisted");

    await expect(
      harness.provider.suspend?.({
        hostId: HOST_ID,
        resource: checkpoint,
        report,
        signal: new AbortController().signal,
        async checkpoint() {},
      }),
    ).resolves.toEqual({ resource: checkpoint });
  });

  it("resumes a surviving sandbox when suspension failed before its first snapshot", async () => {
    const harness = await setup(SETTINGS, { failSnapshotOnce: true });
    const created = await harness.provider.create(createContext());
    if (created.status !== "created") throw new Error(created.message);
    const lifecycleContext = {
      hostId: HOST_ID,
      resource: created.resource,
      report,
      signal: new AbortController().signal,
      async checkpoint() {},
    };

    await expect(harness.provider.suspend?.(lifecycleContext)).rejects.toThrow(
      "snapshot creation failed",
    );
    expect(harness.backend.states[0]).toMatchObject({
      connected: false,
      terminated: false,
    });
    await expect(
      harness.provider.resume?.(lifecycleContext),
    ).resolves.toMatchObject({
      resource: { sandboxId: "sandbox-1" },
    });
    expect(harness.backend.creates).toHaveLength(1);
    expect(harness.backend.states[0]).toMatchObject({
      connected: true,
      terminated: false,
    });
  });

  it("retains superseded snapshots until recovery or removal deletes them", async () => {
    const harness = await setup();
    const created = await harness.provider.create(createContext());
    if (created.status !== "created") throw new Error(created.message);
    const lifecycleContext = {
      hostId: HOST_ID,
      resource: created.resource,
      report,
      signal: new AbortController().signal,
      async checkpoint() {},
    };
    const firstSuspension = await harness.provider.suspend?.(lifecycleContext);
    if (firstSuspension === undefined)
      throw new Error("suspend not registered");
    const firstResume = await harness.provider.resume?.({
      ...lifecycleContext,
      resource: firstSuspension.resource,
    });
    if (firstResume === undefined) throw new Error("resume not registered");
    harness.backend.crashAfterNextTerminate();
    let checkpoint: JsonValue | null = null;

    await expect(
      harness.provider.suspend?.({
        ...lifecycleContext,
        resource: firstResume.resource,
        checkpoint(resource) {
          checkpoint = resource;
        },
      }),
    ).rejects.toThrow("server crashed after sandbox termination");
    expect(checkpoint).toMatchObject({
      snapshotImageId: "image-2",
      pendingSnapshotImageIds: ["image-1"],
    });
    if (checkpoint === null) throw new Error("checkpoint was not persisted");

    const recovered = await harness.provider.resume?.({
      ...lifecycleContext,
      resource: checkpoint,
    });
    expect(recovered?.resource).toMatchObject({
      snapshotImageId: "image-2",
      pendingSnapshotImageIds: [],
    });
    expect(harness.backend.deletedSnapshots).toEqual(["image-1"]);
    if (recovered === undefined) throw new Error("resume not registered");
    const recoveredResource = readModalMachineResource(recovered.resource);

    await expect(
      harness.provider.remove({
        ...lifecycleContext,
        resource: {
          ...recoveredResource,
          pendingSnapshotImageIds: ["image-pending-a", "image-pending-b"],
        },
      }),
    ).resolves.toEqual({ status: "removed" });
    expect(harness.backend.deletedSnapshots).toHaveLength(4);
    expect(harness.backend.deletedSnapshots).toEqual(
      expect.arrayContaining([
        "image-1",
        "image-2",
        "image-pending-a",
        "image-pending-b",
      ]),
    );
  });
});

it("reconciles uncertain named allocations without creating or bootstrapping", async () => {
  const test = await setup();
  const request = createContext();
  expect(await test.provider.experimental_reconcileCleanup(request)).toEqual({
    status: "removed",
  });
  await test.bb.storage.kv.set(`allocation/${request.key}`, {
    appName: "bb",
    sandboxId: null,
  });
  expect(await test.provider.reconcileCleanup(request)).toMatchObject({
    status: "failed",
  });
  test.backend.states.push({
    id: "uncertain",
    name: request.key,
    connected: false,
    terminated: false,
  });
  expect(await test.provider.experimental_reconcileCleanup(request)).toEqual({
    status: "removed",
  });
  expect(test.backend.states[0]?.terminated).toBe(true);
  expect(await test.provider.experimental_reconcileCleanup(request)).toEqual({
    status: "removed",
  });
  expect(test.backend.creates).toHaveLength(0);
  expect(test.bootstrap).not.toHaveBeenCalled();
  expect(test.prepareEnrollment).not.toHaveBeenCalled();
  await test.harness.lifecycle.dispose();
});
it("does not build an image when enrollment preparation fails", async () => {
  const test = await setup();
  test.prepareEnrollment.mockRejectedValueOnce(
    new Error("Configure machine access"),
  );
  expect(await test.provider.create(createContext())).toMatchObject({
    status: "failed",
  });
  expect(test.backend.image).not.toHaveBeenCalled();
  expect(test.backend.creates).toHaveLength(0);
});

it("observes vendor deadlines and applies current lifecycle settings without plugin reload", async () => {
  const harness = await setup();
  const created = await harness.provider.create(createContext());
  if (created.status !== "created") throw new Error("creation failed");
  const context = {
    hostId: HOST_ID,
    resource: created.resource,
    signal: new AbortController().signal,
  };
  expect(await harness.provider.experimental_observe?.(context)).toMatchObject({
    state: "running",
    expiresAt: 24 * 60 * 60_000,
  });
  await harness.harness.setSettings({ idleMinutes: "2", timeoutMinutes: "4" });
  expect(await harness.provider.experimental_policy?.(context)).toEqual({
    idleSuspendMs: 120_000,
    retireAfterMs: 30 * 86400_000,
    deadlineLeadMs: 120_000,
  });
});

it("blocks observation and resume after the configured account identity changes", async () => {
  const harness = await setup();
  const created = await harness.provider.create(createContext());
  if (created.status !== "created") throw new Error("creation failed");
  await harness.harness.setSettings({ tokenId: "different-account" });
  const context = {
    hostId: HOST_ID,
    resource: created.resource,
    signal: new AbortController().signal,
    report,
    checkpoint: async () => {},
  };
  await expect(
    harness.provider.experimental_observe?.(context),
  ).rejects.toThrow("pinned Modal account");
  await expect(harness.provider.resume?.(context)).rejects.toThrow(
    "pinned Modal account",
  );
  expect(harness.backend.creates).toHaveLength(1);
});

it("retries an image build failure without recording an uncertain sandbox allocation", async () => {
  const test = await setup();
  test.backend.image.mockRejectedValueOnce(new Error("image build failed"));
  expect(await test.provider.create(createContext())).toMatchObject({
    status: "failed",
    message: "image build failed",
  });
  expect(test.backend.creates).toHaveLength(0);
  expect(
    await test.bb.storage.kv.get("allocation/modal-machine-key"),
  ).toBeUndefined();
  expect(await test.provider.create(createContext())).toMatchObject({
    status: "created",
  });
  expect(test.backend.creates[0]?.image).toEqual({
    type: "image",
    imageId: "im-standard",
  });
});

it("does not allocate a sandbox when cancelled during standard image preparation", async () => {
  const test = await setup();
  const controller = new AbortController();
  test.backend.image.mockImplementationOnce(async () => {
    controller.abort(new Error("cancelled"));
    return "im-standard";
  });
  await expect(
    test.provider.create({ ...createContext(), signal: controller.signal }),
  ).rejects.toThrow("cancelled");
  expect(test.backend.creates).toHaveLength(0);
  expect(test.bootstrap).not.toHaveBeenCalled();
});

it("rejects removed image-selection inputs", async () => {
  const test = await setup();
  expect(
    await test.provider.create({
      ...createContext(),
      inputs: { buildId: "old-build" },
    }),
  ).toMatchObject({ status: "failed" });
  expect(test.backend.creates).toHaveLength(0);
});

it("exposes account connection checks through RPC and CLI without allocation", async () => {
  const test = await setup();
  expect(await test.harness.behavior.callRpc("account.inspect", {})).toEqual({
    available: true,
    message: "Connected to Modal (bb-sandboxes)",
  });
  expect(
    await test.harness.behavior.runCli(["account", "inspect", "--json"]),
  ).toMatchObject({ exitCode: 0 });
  expect(await test.harness.behavior.runCli(["image", "build"])).toMatchObject({
    exitCode: 1,
  });
  expect(test.backend.image).not.toHaveBeenCalled();
  expect(test.backend.creates).toHaveLength(0);
});

it("shows the shipped Dockerfile without credentials or cloud access", async () => {
  const test = await setup({});
  const dockerfile = readFileSync(
    new URL("./Dockerfile", import.meta.url),
    "utf8",
  );
  expect(await test.harness.behavior.callRpc("image.definition", {})).toEqual({
    dockerfile,
  });
  expect(await test.harness.behavior.runCli(["image", "show"])).toMatchObject({
    exitCode: 0,
    stdout: dockerfile,
  });
  expect(test.backend.image).not.toHaveBeenCalled();
  expect(test.backend.creates).toHaveLength(0);
});
