import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceError, type HostWorkspace } from "@bb/host-workspace";
import { dispatchCommand } from "../../src/command-dispatch.js";
import type { EventSinkInput } from "../../src/event-sink.js";
import {
  cleanupTempDirs,
  createFakeRuntime,
  createFakeWorkspace,
  createHarness,
  makeDispatchOptions,
  makeTempDir,
} from "./dispatch-helpers.js";
import { RuntimeManager } from "../../src/runtime-manager.js";

afterEach(cleanupTempDirs);

function streamedEntries(emitted: EventSinkInput[]) {
  return emitted.flatMap((input) =>
    input.event.type === "system/thread-provisioning"
      ? input.event.entries
      : [],
  );
}

describe("environment command dispatch", () => {
  it("covers environment.attach in unmanaged mode", async () => {
    const harness = createHarness({ workspacePath: "/tmp/unmanaged" });
    const sourcePath = await makeTempDir("bb-dispatch-unmanaged-");

    const result = await dispatchCommand(
      {
        type: "environment.attach",
        environmentId: "env-unmanaged",
        initiator: null,
        path: sourcePath,
        setupScriptTimeoutMs: null,
      },
      harness.dispatchOptions(),
    );

    expect(result).toMatchObject({
      path: sourcePath,
      isGitRepo: true,
      branchName: "main",
      defaultBranch: "main",
    });
    expect(harness.provisions).toEqual([
      {
        path: sourcePath,
        onProgress: expect.any(Function),
        signal: expect.any(AbortSignal),
      },
    ]);
  });

  it("runs setup before attaching a provider-owned workspace", async () => {
    const harness = createHarness({ workspacePath: "/tmp/provider-owned" });
    const sourcePath = await makeTempDir("bb-dispatch-provider-owned-");
    const markerPath = `${sourcePath}/setup-marker`;
    await fs.writeFile(
      `${sourcePath}/.bb-env-setup.sh`,
      `printf '%s' ready > '${markerPath}'\n`,
    );
    const emittedEvents: EventSinkInput[] = [];

    await dispatchCommand(
      {
        type: "environment.attach",
        environmentId: "env-provider-owned",
        initiator: {
          threadId: "thr-provider-owned",
          provisioningId: "tpv-provider-owned",
        },
        path: sourcePath,
        setupScriptTimeoutMs: 10_000,
      },
      makeDispatchOptions({
        runtimeManager: harness.manager,
        eventSink: {
          emit: (event) => emittedEvents.push(event),
          flush: async () => undefined,
        },
      }),
    );

    await expect(fs.readFile(markerPath, "utf8")).resolves.toBe("ready");
    expect(streamedEntries(emittedEvents)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "setup-started",
          text: "Running .bb-env-setup.sh",
        }),
        expect.objectContaining({ key: "setup-completed" }),
        expect.objectContaining({ key: "workspace-path" }),
      ]),
    );
  });

  it("fails attachment when the setup script fails", async () => {
    const harness = createHarness({ workspacePath: "/tmp/setup-failure" });
    const sourcePath = await makeTempDir("bb-dispatch-setup-failure-");
    await fs.writeFile(
      `${sourcePath}/.bb-env-setup.sh`,
      "printf 'script diagnostic\\n'\nexit 7\n",
    );

    await expect(
      dispatchCommand(
        {
          type: "environment.attach",
          environmentId: "env-setup-failure",
          initiator: null,
          path: sourcePath,
          setupScriptTimeoutMs: 10_000,
        },
        harness.dispatchOptions(),
      ),
    ).rejects.toThrow("failed with exit code 7");
    expect(harness.provisions).toEqual([]);
  });

  it("returns success when cancelling a provision with no in-flight work", async () => {
    const harness = createHarness();

    await expect(
      dispatchCommand(
        {
          type: "environment.attach.cancel",
          environmentId: "env-missing",
        },
        harness.dispatchOptions(),
      ),
    ).resolves.toEqual({ aborted: false });
  });

  it("aborts in-flight environment provisioning", async () => {
    const { workspace } = createFakeWorkspace("/tmp/cancelled");
    const { runtime } = createFakeRuntime();
    let provisionSignal: AbortSignal | undefined;
    let resolveProvisionStarted: () => void = () => undefined;
    const provisionStarted = new Promise<void>((resolve) => {
      resolveProvisionStarted = resolve;
    });
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async (options) => {
        provisionSignal = options.signal;
        resolveProvisionStarted();
        await new Promise<void>((resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => {
              reject(options.signal?.reason);
            },
            { once: true },
          );
        });
        return workspace;
      },
    });
    const dispatchOptions = makeDispatchOptions({ runtimeManager: manager });
    const provision = dispatchCommand(
      {
        type: "environment.attach",
        environmentId: "env-cancel",
        initiator: null,
        path: "/tmp/cancelled",
        setupScriptTimeoutMs: null,
      },
      dispatchOptions,
    );
    await provisionStarted;

    await expect(
      dispatchCommand(
        {
          type: "environment.attach.cancel",
          environmentId: "env-cancel",
        },
        dispatchOptions,
      ),
    ).resolves.toEqual({ aborted: true });

    expect(provisionSignal?.aborted).toBe(true);
    await expect(provision).rejects.toMatchObject({
      code: "provision_cancelled",
    });
  });

  it("reports provision cancellation after delivering abort without waiting for work to settle", async () => {
    const { runtime } = createFakeRuntime();
    let abortObserved = false;
    let provisionSettled = false;
    let provisionSignal: AbortSignal | undefined;
    let resolveProvisionStarted: () => void = () => undefined;
    const provisionStarted = new Promise<void>((resolve) => {
      resolveProvisionStarted = resolve;
    });
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async (options) => {
        provisionSignal = options.signal;
        options.signal?.addEventListener(
          "abort",
          () => {
            abortObserved = true;
          },
          { once: true },
        );
        resolveProvisionStarted();
        return new Promise<HostWorkspace>(() => undefined);
      },
    });
    const dispatchOptions = makeDispatchOptions({ runtimeManager: manager });
    const provision = dispatchCommand(
      {
        type: "environment.attach",
        environmentId: "env-cancel-no-settle",
        initiator: null,
        path: "/tmp/cancelled-no-settle",
        setupScriptTimeoutMs: null,
      },
      dispatchOptions,
    ).finally(() => {
      provisionSettled = true;
    });
    await provisionStarted;

    const cancel = dispatchCommand(
      {
        type: "environment.attach.cancel",
        environmentId: "env-cancel-no-settle",
      },
      dispatchOptions,
    );

    await expect(cancel).resolves.toEqual({ aborted: true });
    expect(provisionSignal?.aborted).toBe(true);
    expect(abortObserved).toBe(true);
    expect(provisionSettled).toBe(false);
    void provision;
  });

  it("streams live events and flushes when initiator is provided", async () => {
    const harness = createHarness({ workspacePath: "/tmp/live-stream" });
    const sourcePath = await makeTempDir("bb-dispatch-stream-");
    const emittedEvents: EventSinkInput[] = [];
    let flushCount = 0;

    await dispatchCommand(
      {
        type: "environment.attach",
        environmentId: "env-stream",
        initiator: {
          threadId: "thr-initiator",
          provisioningId: "tpv-initiator",
        },
        path: sourcePath,
        setupScriptTimeoutMs: null,
      },
      makeDispatchOptions({
        runtimeManager: harness.manager,
        eventSink: {
          emit: (event) => {
            emittedEvents.push(event);
          },
          flush: async () => {
            flushCount += 1;
          },
        },
      }),
    );

    expect(flushCount).toBe(1);
    expect(emittedEvents.length).toBeGreaterThan(0);
    const firstEvent = emittedEvents[0];
    expect(firstEvent?.threadId).toBe("thr-initiator");
    expect(
      firstEvent && "environmentId" in firstEvent.event
        ? firstEvent.event.environmentId
        : undefined,
    ).toBe("env-stream");
    expect(streamedEntries(emittedEvents)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "workspace-path",
          text: `Using workspace: ${sourcePath}`,
        }),
        expect.objectContaining({
          key: "workspace-branch",
          text: expect.stringContaining("Using branch: main"),
        }),
      ]),
    );
  });

  it("batches live provisioning entries before flushing", async () => {
    const { workspace } = createFakeWorkspace("/tmp/batched-progress");
    const { runtime } = createFakeRuntime();
    const emittedEvents: EventSinkInput[] = [];
    const eventCountsAtFlush: number[] = [];
    const manager = new RuntimeManager({
      provisionWorkspace: async (options) => {
        options.onProgress?.({
          type: "step",
          key: "setup-output-0",
          text: "install line 0",
          status: "completed",
          startedAt: Date.now(),
        });
        options.onProgress?.({
          type: "step",
          key: "setup-output-1",
          text: "install line 1",
          status: "completed",
          startedAt: Date.now(),
        });
        options.onProgress?.({
          type: "step",
          key: "setup-output-2",
          text: "install line 2",
          status: "completed",
          startedAt: Date.now(),
        });
        return workspace;
      },
      createRuntime: () => runtime,
    });

    await dispatchCommand(
      {
        type: "environment.attach",
        environmentId: "env-batched-progress",
        initiator: {
          threadId: "thr-batched-progress",
          provisioningId: "tpv-batched-progress",
        },
        path: "/tmp/batched-progress",
        setupScriptTimeoutMs: null,
      },
      makeDispatchOptions({
        runtimeManager: manager,
        eventSink: {
          emit: (event) => {
            emittedEvents.push(event);
          },
          flush: async () => {
            eventCountsAtFlush.push(emittedEvents.length);
          },
        },
      }),
    );

    expect(emittedEvents).toHaveLength(1);
    expect(eventCountsAtFlush).toEqual([1]);
    const event = emittedEvents[0]?.event;
    if (!event || event.type !== "system/thread-provisioning") {
      throw new Error("Expected thread provisioning event");
    }
    const entryKeys = event.entries.map((entry) => entry.key);
    expect(entryKeys).toEqual([
      "setup-output-0",
      "setup-output-1",
      "setup-output-2",
      "workspace-path",
      "workspace-branch",
    ]);
  });

  it("flushes live events before surfacing provisioning failures", async () => {
    const emittedEvents: EventSinkInput[] = [];
    let flushCount = 0;
    const manager = new RuntimeManager({
      provisionWorkspace: async (options) => {
        options.onProgress?.({
          type: "step",
          key: "git-checkout-started",
          text: "Switching to branch bb/failure",
          status: "started",
          startedAt: Date.now(),
        });
        throw new WorkspaceError("git_command_failed", "git checkout failed");
      },
      createRuntime: () => createFakeRuntime().runtime,
    });

    await expect(() =>
      dispatchCommand(
        {
          type: "environment.attach",
          environmentId: "env-failure",
          initiator: {
            threadId: "thr-failure",
            provisioningId: "tpv-failure",
          },
          path: "/tmp/failure",
          setupScriptTimeoutMs: null,
        },
        makeDispatchOptions({
          runtimeManager: manager,
          eventSink: {
            emit: (event) => {
              emittedEvents.push(event);
            },
            flush: async () => {
              flushCount += 1;
            },
          },
        }),
      ),
    ).rejects.toThrow("git checkout failed");

    expect(emittedEvents).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ environmentId: "env-failure" }),
        threadId: "thr-failure",
      }),
    ]);
    expect(flushCount).toBe(1);
  });

  it("streams the workspace steps when a re-provision of an existing environment does no work", async () => {
    const harness = createHarness({ workspacePath: "/tmp/idempotent" });
    const sourcePath = await makeTempDir("bb-dispatch-idempotent-");
    const emittedEvents: EventSinkInput[] = [];

    await dispatchCommand(
      {
        type: "environment.attach",
        environmentId: "env-idempotent",
        initiator: null,
        path: sourcePath,
        setupScriptTimeoutMs: null,
      },
      harness.dispatchOptions(),
    );

    const result = await dispatchCommand(
      {
        type: "environment.attach",
        environmentId: "env-idempotent",
        initiator: {
          threadId: "thr-second",
          provisioningId: "tpv-second",
        },
        path: sourcePath,
        setupScriptTimeoutMs: null,
      },
      makeDispatchOptions({
        runtimeManager: harness.manager,
        eventSink: {
          emit: (event) => {
            emittedEvents.push(event);
          },
          flush: async () => undefined,
        },
      }),
    );

    expect(result.path).toBe(sourcePath);
    expect(streamedEntries(emittedEvents)).toEqual([
      expect.objectContaining({
        key: "workspace-path",
        text: `Using workspace: ${sourcePath}`,
      }),
      expect.objectContaining({
        key: "workspace-branch",
        text: expect.stringContaining("Using branch: main"),
      }),
    ]);
  });
});
