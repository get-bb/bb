import type { BbPluginApi, MachineExecutorRequest } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { openSshRunner, type SshRunner } from "bb-machine-ssh/ssh-runner";
import { uninstallCommand } from "bb-machine-ssh/uninstall";
import { sshDestinationSchema } from "bb-machine-ssh/configuration";
import { inputsSchema, tailscaleContract } from "./contract.js";
import { createTailscaleClient, type TailscaleClient } from "./tailscale.js";
import { registerAccess } from "./server-access.js";

const resourceSchema = inputsSchema
  .extend({
    version: z.literal(1),
    key: z.string(),
    target: sshDestinationSchema,
    hostId: z.string(),
  })
  .strict();
const launchSchema = resourceSchema.extend({
  started: z.boolean(),
  completed: z.boolean(),
});
function message(error: unknown) {
  return error instanceof z.ZodError
    ? "Invalid Tailscale machine data."
    : error instanceof Error
      ? error.message
      : "Tailscale machine operation failed.";
}
function withNode(
  request: MachineExecutorRequest,
  directory: string | null,
): MachineExecutorRequest {
  if (directory === null) return request;
  return {
    ...request,
    command: [
      "sh",
      "-c",
      'PATH="$1:$PATH"; export PATH; shift; exec "$@"',
      "bb-node",
      directory,
      ...request.command,
    ],
  };
}
export function createTailscalePlugin(client: TailscaleClient, ssh: SshRunner) {
  return async (bb: BbPluginApi) => {
    const access = registerAccess(bb, client);
    const devices = async () =>
      (await client.status(AbortSignal.timeout(15_000))).devices.slice(0, 1000);
    bb.rpc.register(tailscaleContract, {
      devices,
      accessStatus: access.status,
      configure: ({ port }) => access.configure(port),
    });
    bb.cli.register({
      name: "tailscale",
      summary: "Discover tailnet machines and verify private server access",
      commands: [
        {
          name: "devices",
          summary: "List tailnet machine candidates as JSON",
          usage: "bb tailscale devices",
        },
        {
          name: "status",
          summary: "Check this instance's private endpoint",
          usage: "bb tailscale status",
        },
        {
          name: "configure",
          summary: "Validate an existing dedicated HTTPS Serve mapping",
          usage: "bb tailscale configure <port>",
        },
      ],
      async run(argv) {
        try {
          const result =
            argv.length === 1 && argv[0] === "devices"
              ? await devices()
              : argv.length === 1 && argv[0] === "status"
                ? await access.status()
                : argv.length === 2 &&
                    argv[0] === "configure" &&
                    /^\d+$/.test(argv[1])
                  ? await access.configure(Number(argv[1]))
                  : null;
          if (result === null)
            throw new Error(
              "Usage: bb tailscale devices | status | configure <port>",
            );
          return { exitCode: 0, stdout: JSON.stringify(result, null, 2) };
        } catch (error) {
          return { exitCode: 1, stderr: message(error) };
        }
      },
    });
    const locks = new Map<string, Promise<unknown>>();
    async function serialize<T>(
      id: string,
      work: () => Promise<T>,
    ): Promise<T> {
      const previous = locks.get(id) ?? Promise.resolve();
      const current = previous.catch(() => {}).then(work);
      locks.set(id, current);
      try {
        return await current;
      } finally {
        if (locks.get(id) === current) locks.delete(id);
      }
    }
    bb.experimental_machines.register({
      id: "tailscale",
      displayName: "Tailscale machine",
      icon: "./tailscale-logo.svg",
      inputs: inputsSchema,
      policy: {
        idleSuspendMs: null,
        retire: { after: "never" },
        removeRetryMs: 60_000,
      },
      async availability() {
        try {
          await client.status(AbortSignal.timeout(15_000));
          if (!(await ssh.available()))
            throw new Error("Install OpenSSH on the bb server machine.");
          return { status: "available" };
        } catch (error) {
          return { status: "setup-required", message: message(error) };
        }
      },
      async create(context) {
        const inputs = inputsSchema.parse(context.inputs);
        return serialize(inputs.deviceId, async () => {
          try {
            context.signal.throwIfAborted();
            const state = await client.status(context.signal);
            const device = state.devices.find((d) => d.id === inputs.deviceId);
            if (!device?.online)
              throw new Error(
                "The selected tailnet device is offline or no longer available. Refresh the device picker.",
              );
            const target = sshDestinationSchema.parse(
              `${inputs.username}@${device.dnsName}`,
            );
            const storageKey = `launch:${context.key}`;
            const stored = await bb.storage.kv.get(storageKey);
            let launch =
              stored === undefined ? null : launchSchema.parse(stored);
            if (
              launch &&
              (launch.deviceId !== inputs.deviceId ||
                launch.username !== inputs.username ||
                launch.nodeDirectory !== inputs.nodeDirectory ||
                launch.accessProviderId !== inputs.accessProviderId ||
                launch.target !== target)
            )
              return {
                status: "failed",
                failure: "terminal",
                message:
                  "This launch key belongs to another target or configuration.",
              };
            const ownerKey = `device:${inputs.deviceId}`;
            const owner = await bb.storage.kv.get(ownerKey);
            if (owner !== undefined && owner !== context.key)
              return {
                status: "failed",
                failure: "terminal",
                message:
                  "This device already belongs to a Tailscale machine. Remove that machine before enrolling it again.",
              };
            const exec = (request: MachineExecutorRequest) =>
              ssh.exec(target, withNode(request, inputs.nodeDirectory));
            const probe = await exec({
              command: [
                "sh",
                "-c",
                "if ! command -v node >/dev/null || ! command -v npm >/dev/null; then exit 42; fi; node -e 'const [a,b]=process.versions.node.split(\".\").map(Number);process.exit(a>22||(a===22&&b>=19)?0:42)'",
              ],
              timeoutMs: 15_000,
              signal: context.signal,
            }).catch((error: unknown) => {
              if (context.signal.aborted) throw error;
              throw new Error(
                "SSH prerequisite check could not complete. Check the device connection and SSH access, then retry.",
              );
            });
            if (probe.exitCode !== 0 && probe.exitCode !== 42)
              return {
                status: "failed",
                failure: "transient",
                message:
                  "SSH prerequisite check could not complete. Check the device connection and SSH access, then retry.",
              };
            if (probe.exitCode === 42)
              return {
                status: "failed",
                failure: "terminal",
                message:
                  "Setup required: Node 22.19+ and npm must be available over SSH. Install them first or supply their absolute bin directory.",
              };
            const selection =
              inputs.accessProviderId === "default"
                ? undefined
                : { providerId: "tailscale" };
            const enrollment = await bb.experimental_machines.prepareEnrollment(
              { key: context.key, access: selection },
            );
            const resource = {
              version: 1 as const,
              key: context.key,
              ...inputs,
              target,
              hostId: enrollment.hostId,
            };
            if (launch && launch.hostId !== resource.hostId)
              throw new Error(
                "Tailscale enrollment returned another identity.",
              );
            launch = {
              ...resource,
              started: launch?.started ?? false,
              completed: launch?.completed ?? false,
            };
            await bb.storage.kv.set(storageKey, launch);
            await bb.storage.kv.set(ownerKey, context.key);
            await context.checkpoint(resource);
            context.signal.throwIfAborted();
            if (!launch.completed) {
              await bb.storage.kv.set(storageKey, { ...launch, started: true });
              context.signal.throwIfAborted();
              context.report.step(`Enrolling ${device.label} over SSH…`);
              const result = await bb.experimental_machines.bootstrap({
                key: context.key,
                access: selection,
                executor: { exec },
                daemon: { kind: "install" },
                report: context.report,
                signal: context.signal,
              });
              if (result.hostId !== resource.hostId)
                throw new Error(
                  "Tailscale bootstrap returned another identity.",
                );
              await bb.storage.kv.set(storageKey, {
                ...launch,
                started: true,
                completed: true,
              });
            }
            return { status: "created", hostId: resource.hostId, resource };
          } catch (error) {
            if (context.signal.aborted) throw error;
            return {
              status: "failed",
              failure: "transient",
              message: message(error),
            };
          }
        });
      },
      async experimental_reconcileCleanup(context) {
        const storageKey = `launch:${context.key}`;
        const stored = await bb.storage.kv.get(storageKey);
        if (stored === undefined) return { status: "removed" };
        const launch = launchSchema.parse(stored);
        return serialize(launch.deviceId, async () => {
          context.signal.throwIfAborted();
          const current = await bb.storage.kv.get(storageKey);
          if (current === undefined) return { status: "removed" };
          const reservation = launchSchema.parse(current);
          if (reservation.key !== context.key || reservation.started)
            return {
              status: "failed",
              message:
                "Bootstrap may have started. Recover the saved machine checkpoint before cleanup.",
            };
          const ownerKey = `device:${reservation.deviceId}`;
          if ((await bb.storage.kv.get(ownerKey)) === context.key)
            await bb.storage.kv.delete(ownerKey);
          await bb.storage.kv.delete(storageKey);
          return { status: "removed" };
        });
      },
      async remove(context) {
        try {
          const resource = resourceSchema.parse(context.resource);
          if (resource.hostId !== context.hostId)
            throw new Error("Tailscale resource belongs to another machine.");
          return await serialize(resource.deviceId, async () => {
            const key = `launch:${resource.key}`;
            const stored = await bb.storage.kv.get(key);
            const launch =
              stored === undefined ? null : launchSchema.parse(stored);
            if (
              launch &&
              (launch.hostId !== context.hostId ||
                launch.target !== resource.target ||
                launch.deviceId !== resource.deviceId)
            )
              throw new Error("Tailscale launch identity mismatch.");
            if (launch?.started !== false) {
              const device = (await client.status(context.signal)).devices.find(
                (d) => d.id === resource.deviceId,
              );
              if (
                !device?.online ||
                `${resource.username}@${device.dnsName}` !== resource.target
              )
                throw new Error(
                  "Original tailnet device is unavailable. Cleanup will retry.",
                );
              const result = await ssh.exec(
                resource.target,
                withNode(
                  {
                    command: uninstallCommand(context.hostId),
                    timeoutMs: 120_000,
                    signal: context.signal,
                  },
                  resource.nodeDirectory,
                ),
              );
              if (result.exitCode !== 0)
                throw new Error(
                  "Identity-checked bb uninstall failed. Cleanup will retry.",
                );
            }
            const ownerKey = `device:${resource.deviceId}`;
            if ((await bb.storage.kv.get(ownerKey)) === resource.key)
              await bb.storage.kv.delete(ownerKey);
            await bb.storage.kv.delete(key);
            return { status: "removed" };
          });
        } catch (error) {
          if (context.signal.aborted) throw error;
          return { status: "failed", message: message(error) };
        }
      },
    });
  };
}
export default createTailscalePlugin(createTailscaleClient(), openSshRunner);
