import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type {
  JsonValue,
  MachineBootstrapRequest,
  MachineEnrollmentRequest,
} from "@get-bb/plugin-sdk";
import type { PluginMachineProviderCreateContext } from "@get-bb/plugin-sdk/machine-provider";
import type { SshExecRequest } from "bb-machine-ssh/ssh-runner";
import { createTailscalePlugin } from "./server.js";
import { inputsSchema } from "./contract.js";
import { parseStatus } from "./tailscale.js";

const dispose: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(dispose.splice(0).map((f) => f()));
});
async function setup() {
  const f = createFakePluginHost({
    pluginId: "machine-tailscale",
    loopbackBaseUrl: "http://127.0.0.1:23354",
  });
  dispose.push(() => f.harness.lifecycle.dispose());
  const state = parseStatus(
    JSON.stringify({
      BackendState: "Running",
      Self: {
        ID: "self",
        HostName: "Server",
        DNSName: "server.example.ts.net",
        OS: "macOS",
        Online: true,
        TailscaleIPs: [],
      },
      Peer: {
        a: {
          ID: "peer",
          HostName: "Mac",
          DNSName: "mac.example.ts.net",
          OS: "macOS",
          Online: true,
          TailscaleIPs: [],
        },
      },
    }),
  );
  const status = vi.fn(async () => state);
  const serveStatus = vi.fn(async () =>
    JSON.stringify({
      TCP: { "8443": { HTTPS: true } },
      Web: {
        "server.example.ts.net:8443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:23354" } },
        },
      },
    }),
  );
  const exec = vi.fn(async (_target: string, _req: SshExecRequest) => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
  }));
  const prepareEnrollment = vi.fn(async (_req: MachineEnrollmentRequest) => ({
    hostId: "host_test",
  }));
  const bootstrap = vi.fn(async (_req: MachineBootstrapRequest) => ({
    hostId: "host_test",
  }));
  Object.assign(f.bb.experimental_machines, { prepareEnrollment, bootstrap });
  await createTailscalePlugin(
    { status, serveStatus },
    { available: async () => true, exec },
  )(f.bb);
  const provider = f.harness.registrations.machineProviders.get("tailscale");
  const access = f.harness.registrations.serverAccessProviders.get("tailscale");
  if (!provider || !access) throw new Error("Missing registrations");
  const checkpoint = vi.fn(async (_r: JsonValue) => {});
  const context: PluginMachineProviderCreateContext<{}, typeof inputsSchema> = {
    key: "launch",
    attempt: 1,
    project: null,
    gitRemote: null,
    inputs: {
      deviceId: "peer",
      username: "dev",
      nodeDirectory: null,
      accessProviderId: "tailscale",
    },
    checkpoint,
    report: { step() {}, log() {} },
    signal: new AbortController().signal,
  };
  return {
    ...f,
    state,
    status,
    serveStatus,
    exec,
    prepareEnrollment,
    bootstrap,
    provider,
    access,
    context,
    checkpoint,
  };
}
describe("Tailscale lifecycle and access", () => {
  it("checkpoints before bootstrap, reuses identity and passes access consistently", async () => {
    const f = await setup();
    f.bootstrap.mockImplementationOnce(async () => {
      expect(f.checkpoint).toHaveBeenCalledOnce();
      return { hostId: "host_test" };
    });
    const first = await f.provider.create(f.context);
    expect(first.status).toBe("created");
    expect(await f.provider.create(f.context)).toEqual(first);
    expect(f.bootstrap).toHaveBeenCalledOnce();
    expect(f.prepareEnrollment).toHaveBeenCalledWith({
      key: "launch",
      access: { providerId: "tailscale" },
    });
    expect(f.bootstrap.mock.calls[0][0].access).toEqual({
      providerId: "tailscale",
    });
    expect(JSON.stringify(first)).not.toContain("credential");
  });
  it("reserves physical devices across concurrent launch keys and refuses target edits", async () => {
    const f = await setup();
    const results = await Promise.all([
      f.provider.create(f.context),
      f.provider.create({ ...f.context, key: "other" }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["created", "failed"]);
    expect(f.bootstrap).toHaveBeenCalledOnce();
    expect(
      await f.provider.create({
        ...f.context,
        inputs: { ...f.context.inputs, username: "other" },
      }),
    ).toMatchObject({ status: "failed", failure: "terminal" });
  });
  it("reports missing Node before enrollment or remote installation", async () => {
    const f = await setup();
    f.exec.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" });
    expect(await f.provider.create(f.context)).toMatchObject({
      status: "failed",
      failure: "terminal",
      message: expect.stringContaining("Node 22.19+"),
    });
    expect(f.prepareEnrollment).not.toHaveBeenCalled();
    expect(f.bootstrap).not.toHaveBeenCalled();
  });
  it("does not bootstrap or uninstall when cancelled at a fresh checkpoint", async () => {
    const f = await setup();
    const controller = new AbortController();
    f.checkpoint.mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(
      f.provider.create({ ...f.context, signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(f.bootstrap).not.toHaveBeenCalled();
    f.exec.mockClear();
    expect(
      await f.provider.remove({
        hostId: "host_test",
        resource: f.checkpoint.mock.calls[0][0],
        signal: f.context.signal,
        report: f.context.report,
      }),
    ).toEqual({ status: "removed" });
    expect(f.exec).not.toHaveBeenCalled();
  });
  it("retains installation ownership after a failed bootstrap and cancelled retry", async () => {
    const f = await setup();
    f.bootstrap.mockRejectedValueOnce(new Error("failed"));
    await f.provider.create(f.context);
    const controller = new AbortController();
    f.checkpoint.mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(
      f.provider.create({ ...f.context, signal: controller.signal }),
    ).rejects.toBeDefined();
    f.exec.mockClear();
    const remove = {
      hostId: "host_test",
      resource: f.checkpoint.mock.calls[0][0],
      signal: f.context.signal,
      report: f.context.report,
    };
    f.exec.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "do not echo remote output",
    });
    expect(await f.provider.remove(remove)).toMatchObject({ status: "failed" });
    expect(await f.bb.storage.kv.get("launch:launch")).toBeDefined();
    expect(await f.provider.remove(remove)).toEqual({ status: "removed" });
    expect(await f.bb.storage.kv.get("device:peer")).toBeUndefined();
  });
  it("refuses stale remote identity during removal", async () => {
    const f = await setup();
    const created = await f.provider.create(f.context);
    if (created.status !== "created") throw new Error("failed");
    f.state.devices[0].dnsName = "replacement.example.ts.net";
    f.exec.mockClear();
    expect(
      await f.provider.remove({
        ...created,
        signal: f.context.signal,
        report: f.context.report,
      }),
    ).toMatchObject({ status: "failed" });
    expect(f.exec).not.toHaveBeenCalled();
  });
  it("delivers optional Node PATH and private stdin without changing argv or leaking it", async () => {
    const f = await setup();
    await f.provider.create({
      ...f.context,
      inputs: { ...f.context.inputs, nodeDirectory: "/home/dev/my node/bin" },
    });
    await f.bootstrap.mock.calls[0][0].executor.exec({
      command: ["sh", "-c", "read secret"],
      stdin: "private-bundle",
      timeoutMs: 100,
      signal: f.context.signal,
    });
    const req = f.exec.mock.lastCall?.[1];
    expect(req?.stdin).toBe("private-bundle");
    expect(req?.command).toContain("/home/dev/my node/bin");
    expect(req?.command.join(" ")).not.toContain("private-bundle");
  });
  it("validates explicit endpoints through CLI/RPC, detects drift, never tears down shared Serve", async () => {
    const f = await setup();
    expect(await f.access.availability()).toMatchObject({
      status: "setup-required",
    });
    expect(
      (await f.harness.behavior.runCli(["configure", "8443"])).exitCode,
    ).toBe(0);
    expect(
      await f.harness.behavior.callRpc("accessStatus", null),
    ).toMatchObject({
      available: true,
      serverUrl: "https://server.example.ts.net:8443",
    });
    const grant = await f.access.acquire({
      key: "launch",
      hostId: "host_test",
      signal: f.context.signal,
    });
    expect(grant).toEqual({
      id: "host_test",
      serverUrl: "https://server.example.ts.net:8443",
      client: { kind: "direct" },
    });
    await f.access.release({ key: "launch", grantId: grant.id });
    expect(await f.access.availability()).toEqual({ status: "available" });
    f.serveStatus.mockResolvedValue("{}");
    expect(await f.access.availability()).toMatchObject({
      status: "setup-required",
    });
    await expect(
      f.access.acquire({
        key: "launch",
        hostId: "host_test",
        signal: f.context.signal,
      }),
    ).rejects.toThrow();
  });
});
