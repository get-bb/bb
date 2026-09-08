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
    failClone?: boolean;
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
        const script = command.at(-1) ?? "";
        if (command[0] === "bootstrap-test") state.connected = true;
        if (script.includes("machine stop --host-id")) state.connected = false;
        if (options.failClone && script.includes("git clone --progress")) {
          return {
            exitCode: 128,
            stdout: "",
            stderr: "Host key verification failed.",
          };
        }
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
      async poll() {
        return state.terminated ? 0 : null;
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

  const backend: SandboxBackend = {
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
    failClone?: boolean;
    failSnapshotOnce?: boolean;
  } = {},
) {
  const backend = createBackend(options);
  const sources: Array<{
    id: string;
    projectId: string;
    hostId: string;
    path: string;
    type: "local_path";
    isDefault: boolean;
    createdAt: number;
    updatedAt: number;
  }> = [];
  const deletedSources: string[] = [];
  const deletedHosts: string[] = [];
  const providerCliInstalls: string[] = [];
  let codexInstalled = false;
  const fake = createFakePluginHost({
    pluginId: PLUGIN_ID,
    settings,
    sdk: {
      hosts: {
        delete: async ({ hostId }) => {
          deletedHosts.push(hostId);
          return { ok: true as const };
        },
        list: async () => [
          host(
            backend.states.some((state) => state.connected && !state.terminated)
              ? "connected"
              : "disconnected",
          ),
        ],
        providerCliStatus: async () => ({
          codex: {
            displayName: "Codex",
            installAction: codexInstalled
              ? null
              : {
                  kind: "install" as const,
                  label: "Install" as const,
                  command: "npm install -g @openai/codex",
                },
          },
        }),
        installProviderCli: async ({ provider }) => {
          providerCliInstalls.push(provider);
          codexInstalled = true;
          return [
            {
              type: "completed" as const,
              provider,
              success: true,
            },
          ];
        },
      },
      projects: {
        get: async () => ({ ...PROJECT, sources }),
        sources: {
          add: async (args) => {
            if (args.type !== "local_path") {
              throw new Error("expected a local path source");
            }
            const source = {
              id: `src_${sources.length + 1}`,
              projectId: args.projectId,
              hostId: args.hostId,
              path: args.path,
              type: "local_path" as const,
              isDefault: sources.length === 0,
              createdAt: 1,
              updatedAt: 1,
            };
            sources.push(source);
            return source;
          },
          delete: async ({ sourceId }) => {
            deletedSources.push(sourceId);
            return { ok: true as const };
          },
        },
      },
      system: {
        providerStates: async () => ({
          providers: [
            {
              providerId: "codex",
              displayName: "Codex",
              status: "ready" as const,
            },
          ],
        }),
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
    backendFactory: () => backend.backend,
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
    sources,
    deletedSources,
    deletedHosts,
    providerCliInstalls,
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
        displayName: "Modal sandbox",
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

  it("creates once by key, enrols the checkout, and recovers the same host", async () => {
    const harness = await setup();
    const first = await harness.provider.create(createContext());
    const second = await harness.provider.create(createContext());
    expect(first).toMatchObject({ status: "created", hostId: HOST_ID });
    expect(second).toEqual(first);
    expect(harness.backend.creates).toHaveLength(1);
    expect(harness.sources).toHaveLength(1);
    expect(harness.bootstrap).toHaveBeenCalledTimes(2);
    expect(harness.bootstrap).toHaveBeenLastCalledWith({
      key: "modal-machine-key",
      executor: { exec: expect.any(Function) },
      daemon: { kind: "install" },
      report,
      signal: expect.any(AbortSignal),
    });
    expect(harness.providerCliInstalls).toEqual(["codex"]);
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
      checkpoint() {},
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
      expect(resource).toEqual({
        version: 3,
        key: "modal-machine-key",
        sandboxId: "sandbox-1",
        snapshotImageId: null,
        pendingSnapshotImageIds: [],
        projectId: PROJECT.id,
        sourceId: null,
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

  it("creates a projectless machine without assuming a checkout", async () => {
    const harness = await setup();
    const result = await harness.provider.create({
      ...createContext(),
      project: null,
      gitRemote: null,
    });
    expect(result).toMatchObject({ status: "created", hostId: HOST_ID });
    expect(harness.sources).toHaveLength(0);
  });

  it("leaves checkpointed vendor compute and identity for core cleanup after a terminal create failure", async () => {
    const harness = await setup(SETTINGS, { failClone: true });
    await expect(
      harness.provider.create(createContext()),
    ).resolves.toMatchObject({ status: "failed", failure: "terminal" });
    expect(harness.backend.states[0]?.terminated).toBe(false);
    expect(harness.deletedHosts).toEqual([]);
  });

  it("suspends to a snapshot, resumes, and removes the machine resource", async () => {
    const harness = await setup();
    const created = await harness.provider.create(createContext());
    if (created.status !== "created") throw new Error(created.message);
    const lifecycleContext = {
      hostId: HOST_ID,
      resource: created.resource,
      report,
      signal: new AbortController().signal,
      checkpoint() {},
    };
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
      daemon: { kind: "preinstalled" },
      report,
      signal: lifecycleContext.signal,
    });
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
    expect(harness.deletedSources).toEqual(["src_1"]);
    expect(harness.backend.deletedSnapshots).toEqual(["image-1"]);
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
        checkpoint() {},
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
      checkpoint() {},
    };

    await expect(harness.provider.suspend?.(lifecycleContext)).rejects.toThrow(
      "snapshot creation failed",
    );
    expect(harness.backend.states[0]).toMatchObject({
      connected: false,
      terminated: false,
    });
    await expect(harness.provider.resume?.(lifecycleContext)).resolves.toEqual({
      resource: created.resource,
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
      checkpoint() {},
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
