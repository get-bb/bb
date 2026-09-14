import {
  defineRpcContract,
  type BbPluginApi,
  type MachineExecutor,
} from "@get-bb/plugin-sdk";
import { spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod";
import { SETTING_DESCRIPTORS, parseSettings } from "./configuration.js";
import { errorMessage } from "./error-message.js";
import { PROVIDER_ID } from "./provider-id.js";
import { createSshExecutor, execSsh, type SshSpawner } from "./ssh-executor.js";
import {
  displayTarget,
  sshMachineInputsSchema,
  type SshMachineInputs,
  type SshMachineResource,
  type SshTarget,
  type ResolvedSshSettings,
} from "./target.js";

const PREFLIGHT_COMMAND = [
  "sh",
  "-c",
  "command -v node >/dev/null && command -v npm >/dev/null && command -v curl >/dev/null && command -v sh >/dev/null",
];

const probeOutputSchema = z
  .object({
    ok: z.boolean(),
    message: z.string(),
  })
  .strict();

export const sshSandboxRpcContract = defineRpcContract({
  "ssh.probe": {
    input: sshMachineInputsSchema,
    output: probeOutputSchema,
  },
});

export interface SshSandboxDeps {
  spawn: SshSpawner;
  resolveSsh: () => string | null;
  identityReadable: (path: string) => Promise<boolean>;
  now: () => number;
}

export function defaultResolveSsh(): string | null {
  try {
    const result = spawnSync("ssh", ["-V"], {
      encoding: "utf8",
      timeout: 3000,
    });
    return result.error ? null : "ssh";
  } catch {
    return null;
  }
}

const defaultSpawn: SshSpawner = (command, args) =>
  spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"] });

async function defaultIdentityReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function missingSshMessage(): string {
  return "ssh is not installed on the bb server PATH.";
}

export function createSshSandboxPlugin(
  deps: SshSandboxDeps,
): (bb: BbPluginApi) => Promise<void> {
  return async (bb) => {
    const settings = bb.settings.define(SETTING_DESCRIPTORS);

    async function currentSettings(): Promise<ResolvedSshSettings> {
      return parseSettings(await settings.get());
    }

    async function resolveTarget(inputs: SshMachineInputs): Promise<SshTarget> {
      const sshPath = deps.resolveSsh();
      if (sshPath === null) throw new Error(missingSshMessage());
      const resolved = await currentSettings();
      if (
        resolved.identityFile !== null &&
        !(await deps.identityReadable(resolved.identityFile))
      ) {
        throw new Error(
          `SSH identity file is not readable: ${resolved.identityFile}`,
        );
      }
      return {
        destination: inputs.destination,
        port: inputs.port,
        sshPath,
        ...resolved,
      };
    }

    async function probe(
      target: SshTarget,
      signal: AbortSignal,
    ): Promise<{ ok: boolean; message: string }> {
      const output: string[] = [];
      try {
        const result = await execSsh(target, deps.spawn, {
          command: PREFLIGHT_COMMAND,
          stdin: "",
          timeoutMs: Math.max(target.connectTimeoutSeconds * 1000, 15_000),
          signal,
          onOutput(chunk) {
            output.push(chunk);
          },
        });
        if (result.exitCode === 0) {
          return {
            ok: true,
            message: `Reached ${displayTarget(target)} with node, npm, and curl.`,
          };
        }
        const detail = output.join("").trim();
        return {
          ok: false,
          message:
            detail.length > 0
              ? `SSH preflight failed:\n${detail}`
              : "SSH preflight failed. The host needs node, npm, curl, and a POSIX shell.",
        };
      } catch (error) {
        return { ok: false, message: errorMessage(error) };
      }
    }

    async function executorFor(
      inputs: SshMachineInputs,
    ): Promise<{ target: SshTarget; executor: MachineExecutor }> {
      const target = await resolveTarget(inputs);
      return { target, executor: createSshExecutor(target, deps.spawn) };
    }

    bb.rpc.register(sshSandboxRpcContract, {
      async "ssh.probe"(inputs) {
        const parsed = sshMachineInputsSchema.parse(inputs);
        const target = await resolveTarget(parsed);
        return probe(target, AbortSignal.timeout(60_000));
      },
    });

    bb.cli.register({
      name: "ssh-sandbox",
      summary:
        "Probe an SSH host for bb machine enrollment without installing the daemon",
      commands: [
        {
          name: "probe",
          summary:
            "Check SSH connectivity and that node, npm, and curl exist on the host",
          usage:
            "bb ssh-sandbox probe --destination user@host [--port N] [--json]",
        },
      ],
      async run(argv) {
        const json = argv.includes("--json");
        const args = argv.filter((value) => value !== "--json");
        if (args[0] !== "probe") {
          return {
            exitCode: 1,
            stderr:
              "Usage: bb ssh-sandbox probe --destination user@host [--port N] [--json]",
          };
        }
        let destination: string | undefined;
        let port: number | undefined;
        for (let index = 1; index < args.length; index += 1) {
          const flag = args[index];
          const value = args[index + 1];
          if (flag === "--destination" && value !== undefined) {
            destination = value;
            index += 1;
            continue;
          }
          if (flag === "--port" && value !== undefined) {
            const parsedPort = Number(value);
            if (!Number.isInteger(parsedPort)) {
              return { exitCode: 1, stderr: "port must be an integer." };
            }
            port = parsedPort;
            index += 1;
            continue;
          }
          return {
            exitCode: 1,
            stderr: `Unknown argument: ${flag}`,
          };
        }
        const parsed = sshMachineInputsSchema.safeParse({
          destination,
          port,
        });
        if (!parsed.success) {
          return {
            exitCode: 1,
            stderr:
              parsed.error.issues[0]?.message ??
              "destination is required, for example ubuntu@sandbox.example.com",
          };
        }
        const target = await resolveTarget(parsed.data);
        const result = await probe(target, AbortSignal.timeout(60_000));
        if (json) {
          return {
            exitCode: result.ok ? 0 : 1,
            stdout: JSON.stringify(result),
          };
        }
        return result.ok
          ? { exitCode: 0, stdout: result.message }
          : { exitCode: 1, stderr: result.message };
      },
    });

    bb.experimental_environments.register({
      id: PROVIDER_ID,
      displayName: "SSH sandbox",
      description: "Create a project checkout on a new SSH machine.",
      icon: "Cloud",
      machineProviderId: PROVIDER_ID,
      environmentProviderId: "project-checkout",
    });

    bb.experimental_machines.register({
      id: PROVIDER_ID,
      displayName: "SSH sandbox",
      description:
        "Enroll any SSH host as a bb machine without logging in to install the daemon.",
      icon: "Cloud",
      ephemeral: false,
      inputs: sshMachineInputsSchema,
      async availability() {
        return deps.resolveSsh() === null
          ? { status: "unavailable", message: missingSshMessage() }
          : { status: "available" };
      },
      async validate({ inputs }) {
        const parsed = sshMachineInputsSchema.safeParse(inputs);
        return parsed.success
          ? { action: "accept" }
          : {
              action: "refuse",
              message:
                parsed.error.issues[0]?.message ?? "Invalid SSH destination.",
            };
      },
      async create(context) {
        try {
          const inputs = sshMachineInputsSchema.parse(context.inputs);
          const { target, executor } = await executorFor(inputs);
          context.signal.throwIfAborted();
          context.report.step(
            `Connecting to ${displayTarget(target)} over SSH…`,
          );
          const preflight = await probe(target, context.signal);
          if (!preflight.ok)
            return { status: "failed", message: preflight.message };
          const resource: SshMachineResource = {
            destination: target.destination,
            ...(target.port === undefined ? {} : { port: target.port }),
          };
          await context.checkpoint(resource);
          context.signal.throwIfAborted();
          const connectStartedAt = deps.now();
          await bb.experimental_machines.bootstrap({
            key: context.key,
            executor,
            report: context.report,
            signal: context.signal,
          });
          context.report.log(
            `SSH daemon connected in ${deps.now() - connectStartedAt} ms\n`,
          );
          return {
            status: "created",
            name: displayTarget(resource),
            resource,
          };
        } catch (error) {
          context.signal.throwIfAborted();
          return { status: "failed", message: errorMessage(error) };
        }
      },
      async reconcileCleanup() {
        return { status: "removed" };
      },
      async remove() {
        return { status: "removed" };
      },
    });
  };
}

export default createSshSandboxPlugin({
  spawn: defaultSpawn,
  resolveSsh: defaultResolveSsh,
  identityReadable: defaultIdentityReadable,
  now: () => Date.now(),
});
