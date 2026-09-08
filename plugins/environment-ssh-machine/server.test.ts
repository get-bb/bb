import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { JsonValue } from "@get-bb/plugin-sdk";
import type { PluginMachineProviderCreateContext } from "@get-bb/plugin-sdk/machine-provider";
import { createSshMachinePlugin } from "./server.js";
import { sshMachineInputsSchema } from "./configuration.js";
import type { SshExecRequest } from "./ssh-runner.js";
import { uninstallCommand } from "./uninstall.js";

const dispose: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(dispose.splice(0).map((fn) => fn()));
});

async function setup() {
  const { bb, harness } = createFakePluginHost();
  dispose.push(() => harness.lifecycle.dispose());
  const exec = vi.fn(async (_target: string, _request: SshExecRequest) => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
  }));
  const bootstrap = vi.fn(
    async (_request: {
      key: string;
      executor: {
        exec(
          request: SshExecRequest,
        ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
      };
      daemon: { kind: "install" };
      report: { step(text: string): void; log(text: string): void };
      signal: AbortSignal;
    }) => ({ hostId: "host_ssh" }),
  );
  const prepareEnrollment = vi.fn(async (_request: { key: string }) => ({
    hostId: "host_ssh",
  }));
  const checkpoint = vi.fn(async (_resource: JsonValue) => {});
  Object.assign(bb.experimental_machines, { bootstrap, prepareEnrollment });
  await createSshMachinePlugin({
    ssh: { available: async () => true, exec },
    listTargets: async () => [],
  })(bb);
  const provider = harness.registrations.machineProviders.get("ssh-machine");
  if (provider === undefined) throw new Error("Provider not registered");
  const context: PluginMachineProviderCreateContext<
    {},
    typeof sshMachineInputsSchema
  > & { checkpoint(resource: JsonValue): Promise<void> } = {
    key: "launch_one",
    attempt: 1,
    project: null,
    gitRemote: null,
    inputs: { target: "dev@box" },
    signal: new AbortController().signal,
    report: { step() {}, log() {} },
    checkpoint,
  };
  return {
    bb,
    harness,
    exec,
    bootstrap,
    prepareEnrollment,
    checkpoint,
    provider,
    context,
  };
}

describe("SSH machine provider", () => {
  it("uses bootstrap over SSH and replays completed launches without reinstalling", async () => {
    const f = await setup();
    const first = await f.provider.create(f.context);
    expect(first).toEqual({
      status: "created",
      hostId: "host_ssh",
      resource: {
        version: 1,
        key: "launch_one",
        target: "dev@box",
        hostId: "host_ssh",
      },
    });
    expect(await f.provider.create(f.context)).toEqual(first);
    expect(f.bootstrap).toHaveBeenCalledOnce();
    const args = f.bootstrap.mock.calls[0][0];
    expect(args.daemon).toEqual({ kind: "install" });
    expect(args.signal).toBe(f.context.signal);
    await args.executor.exec({
      command: ["true"],
      timeoutMs: 1234,
      signal: f.context.signal,
    });
    expect(f.exec).toHaveBeenCalledWith(
      "dev@box",
      expect.objectContaining({ command: ["true"], timeoutMs: 1234 }),
    );
  });
  it("keeps ownership through a failed bootstrap and rejects changed targets", async () => {
    const f = await setup();
    f.bootstrap.mockRejectedValueOnce(new Error("connection failed"));
    expect(await f.provider.create(f.context)).toMatchObject({
      status: "failed",
      failure: "transient",
    });
    expect(
      await f.provider.create({ ...f.context, inputs: { target: "other" } }),
    ).toMatchObject({ status: "failed", failure: "terminal" });
    expect(f.exec).not.toHaveBeenCalled();
    expect(await f.provider.create(f.context)).toMatchObject({
      status: "created",
      hostId: "host_ssh",
    });
  });
  it("records target ownership and checkpoints allocation before bootstrap", async () => {
    const f = await setup();
    f.prepareEnrollment.mockImplementationOnce(async ({ key }) => {
      expect(await f.bb.storage.kv.get(`launch:${key}`)).toEqual({
        version: 1,
        key,
        target: "dev@box",
        hostId: null,
        bootstrapStarted: false,
      });
      return { hostId: "host_ssh" };
    });
    f.bootstrap.mockImplementationOnce(async () => {
      expect(f.checkpoint).toHaveBeenCalledWith({
        version: 1,
        key: "launch_one",
        target: "dev@box",
        hostId: "host_ssh",
      });
      expect(await f.bb.storage.kv.get("launch:launch_one")).toMatchObject({
        hostId: null,
      });
      return { hostId: "host_ssh" };
    });
    expect(await f.provider.create(f.context)).toMatchObject({
      status: "created",
    });
  });
  it("does not bootstrap when cancellation arrives during the allocation checkpoint", async () => {
    const f = await setup();
    const controller = new AbortController();
    f.checkpoint.mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(
      f.provider.create({ ...f.context, signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(f.prepareEnrollment).toHaveBeenCalledWith({ key: "launch_one" });
    expect(f.checkpoint).toHaveBeenCalledWith({
      version: 1,
      key: "launch_one",
      target: "dev@box",
      hostId: "host_ssh",
    });
    expect(f.bootstrap).not.toHaveBeenCalled();
    expect(await f.bb.storage.kv.get("launch:launch_one")).toMatchObject({
      hostId: null,
    });
    expect(await f.provider.create(f.context)).toMatchObject({
      status: "created",
    });
    expect(f.bootstrap).toHaveBeenCalledOnce();
  });
  it("removes a checkpointed reservation without SSH when bootstrap never started", async () => {
    const f = await setup();
    const controller = new AbortController();
    f.checkpoint.mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(
      f.provider.create({ ...f.context, signal: controller.signal }),
    ).rejects.toBeDefined();
    const resource = f.checkpoint.mock.calls[0]?.[0];
    if (resource === undefined)
      throw new Error("Allocation was not checkpointed");
    expect(
      await f.provider.remove({
        hostId: "host_ssh",
        resource,
        signal: f.context.signal,
        report: f.context.report,
      }),
    ).toEqual({ status: "removed" });
    expect(f.exec).not.toHaveBeenCalled();
    expect(f.bootstrap).not.toHaveBeenCalled();
    expect(await f.bb.storage.kv.get("launch:launch_one")).toBeUndefined();
  });
  it("removes an allocated checkpoint when bootstrap is cancelled before success", async () => {
    const f = await setup();
    const controller = new AbortController();
    f.bootstrap.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error("bootstrap cancelled");
    });
    await expect(
      f.provider.create({ ...f.context, signal: controller.signal }),
    ).rejects.toThrow("bootstrap cancelled");
    const resource = f.checkpoint.mock.calls[0]?.[0];
    if (resource === undefined)
      throw new Error("Allocation was not checkpointed");
    expect(
      await f.provider.remove({
        hostId: "host_ssh",
        resource,
        signal: f.context.signal,
        report: f.context.report,
      }),
    ).toEqual({ status: "removed" });
    expect(f.exec).toHaveBeenCalledOnce();
    expect(await f.bb.storage.kv.get("launch:launch_one")).toBeUndefined();
  });
  it("retains prior installation ownership when a retry is cancelled at its checkpoint", async () => {
    const f = await setup();
    f.bootstrap.mockRejectedValueOnce(new Error("connection failed"));
    expect(await f.provider.create(f.context)).toMatchObject({
      status: "failed",
    });
    const controller = new AbortController();
    f.checkpoint.mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(
      f.provider.create({ ...f.context, signal: controller.signal }),
    ).rejects.toBeDefined();
    const resource = f.checkpoint.mock.calls[1]?.[0];
    if (resource === undefined)
      throw new Error("Allocation was not checkpointed");
    expect(
      await f.provider.remove({
        hostId: "host_ssh",
        resource,
        signal: f.context.signal,
        report: f.context.report,
      }),
    ).toEqual({ status: "removed" });
    expect(f.exec).toHaveBeenCalledOnce();
  });
  it("treats legacy pending records as potentially installed during cleanup", async () => {
    const f = await setup();
    const resource = {
      version: 1,
      key: "launch_one",
      target: "dev@box",
      hostId: "host_ssh",
    };
    await f.bb.storage.kv.set("launch:launch_one", {
      ...resource,
      hostId: null,
    });
    expect(
      await f.provider.remove({
        hostId: "host_ssh",
        resource,
        signal: f.context.signal,
        report: f.context.report,
      }),
    ).toEqual({ status: "removed" });
    expect(f.exec).toHaveBeenCalledOnce();
  });
  it("keeps incomplete checkpoints retryable and rejects a different bootstrap identity", async () => {
    const f = await setup();
    f.bootstrap.mockResolvedValueOnce({ hostId: "host_other" });
    expect(await f.provider.create(f.context)).toMatchObject({
      status: "failed",
    });
    expect(await f.bb.storage.kv.get("launch:launch_one")).toMatchObject({
      hostId: null,
    });
    expect(await f.provider.create(f.context)).toMatchObject({
      status: "created",
      hostId: "host_ssh",
    });
    expect(f.checkpoint).toHaveBeenCalledTimes(2);
  });
  it("does not install if the durable checkpoint fails", async () => {
    const f = await setup();
    f.checkpoint.mockRejectedValueOnce(new Error("checkpoint unavailable"));
    expect(await f.provider.create(f.context)).toMatchObject({
      status: "failed",
    });
    expect(f.bootstrap).not.toHaveBeenCalled();
  });
  it("allows typed targets when config contains no aliases", async () => {
    const f = await setup();
    expect(
      await f.provider.availability?.({ project: null, gitRemote: null }),
    ).toEqual({ status: "available" });
    expect(await f.harness.behavior.callRpc("listTargets", null)).toEqual([]);
    expect(f.provider.policy.retire).toEqual({ after: "never" });
    expect(f.provider.icon).toBe("Terminal");
    expect(f.provider.environmentRow).toBeNull();
    expect(f.provider.suspend).toBeNull();
  });
  it("never uninstalls after bootstrap failure or cancellation", async () => {
    const f = await setup();
    const controller = new AbortController();
    f.bootstrap.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error("cancelled");
    });
    await expect(
      f.provider.create({ ...f.context, signal: controller.signal }),
    ).rejects.toThrow("cancelled");
    expect(f.exec).not.toHaveBeenCalled();
  });
  it("uninstalls using the core ownership-checked command and retains recovery on failure", async () => {
    const f = await setup();
    const created = await f.provider.create(f.context);
    if (created.status !== "created") throw new Error("creation failed");
    const context = {
      hostId: created.hostId,
      resource: created.resource,
      signal: f.context.signal,
      report: f.context.report,
    };
    f.exec.mockResolvedValueOnce({
      exitCode: 2,
      stdout: "",
      stderr: "ownership mismatch",
    });
    expect(await f.provider.remove(context)).toMatchObject({
      status: "failed",
    });
    expect(await f.bb.storage.kv.get("launch:launch_one")).toBeDefined();
    expect(await f.provider.remove(context)).toEqual({ status: "removed" });
    expect(await f.bb.storage.kv.get("launch:launch_one")).toBeUndefined();
    expect(f.exec).toHaveBeenLastCalledWith(
      "dev@box",
      expect.objectContaining({
        command: uninstallCommand("host_ssh"),
      }),
    );
  });
  it("rejects mismatched removal identity without SSH", async () => {
    const f = await setup();
    expect(
      await f.provider.remove({
        hostId: "other",
        resource: {
          version: 1,
          key: "launch_one",
          target: "box",
          hostId: "host_ssh",
        },
        signal: f.context.signal,
        report: f.context.report,
      }),
    ).toMatchObject({ status: "failed" });
    expect(f.exec).not.toHaveBeenCalled();
  });
});
