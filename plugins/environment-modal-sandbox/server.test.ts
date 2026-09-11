import type { BbPluginApi, JsonValue } from "@get-bb/plugin-sdk";
import type {
  PluginMachineProviderCreateContext,
  PluginMachineProviderProgress,
} from "@get-bb/plugin-sdk/machine-provider";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  SandboxBackend,
  SandboxCreateRequest,
  SandboxHandle,
} from "./sandbox-backend.js";
import { readModalMachineResource } from "./lifecycle.js";
import { modalLaunchOptionsSchema } from "./launch-options.js";
import { createModalSandboxPlugin, PROVIDER_ID } from "./server.js";

const PLUGIN_ID = "environment-modal-sandbox";
const HOST_ID = "host_modal";
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
    type: "persistent",
    status,
    machineProviderId: null,
    lifecycle: {
      phase: "active",
      suspendedAt: null,
      message: null,
      pendingLog: "",
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
  const machineResource = vi.fn(
    async (_hostId: string): Promise<JsonValue | null> => null,
  );
  const fake = createFakePluginHost({
    pluginId: PLUGIN_ID,
    machineResource,
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
  Object.assign(fake.bb.experimental_machines, {
    bootstrap,
  });
  await createModalSandboxPlugin({
    backendFactory: (credentials) => ({
      ...backend.backend,
      accountIdentity: async () =>
        credentials.tokenId === SETTINGS.tokenId
          ? "modal-account"
          : "changed-account",
      create: (request) => backend.backend.create(request),
      fromId: (id) => backend.backend.fromId(id),
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
    machineResource,
    provider,
    backend,
    bootstrap,
  };
}

function createContext(
  key = "modal-machine-key",
  inputs: JsonValue = {},
): PluginMachineProviderCreateContext {
  return {
    inputs,
    key,
    attempt: 1,
    report,
    signal: new AbortController().signal,
    checkpoint: vi.fn(async (_resource: JsonValue) => {}),
  };
}

describe("Modal machine provider", () => {
  it("reports setup-required without credentials", async () => {
    const harness = await setup({});
    await expect(harness.provider.availability?.()).resolves.toMatchObject({
      status: "setup-required",
    });
  });

  it("creates once by key and recovers the same host", async () => {
    const harness = await setup();
    const log = vi.fn();
    const progress = { step: vi.fn(), log };
    const first = await harness.provider.create({
      ...createContext(),
      report: progress,
    });
    const second = await harness.provider.create(createContext());
    expect(first).toMatchObject({
      status: "created",
      name: "Modal sandbox tmodal",
    });
    expect(second).toEqual(first);
    expect(harness.backend.creates).toHaveLength(1);
    expect(harness.bootstrap).toHaveBeenCalledTimes(2);
    expect(harness.bootstrap).toHaveBeenLastCalledWith({
      key: "modal-machine-key",
      executor: { exec: expect.any(Function) },
      report,
      signal: expect.any(AbortSignal),
    });
    expect(log.mock.calls.flat().join("")).toContain(
      "Modal sandbox sandbox-1 uses image im-standard",
    );
    expect(log.mock.calls.flat().join("")).toMatch(
      /Modal daemon connected in \d+ ms/u,
    );
  });

  it("resolves configured preset and image names for validation and creation", async () => {
    const harness = await setup();
    const current = modalLaunchOptionsSchema.parse(
      await harness.harness.callRpc("launch.options", {}),
    );
    await harness.harness.callRpc("launch.options.set", {
      presets: [
        { name: "Small", cpu: 0.5, memoryMiB: 512 },
        { name: "Large", cpu: 4, memoryMiB: 8192 },
      ],
      images: [
        ...current.images,
        { name: "Ready", source: "image-id", imageId: "im-ready" },
      ],
    });
    await expect(
      harness.provider.validate?.({ inputs: { preset: "Missing" } }),
    ).resolves.toEqual({
      action: "refuse",
      message: 'The Modal sandbox preset "Missing" is not configured.',
    });
    await expect(
      harness.provider.create(
        createContext("configured-machine", {
          preset: "Large",
          image: "Ready",
        }),
      ),
    ).resolves.toMatchObject({ status: "created" });
    expect(harness.backend.image).not.toHaveBeenCalled();
    expect(harness.backend.creates[0]).toMatchObject({
      cpu: 4,
      memoryMiB: 8192,
      image: { type: "image", imageId: "im-ready" },
    });
  });

  it("passes a named Dockerfile image label into image preparation", async () => {
    const harness = await setup();
    const current = modalLaunchOptionsSchema.parse(
      await harness.harness.callRpc("launch.options", {}),
    );
    const defaultImage = current.images[0];
    if (defaultImage?.source !== "dockerfile") {
      throw new Error("Default image is not a Dockerfile");
    }
    await harness.harness.callRpc("launch.options.set", {
      presets: current.presets,
      images: [
        ...current.images,
        {
          name: "Image 2",
          source: "dockerfile",
          dockerfile: defaultImage.dockerfile,
        },
      ],
    });

    await expect(
      harness.provider.create(
        createContext("named-dockerfile", { image: "Image 2" }),
      ),
    ).resolves.toMatchObject({ status: "created" });
    expect(harness.backend.image).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Image 2" }),
    );
  });

  it("reuses vendor allocation after bootstrap fails and passes cancellation through", async () => {
    const harness = await setup();
    const context = createContext();
    harness.bootstrap.mockRejectedValueOnce(new Error("connection timed out"));
    await expect(harness.provider.create(context)).resolves.toMatchObject({
      status: "failed",
    });
    expect(harness.backend.states[0]?.terminated).toBe(false);
    await expect(harness.provider.create(context)).resolves.toMatchObject({
      status: "created",
    });
    expect(harness.backend.creates).toHaveLength(1);
    expect(harness.bootstrap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        key: context.key,
        signal: context.signal,
      }),
    );
  });

  it("resumes without receiving a host identity from bootstrap", async () => {
    const harness = await setup();
    const created = await harness.provider.create(createContext());
    if (created.status !== "created") throw new Error(created.message);
    const log = vi.fn();
    const context = {
      hostId: HOST_ID,
      resource: created.resource,
      report: { step: vi.fn(), log },
      signal: new AbortController().signal,
      async checkpoint() {},
    };
    const suspended = await harness.provider.suspend?.(context);
    if (suspended === undefined) throw new Error("suspend not registered");
    await expect(
      harness.provider.resume?.({ ...context, resource: suspended.resource }),
    ).resolves.toMatchObject({
      resource: { sandboxId: "sandbox-2", snapshotImageId: "image-1" },
    });
    expect(harness.backend.creates).toHaveLength(2);
    expect(log.mock.calls.flat().join("")).toContain(
      "Restored Modal sandbox sandbox-2 from image image-1",
    );
    expect(log.mock.calls.flat().join("")).toMatch(
      /Modal daemon connected in \d+ ms/u,
    );
  });

  it.each(["create", "lookup"])(
    "checkpoints a %s result despite cancellation so core can remove without bootstrap",
    async (phase) => {
      const test = await setup();
      if (phase === "lookup") {
        await test.provider.create(createContext());
        test.bootstrap.mockClear();
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
        key: "modal-machine-key",
        sandboxId: "sandbox-1",
        snapshotImageId: null,
        pendingSnapshotImageIds: [],
      });
      expect(test.bootstrap).not.toHaveBeenCalled();
      expect(test.backend.states[0]?.terminated).toBe(false);
      if (resource === undefined) throw new Error("missing checkpoint");
      await test.provider.remove({
        hostId: HOST_ID,
        resource,
        report,
        signal: new AbortController().signal,
      });
      expect(test.backend.states[0]?.terminated).toBe(true);
    },
  );

  it("does not bootstrap or tear down when checkpoint persistence fails", async () => {
    const test = await setup();
    const checkpoint = vi.fn(async (_resource: JsonValue) => {
      throw new Error("checkpoint failed");
    });
    expect(
      await test.provider.create({ ...createContext(), checkpoint }),
    ).toMatchObject({ status: "failed" });
    expect(test.bootstrap).not.toHaveBeenCalled();
    expect(test.backend.states[0]?.terminated).toBe(false);
    expect(await test.provider.create(createContext())).toMatchObject({
      status: "created",
    });
    expect(test.backend.creates).toHaveLength(1);
  });

  it("preserves resources across provider suspend, resume, and remove callbacks", async () => {
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
      report,
      signal: lifecycleContext.signal,
    });
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
        async checkpoint(resource) {
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

  it("reboots surviving compute when resume receives a resource without a snapshot", async () => {
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
    harness.backend.states[0]!.connected = false;

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
        async checkpoint(resource) {
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

  it("stops snapshot cleanup when persisting a deletion checkpoint fails", async () => {
    const harness = await setup();
    const created = await harness.provider.create(createContext());
    if (created.status !== "created") throw new Error(created.message);
    harness.backend.states[0]!.terminated = true;
    const resource = {
      ...readModalMachineResource(created.resource),
      snapshotImageId: "image-current",
      snapshotSandboxId: "sandbox-1",
      pendingSnapshotImageIds: ["image-old-1", "image-old-2"],
    };
    const checkpoint = vi.fn(async () => {
      throw new Error("checkpoint refused");
    });

    await expect(
      harness.provider.suspend?.({
        hostId: HOST_ID,
        resource,
        report,
        signal: new AbortController().signal,
        checkpoint,
      }),
    ).rejects.toThrow("checkpoint refused");
    expect(harness.backend.deletedSnapshots).toEqual(["image-old-1"]);
    expect(checkpoint).toHaveBeenCalledOnce();
  });
});

it("reconciles uncertain named allocations without creating or bootstrapping", async () => {
  const test = await setup();
  const request = { ...createContext(), resource: null };
  expect(await test.provider.reconcileCleanup(request)).toEqual({
    status: "removed",
  });
  test.backend.states.push({
    id: "uncertain",
    name: request.key,
    connected: false,
    terminated: false,
  });
  expect(await test.provider.reconcileCleanup(request)).toEqual({
    status: "removed",
  });
  expect(test.backend.states[0]?.terminated).toBe(true);
  expect(await test.provider.reconcileCleanup(request)).toEqual({
    status: "removed",
  });
  expect(test.backend.creates).toHaveLength(0);
  expect(test.bootstrap).not.toHaveBeenCalled();
  await test.harness.lifecycle.dispose();
});
it("reports bootstrap failures after preserving the allocation", async () => {
  const test = await setup();
  test.bootstrap.mockRejectedValueOnce(new Error("Configure machine access"));
  expect(await test.provider.create(createContext())).toMatchObject({
    status: "failed",
  });
  expect(test.backend.image).toHaveBeenCalledOnce();
  expect(test.backend.creates).toHaveLength(1);
});

it("observes vendor deadlines", async () => {
  const harness = await setup();
  const created = await harness.provider.create(createContext());
  if (created.status !== "created") throw new Error("creation failed");
  harness.machineResource.mockImplementation(async (hostId) =>
    hostId === HOST_ID ? created.resource : null,
  );
  expect(
    await harness.harness.callRpc("machine.inspect", { hostId: HOST_ID }),
  ).toMatchObject({
    values: { state: "running", expiresAt: 24 * 60 * 60_000 },
  });
});

it("blocks observation and resume after the configured account identity changes", async () => {
  const harness = await setup();
  const created = await harness.provider.create(createContext());
  if (created.status !== "created") throw new Error("creation failed");
  harness.machineResource.mockImplementation(async (hostId) =>
    hostId === HOST_ID ? created.resource : null,
  );
  await harness.harness.setSettings({ tokenId: "different-account" });
  const context = {
    hostId: HOST_ID,
    resource: created.resource,
    signal: new AbortController().signal,
    report,
    checkpoint: async () => {},
  };
  await expect(
    harness.harness.callRpc("machine.inspect", { hostId: HOST_ID }),
  ).rejects.toThrow("pinned Modal account");
  await expect(harness.provider.resume?.(context)).rejects.toThrow(
    "pinned Modal account",
  );
  expect(harness.backend.creates).toHaveLength(1);
});

it("retries an image build failure inside one create call", async () => {
  const test = await setup();
  test.backend.image.mockRejectedValueOnce(new Error("image build failed"));
  expect(await test.provider.create(createContext())).toMatchObject({
    status: "created",
  });
  expect(test.backend.image).toHaveBeenCalledTimes(2);
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

it("refuses an older snapshot when running compute disappears unexpectedly", async () => {
  const test = await setup();
  const created = await test.provider.create(createContext());
  if (created.status !== "created") throw new Error("creation failed");
  test.backend.states[0]!.terminated = true;
  const context = {
    hostId: HOST_ID,
    resource: {
      ...readModalMachineResource(created.resource),
      snapshotImageId: "older-save",
      snapshotSandboxId: "older-sandbox",
    },
    report,
    signal: new AbortController().signal,
    checkpoint: async () => {},
  };
  await expect(test.provider.resume?.(context)).rejects.toThrow(
    "potentially stale snapshot",
  );
  await expect(test.provider.suspend?.(context)).rejects.toThrow(
    "potentially stale snapshot",
  );
  expect(test.backend.creates).toHaveLength(1);
});

it("validates and persists a Dockerfile override used by new machines, then resets it", async () => {
  const test = await setup();
  const dockerfile =
    "# Custom tools\nFROM node:22-bookworm-slim\nRUN echo custom\nUSER node\n";
  await expect(
    test.harness.behavior.callRpc("image.set", {
      dockerfile: "FROM node:22\nCOPY . /app\n",
    }),
  ).rejects.toThrow("requires one FROM");
  expect(
    await test.harness.behavior.callRpc("image.definition", {}),
  ).toMatchObject({ customized: false });
  await test.harness.behavior.callRpc("image.set", { dockerfile });
  expect(test.backend.image).not.toHaveBeenCalled();
  expect(await test.harness.behavior.callRpc("image.definition", {})).toEqual({
    dockerfile,
    customized: true,
  });
  await test.provider.create(createContext());
  expect(test.backend.image).toHaveBeenCalledWith(
    expect.objectContaining({ dockerfile }),
  );
  await test.harness.behavior.runCli(["image", "reset"]);
  expect(
    await test.harness.behavior.callRpc("image.definition", {}),
  ).toMatchObject({ customized: false });
});

it("reads CLI Dockerfiles on the invoking thread's host and leaves a saved override intact on invalid input", async () => {
  const test = await setup();
  const dockerfile = "FROM node:22\nRUN echo remote-file\n";
  test.harness.sdk.stub("threads.get", async () => ({
    environmentId: "env_remote",
  }));
  test.harness.sdk.stub("environments.get", async () => ({
    hostId: "host_remote",
  }));
  const read = vi.fn(async () => ({
    content: dockerfile,
    contentEncoding: "utf8",
    sizeBytes: dockerfile.length,
  }));
  test.harness.sdk.stub("files.read", read);
  const context = { threadId: "thr_remote", cwd: "/project" };
  expect(
    await test.harness.behavior.runCli(
      ["image", "set", "--file", "Dockerfile", "--json"],
      context,
    ),
  ).toMatchObject({ exitCode: 0 });
  expect(read).toHaveBeenCalledWith(
    expect.objectContaining({
      hostId: "host_remote",
      path: "/project/Dockerfile",
    }),
  );
  read.mockResolvedValue({
    content: "FROM node:22\nFROM alpine\n",
    contentEncoding: "utf8",
    sizeBytes: 29,
  });
  expect(
    await test.harness.behavior.runCli(
      ["image", "set", "--file", "Dockerfile"],
      context,
    ),
  ).toMatchObject({ exitCode: 1 });
  expect(
    await test.harness.behavior.callRpc("image.definition", {}),
  ).toMatchObject({ dockerfile });
});

it("builds without enrollment and runs a bounded debug sandbox with no runtime secrets", async () => {
  const test = await setup();
  const built = await test.harness.behavior.runCli([
    "image",
    "build",
    "--json",
  ]);
  expect(built.exitCode).toBe(0);
  expect(JSON.parse(built.stdout)).toMatchObject({ imageId: "im-standard" });
  expect(test.backend.creates).toHaveLength(0);
  const result = await test.harness.behavior.callRpc("sandbox.run", {});
  expect(result).toMatchObject({ sandboxId: "sandbox-1" });
  expect(test.backend.creates[0]).toMatchObject({
    timeoutMs: 1_800_000,
    image: { type: "image", imageId: "im-standard" },
  });
  expect(test.bootstrap).not.toHaveBeenCalled();
});

it("preserves command argv, output and exit codes while preventing access to unrelated sandboxes", async () => {
  const test = await setup();
  await test.harness.behavior.callRpc("sandbox.run", {});
  const sandbox = await test.backend.backend.fromId("sandbox-1");
  if (!sandbox) throw new Error("missing test sandbox");
  const exec = vi.fn(async () => ({
    exitCode: 7,
    stdout: "out",
    stderr: "err",
  }));
  vi.spyOn(test.backend.backend, "fromId").mockResolvedValue({
    ...sandbox,
    exec,
  });
  expect(
    await test.harness.behavior.runCli([
      "sandbox",
      "exec",
      "sandbox-1",
      "--",
      "bash",
      "-lc",
      "exit 7",
      "--json",
    ]),
  ).toMatchObject({ exitCode: 7, stdout: "out", stderr: "err" });
  expect(exec).toHaveBeenCalledWith(
    ["bash", "-lc", "exit 7", "--json"],
    expect.objectContaining({ timeoutMs: 60_000, maxOutputBytes: 131_072 }),
  );
  expect(
    await test.harness.behavior.runCli([
      "sandbox",
      "exec",
      "sandbox-1",
      "--json",
      "--",
      "false",
    ]),
  ).toMatchObject({
    exitCode: 7,
    stdout: JSON.stringify({ exitCode: 7, stdout: "out", stderr: "err" }),
  });
  expect(
    await test.harness.behavior.runCli(["sandbox", "exec", "sandbox-1", "--"]),
  ).toMatchObject({ exitCode: 1 });
  await expect(
    test.harness.behavior.callRpc("sandbox.stop", { sandboxId: "unrelated" }),
  ).rejects.toThrow("Unknown debug sandbox");
  await test.harness.setSettings({ tokenId: "different-account" });
  await expect(
    test.harness.behavior.callRpc("sandbox.exec", {
      sandboxId: "sandbox-1",
      command: ["true"],
    }),
  ).rejects.toThrow("Restore the Modal account");
});

it("stops debug compute without snapshots and refuses commands after expiry", async () => {
  const test = await setup();
  await test.harness.behavior.callRpc("sandbox.run", {});
  expect(
    await test.harness.behavior.runCli(["sandbox", "stop", "sandbox-1"]),
  ).toMatchObject({ exitCode: 0 });
  expect(test.backend.states[0]?.terminated).toBe(true);
  expect(
    await test.harness.behavior.runCli([
      "sandbox",
      "exec",
      "sandbox-1",
      "--",
      "true",
    ]),
  ).toMatchObject({ exitCode: 1 });
  expect(
    await test.harness.behavior.runCli(["sandbox", "stop", "sandbox-1"]),
  ).toMatchObject({ exitCode: 0 });
});

it("cleans debug compute when recording its ownership fails", async () => {
  const test = await setup();
  vi.spyOn(test.bb.storage.kv, "set").mockRejectedValueOnce(
    new Error("storage unavailable"),
  );
  await expect(
    test.harness.behavior.callRpc("sandbox.run", {}),
  ).rejects.toThrow("storage unavailable");
  expect(test.backend.states[0]?.terminated).toBe(true);
});

it("does not allocate debug compute when the image fails to build", async () => {
  const test = await setup();
  test.backend.image.mockRejectedValueOnce(new Error("RUN command failed"));
  expect(await test.harness.behavior.runCli(["sandbox", "run"])).toMatchObject({
    exitCode: 1,
    stderr: "bb modal failed: RUN command failed",
  });
  expect(test.backend.creates).toHaveLength(0);
});

describe("plugin-owned idle timing", () => {
  it("bumps starting and active thread notifications and real terminal input, and reads current settings", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const test = await setup();
    try {
      vi.setSystemTime(0);
      const created = await test.provider.create(createContext("thread-1"));
      if (created.status !== "created") throw new Error(created.message);
      test.machineResource.mockResolvedValue(created.resource);
      const suspend = vi.fn(async () => ({
        ...host("disconnected"),
        lifecycle: {
          ...host("disconnected").lifecycle,
          phase: "suspended" as const,
        },
      }));
      test.harness.sdk.stub("hosts.experimental_suspend", suspend);
      test.harness.sdk.stub("hosts.list", () => [
        { ...host("connected"), machineProviderId: PROVIDER_ID },
      ]);
      const getHost = vi.fn(async () => ({
        ...host("connected"),
        machineProviderId: PROVIDER_ID,
        connectMachineId: null,
      }));
      test.harness.sdk.stub("hosts.get", getHost);
      const lookup = vi.fn(async () => ({ hostId: HOST_ID }));
      test.harness.sdk.stub("environments.get", lookup);
      vi.setSystemTime(9 * 60_000);
      await test.harness.emitThreadEvent("experimental_thread.events", {
        thread: makeThreadResponse({
          status: "starting",
          environmentId: null,
        }),
        sequence: 10,
      });
      expect(test.machineResource).toHaveBeenCalledWith(HOST_ID);
      expect(test.harness.sdk.callsTo("hosts.list")).toHaveLength(1);
      vi.setSystemTime(10 * 60_000);
      await test.harness.emitThreadEvent("experimental_thread.events", {
        thread: makeThreadResponse({
          status: "starting",
          environmentId: "env-modal",
        }),
        sequence: 11,
      });
      vi.setSystemTime(11 * 60_000);
      await test.harness.emitThreadEvent("experimental_thread.events", {
        thread: makeThreadResponse({
          status: "active",
          environmentId: "env-modal",
        }),
        sequence: 12,
      });
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(getHost).toHaveBeenCalledWith({ hostId: HOST_ID });
      expect(test.harness.sdk.callsTo("hosts.list")).toHaveLength(1);
      expect(test.harness.sdk.callsTo("threads.events.list")).toHaveLength(0);
      vi.setSystemTime(20 * 60_000);
      await test.harness.emitThreadEvent("experimental_thread.events", {
        thread: makeThreadResponse({
          status: "idle",
          environmentId: "env-modal",
        }),
        sequence: 13,
      });
      expect(lookup).toHaveBeenCalledTimes(2);
      await test.harness.runSchedule("pause-idle-machines");
      expect(suspend).not.toHaveBeenCalled();
      await test.harness.emitThreadEvent("experimental_terminal.input", {
        terminal: {
          id: "terminal-modal",
          hostId: HOST_ID,
          environmentId: null,
          threadId: null,
          title: "Terminal",
          initialCwd: "/tmp",
          cols: 80,
          rows: 24,
          status: "running",
          exitCode: null,
          closeReason: null,
          createdAt: 0,
          updatedAt: Date.now(),
          lastUserInputAt: Date.now(),
        },
      });
      vi.setSystemTime(25 * 60_000);
      await test.harness.runSchedule("pause-idle-machines");
      expect(suspend).not.toHaveBeenCalled();
      await test.harness.setSettings({ idleMinutes: 2 });
      await test.harness.runSchedule("pause-idle-machines");
      expect(suspend).toHaveBeenCalledWith({ hostId: HOST_ID });
      suspend.mockRejectedValueOnce(
        new Error("BB request timed out after 75 seconds"),
      );
      getHost.mockResolvedValueOnce({
        ...host("disconnected"),
        machineProviderId: PROVIDER_ID,
        connectMachineId: null,
        lifecycle: {
          ...host("disconnected").lifecycle,
          phase: "suspending",
        },
      });
      vi.setSystemTime(26 * 60_000);
      await test.harness.runSchedule("pause-idle-machines");
      expect(
        test.harness.logEntries.filter((entry) => entry.level === "warn"),
      ).toEqual([]);
      suspend.mockRejectedValueOnce(
        Object.assign(new Error("Thread provisioning is still running"), {
          code: "machine_busy",
        }),
      );
      vi.setSystemTime(27 * 60_000);
      await test.harness.runSchedule("pause-idle-machines");
      expect(
        test.harness.logEntries.filter((entry) => entry.level === "warn"),
      ).toEqual([]);
      expect(getHost).toHaveBeenCalledTimes(4);
      vi.setSystemTime(28 * 60_000);
      await test.harness.runSchedule("pause-idle-machines");
      expect(suspend).toHaveBeenCalledTimes(4);
      suspend.mockClear();
      await test.harness.setSettings({ idleMinutes: 0 });
      vi.setSystemTime(60 * 60_000);
      await test.harness.runSchedule("pause-idle-machines");
      expect(suspend).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await test.harness.lifecycle.dispose();
    }
  });
});
