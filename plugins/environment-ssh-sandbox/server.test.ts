import type { JsonValue } from "@get-bb/plugin-sdk";
import type {
  PluginMachineProviderCreateContext,
  PluginMachineProviderProgress,
} from "@get-bb/plugin-sdk/machine-provider";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { PROVIDER_ID } from "./provider-id.js";
import { createSshSandboxPlugin } from "./server.js";
import type { SshChildProcess, SshSpawner } from "./ssh-executor.js";

const PLUGIN_ID = "environment-ssh-sandbox";
const HOST_ID = "host_ssh";
const report: PluginMachineProviderProgress = {
  step() {},
  log() {},
};

class FakeChild extends EventEmitter {
  stdinChunks: string[] = [];
  readonly stdin = {
    write: (chunk: string): boolean => {
      this.stdinChunks.push(chunk);
      return true;
    },
    end: (): void => {},
  };
  readonly stdout = this as unknown as SshChildProcess["stdout"];
  readonly stderr = this as unknown as SshChildProcess["stderr"];
  kill(): boolean {
    return true;
  }
}

function createContext(inputs: JsonValue): PluginMachineProviderCreateContext {
  return {
    inputs,
    key: "ssh-key",
    attempt: 1,
    report,
    signal: new AbortController().signal,
    checkpoint: vi.fn(async (_resource: JsonValue) => {}),
  };
}

async function setup(options: {
  sshPath?: string | null;
  identityReadable?: boolean;
  exitCode?: number;
  output?: string;
  spawnError?: Error;
}) {
  const spawned: { command: string; args: readonly string[] }[] = [];
  const spawn: SshSpawner = (command, args) => {
    spawned.push({ command, args });
    const child = new FakeChild();
    queueMicrotask(() => {
      if (options.spawnError !== undefined) {
        child.emit("error", options.spawnError);
        return;
      }
      if (options.output !== undefined) child.emit("data", options.output);
      child.emit("close", options.exitCode ?? 0, null);
    });
    return child;
  };
  const bootstrap = vi.fn(async () => ({ hostId: HOST_ID }));
  const fake = createFakePluginHost({
    pluginId: PLUGIN_ID,
    machineBootstrap: { bootstrap },
    settings: {
      identityFile: "",
      knownHosts: "accept-new",
      connectTimeoutSeconds: 15,
    },
  });
  await createSshSandboxPlugin({
    spawn,
    resolveSsh: () =>
      options.sshPath === undefined ? "/usr/bin/ssh" : options.sshPath,
    identityReadable: async () => options.identityReadable !== false,
    now: () => 1_000,
  })(fake.bb);
  const provider = fake.harness.registrations.machineProviders.get(PROVIDER_ID);
  if (provider === undefined) throw new Error("machine provider missing");
  return { ...fake, provider, bootstrap, spawned };
}

describe("SSH sandbox plugin", () => {
  it("is unavailable when ssh is missing", async () => {
    const harness = await setup({ sshPath: null });
    await expect(harness.provider.availability?.()).resolves.toEqual({
      status: "unavailable",
      message: "ssh is not installed on the bb server PATH.",
    });
  });

  it("refuses an injectable destination", async () => {
    const harness = await setup({});
    await expect(
      harness.provider.validate?.({
        inputs: { destination: "-oProxyCommand=evil" },
      }),
    ).resolves.toMatchObject({ action: "refuse" });
  });

  it("probes then bootstraps over SSH without putting secrets in argv", async () => {
    const harness = await setup({});
    const checkpoint = vi.fn(async (_resource: JsonValue) => {});
    const log = vi.fn();
    const result = await harness.provider.create({
      ...createContext({ destination: "ubuntu@sandbox", port: 2222 }),
      checkpoint,
      report: { step: vi.fn(), log },
    });
    expect(result).toEqual({
      status: "created",
      name: "ubuntu@sandbox:2222",
      resource: { destination: "ubuntu@sandbox", port: 2222 },
    });
    expect(checkpoint).toHaveBeenCalledWith({
      destination: "ubuntu@sandbox",
      port: 2222,
    });
    expect(harness.bootstrap).toHaveBeenCalledTimes(1);
    expect(harness.spawned).toHaveLength(1);
    expect(harness.spawned[0]?.args.join(" ")).toContain("ubuntu@sandbox");
    expect(harness.spawned[0]?.args.join(" ")).not.toContain("bootstrap");
    expect(log.mock.calls.flat().join("")).toContain(
      "SSH daemon connected in 0 ms",
    );
  });

  it("fails create when the host lacks node", async () => {
    const harness = await setup({
      exitCode: 1,
      output: "node: not found\n",
    });
    await expect(
      harness.provider.create(createContext({ destination: "ubuntu@sandbox" })),
    ).resolves.toMatchObject({
      status: "failed",
      message: expect.stringContaining("node: not found"),
    });
    expect(harness.bootstrap).not.toHaveBeenCalled();
  });

  it("registers a project-checkout composition", async () => {
    const harness = await setup({});
    expect(
      harness.harness.registrations.environmentCompositions.get(PROVIDER_ID),
    ).toMatchObject({
      machineProviderId: PROVIDER_ID,
      environmentProviderId: "project-checkout",
    });
  });

  it("probes through CLI and RPC", async () => {
    const harness = await setup({});
    await expect(
      harness.harness.runCli([
        "probe",
        "--destination",
        "ubuntu@sandbox",
        "--json",
      ]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: JSON.stringify({
        ok: true,
        message: "Reached ubuntu@sandbox with node, npm, and curl.",
      }),
    });
    await expect(
      harness.harness.callRpc("ssh.probe", { destination: "ubuntu@sandbox" }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("treats remove as a no-op because the remote host is user-owned", async () => {
    const harness = await setup({});
    await expect(
      harness.provider.remove({
        hostId: HOST_ID,
        resource: { destination: "ubuntu@sandbox" },
        report,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ status: "removed" });
    await expect(
      harness.provider.reconcileCleanup({
        key: "ssh-key",
        report,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ status: "removed" });
  });
});
