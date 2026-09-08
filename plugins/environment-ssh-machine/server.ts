import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { sshDestinationSchema } from "bb-machine-ssh/configuration";
import { sshMachineInputsSchema } from "./configuration.js";
import { sshMachineRpcContract } from "./contract.js";
import { SSH_MACHINE_PROVIDER_ID } from "./provider-id.js";
import { readSshHostAliases } from "./ssh-config.js";
import { uninstallCommand } from "bb-machine-ssh/uninstall";
import {
  openSshRunner,
  type SshExecRequest,
  type SshRunner,
} from "bb-machine-ssh/ssh-runner";

const resourceSchema = z
  .object({
    version: z.literal(1),
    key: z.string().min(1),
    target: sshDestinationSchema,
    hostId: z.string().min(1),
  })
  .strict();

const launchSchema = resourceSchema.extend({
  hostId: z.string().min(1).nullable(),
  bootstrapStarted: z.boolean().default(true),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSshMachinePlugin(deps: {
  ssh: SshRunner;
  listTargets: () => Promise<string[]>;
}) {
  return async (bb: BbPluginApi) => {
    bb.rpc.register(sshMachineRpcContract, {
      listTargets: () => deps.listTargets(),
    });
    bb.experimental_machines.register({
      id: SSH_MACHINE_PROVIDER_ID,
      displayName: "SSH machine",
      icon: "Terminal",
      inputs: sshMachineInputsSchema,
      policy: {
        idleSuspendMs: null,
        retire: { after: "never" },
        removeRetryMs: 60_000,
      },
      async availability() {
        return (await deps.ssh.available())
          ? { status: "available" }
          : {
              status: "setup-required",
              message: "Install OpenSSH on the bb server machine.",
            };
      },
      async create(context) {
        try {
          context.signal.throwIfAborted();
          const target = sshMachineInputsSchema.parse(context.inputs).target;
          const storageKey = `launch:${context.key}`;
          const stored = await bb.storage.kv.get(storageKey);
          let bootstrapStarted = false;
          if (stored !== undefined) {
            const resource = launchSchema.parse(stored);
            bootstrapStarted = resource.bootstrapStarted;
            if (resource.target !== target || resource.key !== context.key) {
              return {
                status: "failed",
                failure: "terminal",
                message: "SSH launch key already belongs to another target.",
              };
            }
            if (resource.hostId !== null) {
              const completed = {
                version: 1,
                key: resource.key,
                target: resource.target,
                hostId: resource.hostId,
              };
              await context.checkpoint(completed);
              context.signal.throwIfAborted();
              return {
                status: "created",
                hostId: resource.hostId,
                resource: completed,
              };
            }
          }
          await bb.storage.kv.set(storageKey, {
            version: 1,
            key: context.key,
            target,
            hostId: null,
            bootstrapStarted,
          });
          const enrollment = await bb.experimental_machines.prepareEnrollment({
            key: context.key,
          });
          const resource = {
            version: 1,
            key: context.key,
            target,
            hostId: enrollment.hostId,
          };
          await context.checkpoint(resource);
          context.signal.throwIfAborted();
          await bb.storage.kv.set(storageKey, {
            ...resource,
            hostId: null,
            bootstrapStarted: true,
          });
          context.signal.throwIfAborted();
          context.report.step(`Connecting to SSH target ${target}…`);
          const { hostId } = await bb.experimental_machines.bootstrap({
            key: context.key,
            executor: {
              exec: (request: SshExecRequest) => deps.ssh.exec(target, request),
            },
            daemon: { kind: "install" },
            report: context.report,
            signal: context.signal,
          });
          if (hostId !== resource.hostId)
            throw new Error("SSH bootstrap returned another machine identity.");
          await bb.storage.kv.set(storageKey, resource);
          return { status: "created", hostId, resource };
        } catch (error) {
          if (context.signal.aborted) throw error;
          return {
            status: "failed",
            failure: error instanceof z.ZodError ? "terminal" : "transient",
            message: errorMessage(error),
          };
        }
      },
      async experimental_reconcileCleanup() {
        return { status: "removed" };
      },
      async remove(context) {
        try {
          const resource = resourceSchema.parse(context.resource);
          if (resource.hostId !== context.hostId)
            throw new Error("SSH resource belongs to another machine.");
          const storageKey = `launch:${resource.key}`;
          const stored = await bb.storage.kv.get(storageKey);
          if (stored !== undefined) {
            const launch = launchSchema.parse(stored);
            if (
              launch.target !== resource.target ||
              launch.key !== resource.key ||
              (launch.hostId !== null && launch.hostId !== resource.hostId)
            )
              throw new Error(
                "SSH launch belongs to another machine or target.",
              );
            if (launch.hostId === null && !launch.bootstrapStarted) {
              await bb.storage.kv.delete(storageKey);
              return { status: "removed" };
            }
          }
          context.report.step(
            `Stopping and uninstalling bb on ${resource.target}…`,
          );
          const result = await deps.ssh.exec(resource.target, {
            command: uninstallCommand(context.hostId),
            timeoutMs: 120_000,
            signal: context.signal,
          });
          if (result.exitCode !== 0)
            throw new Error(
              `SSH uninstall exited ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`,
            );
          await bb.storage.kv.delete(storageKey);
          return { status: "removed" };
        } catch (error) {
          if (context.signal.aborted) throw error;
          return { status: "failed", message: errorMessage(error) };
        }
      },
    });
  };
}

export default createSshMachinePlugin({
  ssh: openSshRunner,
  listTargets: readSshHostAliases,
});
