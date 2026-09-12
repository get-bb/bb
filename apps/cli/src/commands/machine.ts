import { registerMachineEnvironmentCommands } from "./machine-environment.js";
import {
  enrollMachine,
  type MachineEnrollmentOptions,
} from "./machine-enrollment.js";
import { Command } from "commander";
import { jsonValueSchema, type Host, type JsonValue } from "@bb/domain";
import { action, CliExitError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";
import { confirmDestructiveAction } from "./helpers.js";

function enrollmentExpiryNotice(expiresAt: number | null): string {
  if (expiresAt === null) return "This command expires once it is used.";
  return `This command expires at ${new Date(expiresAt).toLocaleTimeString()}.`;
}

interface MachineListCommandOptions {
  json?: boolean;
}

interface MachineEnumerationOptions extends MachineListCommandOptions {
  all?: boolean;
}

interface MachineCreateCommandOptions extends MachineListCommandOptions {
  provider: string;
  wait: boolean;
  key?: string;
  inputs?: string;
}

interface MachineMutationCommandOptions extends MachineListCommandOptions {
  yes?: boolean;
}

interface MachineProviderInstallOptions extends MachineListCommandOptions {
  action?: "install" | "update";
}

const MACHINE_LIFECYCLE_TIMEOUT_MS = 15 * 60_000;
const MACHINE_LIFECYCLE_POLL_MS = 500;

async function waitForMachineLifecycle(args: {
  host: Host;
  targetPhase: "active" | "suspended";
  getHost: () => Promise<Host>;
}): Promise<Host> {
  let host = args.host;
  const deadline = Date.now() + MACHINE_LIFECYCLE_TIMEOUT_MS;
  while (host.lifecycle.phase !== args.targetPhase) {
    const message = host.lifecycle.message;
    if (
      message?.startsWith("Machine suspension failed:") ||
      message?.startsWith("Machine resume failed:")
    ) {
      throw new Error(message);
    }
    if (
      host.lifecycle.phase === "removing" ||
      host.lifecycle.phase === "destroyed"
    ) {
      throw new Error(
        host.lifecycle.message ??
          `Machine entered the ${host.lifecycle.phase} phase`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${MACHINE_LIFECYCLE_TIMEOUT_MS / 1000} seconds waiting for machine ${host.id} to become ${args.targetPhase}`,
      );
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, MACHINE_LIFECYCLE_POLL_MS),
    );
    host = await args.getHost();
  }
  return host;
}

function parseProviderCliKey(value: string): string {
  const providerId = value.trim();
  if (providerId.length === 0)
    throw new Error("provider ID must not be empty.");
  return providerId;
}

function describeMachines(hosts: readonly Host[]): string {
  if (hosts.length === 0) return "none";
  return hosts.map((host) => `${host.name} (${host.id})`).join(", ");
}

export type MachineScope = "persistent" | "all";

export function selectMachines(
  hosts: readonly Host[],
  scope: MachineScope,
): Host[] {
  return scope === "all"
    ? [...hosts]
    : hosts.filter((host) => host.type !== "ephemeral");
}

export function resolveMachineId(
  hosts: readonly Host[],
  target: string,
): string {
  const trimmedTarget = target.trim();
  const idMatch = hosts.find((host) => host.id === trimmedTarget);
  if (idMatch) return idMatch.id;

  const nameMatches = hosts.filter((host) => host.name === trimmedTarget);
  if (nameMatches.length === 1) return nameMatches[0].id;
  if (nameMatches.length > 1) {
    throw new Error(
      `Machine name '${trimmedTarget}' is ambiguous. Matches: ${describeMachines(nameMatches)}.`,
    );
  }
  throw new Error(
    `Machine '${trimmedTarget}' was not found. Available machines: ${describeMachines(hosts)}.`,
  );
}

export function resolveMachineTargetOption(args: {
  machine?: string;
  host?: string;
}): string | undefined {
  if (args.machine && args.host) {
    throw new Error("Cannot combine --machine with --host.");
  }
  return args.machine ?? args.host;
}

type MachineEnvironmentRouting =
  | { environmentId: string; hostId?: never }
  | { environmentId?: never; hostId: string }
  | { environmentId?: never; hostId?: never };

export async function resolveMachineEnvironmentRouting(
  args: { environment?: string; host?: string; machine?: string },
  serverUrl: string,
): Promise<MachineEnvironmentRouting> {
  const machineTarget = resolveMachineTargetOption(args);
  if (machineTarget !== undefined && args.environment !== undefined) {
    throw new Error(
      "Cannot combine --machine or --host with --environment; the environment already selects its machine.",
    );
  }
  if (args.environment !== undefined) {
    return { environmentId: args.environment };
  }
  if (machineTarget !== undefined) {
    return {
      hostId: await resolveMachineHostId({ serverUrl, target: machineTarget }),
    };
  }
  return {};
}

export function formatMachineLastSeen(
  timestamp: number | null,
  now = Date.now(),
): string {
  if (timestamp === null) return "never";
  const elapsedMs = Math.max(0, now - timestamp);
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (elapsedMs < minuteMs) return "just now";
  if (elapsedMs < hourMs) return `${Math.floor(elapsedMs / minuteMs)}m ago`;
  if (elapsedMs < dayMs) return `${Math.floor(elapsedMs / hourMs)}h ago`;
  return `${Math.floor(elapsedMs / dayMs)}d ago`;
}

export async function resolveMachineHostId(args: {
  requireConnected?: boolean;
  serverUrl: string;
  target: string;
}): Promise<string> {
  const hosts = await createCliBbSdk(args.serverUrl).hosts.list({
    includeCreating: true,
  });
  const hostId = resolveMachineId(hosts, args.target);
  if (
    args.requireConnected &&
    hosts.find((host) => host.id === hostId)?.status !== "connected"
  ) {
    throw new Error(`Machine '${args.target.trim()}' is disconnected.`);
  }
  return hostId;
}

export function registerMachineCommands(
  program: Command,
  getUrl: () => string,
): void {
  const machine = program
    .command("machine")
    .description("Inspect execution machines");

  registerMachineEnvironmentCommands(machine, getUrl);

  machine
    .command("enroll")
    .description("Enroll this machine using a private bootstrap bundle")
    .option("--bootstrap-file <path>", "Read the bootstrap bundle from a file")
    .option(
      "--bootstrap-env <name>",
      "Consume the bootstrap bundle from an environment variable",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (options: MachineEnrollmentOptions & { json?: boolean }) => {
        const result = await enrollMachine(options);
        if (!outputJson(options, result))
          console.log(`Machine ${result.hostId} enrolled`);
      }),
    );

  machine
    .command("create")
    .description("Create a machine using an installed provider")
    .option("--no-wait", "Return the creating host ID immediately")
    .requiredOption("--provider <id>", "Machine provider ID")
    .option(
      "--key <idempotency-key>",
      "Reuse a stable key when retrying creation",
    )
    .option("--inputs <JSON>", "Provider inputs as JSON")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: MachineCreateCommandOptions) => {
        const machineProviderId = parseProviderCliKey(opts.provider);
        const key = opts.key?.trim();
        if (key === "") throw new Error("Creation key must not be empty.");
        let inputs: JsonValue = null;
        if (opts.inputs !== undefined) {
          try {
            inputs = jsonValueSchema.parse(JSON.parse(opts.inputs));
          } catch {
            throw new Error("--inputs must be valid JSON.");
          }
        }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        process.once("SIGINT", cancel);
        try {
          const sdk = createCliBbSdk(getUrl());
          controller.signal.throwIfAborted();
          let host = await sdk.hosts.experimental_create({
            machineProviderId,
            inputs,
            ...(key === undefined ? {} : { key }),
            wait: false,
            signal: controller.signal,
          });
          if (!opts.wait) {
            if (!outputJson(opts, host)) console.log(host.id);
            return;
          }
          let enrollmentCommandShown = false;
          const reportEnrollmentCommand = async (current: Host) => {
            if (
              enrollmentCommandShown ||
              current.lifecycle.phase !== "creating"
            )
              return;
            const enrollmentCommand =
              await sdk.hosts.experimental_getEnrollmentCommand({
                hostId: current.id,
                signal: controller.signal,
              });
            if (enrollmentCommand !== null) {
              console.error(enrollmentCommand.command);
              console.error(
                enrollmentExpiryNotice(enrollmentCommand.expiresAt),
              );
              enrollmentCommandShown = true;
            }
          };
          await reportEnrollmentCommand(host);
          console.error(`Following machine ${host.id}`);
          host = await waitForMachineLifecycle({
            host,
            targetPhase: "active",
            getHost: async () => {
              const current = await sdk.hosts.get({
                hostId: host.id,
                signal: controller.signal,
              });
              await reportEnrollmentCommand(current);
              return current;
            },
          });
          if (!outputJson(opts, host))
            console.log(`Machine ${host.name} created`);
        } catch (error) {
          if (controller.signal.aborted) {
            throw new CliExitError(
              "Stopped following; creation continues. Use bb machine remove <host-id> to cancel.",
              130,
            );
          }
          throw error;
        } finally {
          process.off("SIGINT", cancel);
        }
      }),
    );

  machine
    .command("providers")
    .description("List installed machine providers")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: MachineListCommandOptions) => {
        const providers =
          await createCliBbSdk(getUrl()).hosts.experimental_listProviders();
        if (outputJson(opts, providers)) return;
        if (providers.length === 0) {
          console.log("No machine providers found");
          return;
        }
        console.log(
          providers
            .map((provider) => `${provider.id}  ${provider.displayName}`)
            .join("\n"),
        );
      }),
    );

  machine
    .command("list")
    .description("List execution machines")
    .option(
      "--all",
      "Include disposable provider sandboxes alongside persistent machines",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: MachineEnumerationOptions) => {
        const hosts = selectMachines(
          await createCliBbSdk(getUrl()).hosts.list({ includeCreating: true }),
          opts.all ? "all" : "persistent",
        );
        if (outputJson(opts, hosts)) return;
        if (hosts.length === 0) {
          console.log("No machines found");
          return;
        }
        printMachineTable(hosts);
      }),
    );

  machine
    .command("show <id-or-name>")
    .description("Show execution machine details")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (target: string, opts: MachineListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hostId = await resolveMachineHostId({
          serverUrl: getUrl(),
          target,
        });
        const host = await sdk.hosts.get({ hostId });
        if (outputJson(opts, host)) return;
        console.log(JSON.stringify(host, null, 2));
      }),
    );

  machine
    .command("join-code")
    .description("Create a short-lived machine pairing code")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: MachineListCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).hosts.createJoinCode();
        if (outputJson(opts, result)) return;
        console.log(result.joinCode);
      }),
    );

  machine
    .command("rename <id-or-name> <name>")
    .description("Rename an execution machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          target: string,
          name: string,
          opts: MachineListCommandOptions,
        ) => {
          const sdk = createCliBbSdk(getUrl());
          const hostId = await resolveMachineHostId({
            serverUrl: getUrl(),
            target,
          });
          const host = await sdk.hosts.update({ hostId, name });
          if (outputJson(opts, host)) return;
          console.log(`Machine ${host.id} renamed to ${host.name}`);
        },
      ),
    );

  machine
    .command("remove <id-or-name>")
    .description("Revoke and remove an execution machine")
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (target: string, opts: MachineMutationCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hostId = await resolveMachineHostId({
          serverUrl: getUrl(),
          target,
        });
        if (
          !opts.yes &&
          !(await confirmDestructiveAction(`Remove machine ${hostId}?`))
        )
          return;
        const result = await sdk.hosts.delete({ hostId });
        if (outputJson(opts, result)) return;
        console.log(`Machine ${hostId} removed`);
      }),
    );

  machine
    .command("retry-update <id-or-name>")
    .description("Retry a pending daemon protocol update now")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (target: string, opts: MachineListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hostId = await resolveMachineHostId({
          serverUrl: getUrl(),
          target,
        });
        const result = await sdk.hosts.retryUpdate({ hostId });
        if (outputJson(opts, result)) return;
        console.log(`Machine ${hostId} update retry requested`);
      }),
    );

  machine
    .command("suspend <id-or-name>")
    .description("Suspend a provider-managed execution machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (target: string, opts: MachineListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hostId = await resolveMachineHostId({
          serverUrl: getUrl(),
          target,
        });
        const requested = await sdk.hosts.experimental_suspend({ hostId });
        const result = await waitForMachineLifecycle({
          host: requested,
          targetPhase: "suspended",
          getHost: () => sdk.hosts.get({ hostId }),
        });
        if (outputJson(opts, result)) return;
        console.log(`Machine ${hostId} suspended`);
      }),
    );

  machine
    .command("resume <id-or-name>")
    .description("Resume a suspended provider-managed execution machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (target: string, opts: MachineListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hostId = await resolveMachineHostId({
          serverUrl: getUrl(),
          target,
        });
        const requested = await sdk.hosts.experimental_resume({ hostId });
        const result = await waitForMachineLifecycle({
          host: requested,
          targetPhase: "active",
          getHost: () => sdk.hosts.get({ hostId }),
        });
        if (outputJson(opts, result)) return;
        console.log(`Machine ${hostId} resumed`);
      }),
    );

  machine
    .command("retry-cleanup <id-or-name>")
    .description("Retry a failed provider teardown immediately")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (target: string, opts: MachineListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hostId = await resolveMachineHostId({
          serverUrl: getUrl(),
          target,
        });
        const result = await sdk.hosts.experimental_retryCleanup({ hostId });
        if (outputJson(opts, result)) return;
        console.log(`Machine ${hostId} cleanup retried`);
      }),
    );

  const providerCli = machine
    .command("provider-cli")
    .description("Inspect and install provider CLIs on a machine");
  providerCli
    .command("status <id-or-name>")
    .description("Show registered provider CLI installation/update status")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (target: string, opts: MachineListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hostId = await resolveMachineHostId({
          serverUrl: getUrl(),
          target,
        });
        const result = await sdk.hosts.providerCliStatus({ hostId });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );
  providerCli
    .command("install <id-or-name> <provider>")
    .description("Install or update a registered provider CLI by provider ID")
    .option("--action <action>", "Action: install or update", "install")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          target: string,
          provider: string,
          opts: MachineProviderInstallOptions,
        ) => {
          if (opts.action !== "install" && opts.action !== "update") {
            throw new Error("--action must be install or update.");
          }
          const sdk = createCliBbSdk(getUrl());
          const hostId = await resolveMachineHostId({
            serverUrl: getUrl(),
            target,
          });
          const events = await sdk.hosts.installProviderCli({
            hostId,
            provider: parseProviderCliKey(provider),
            actionKind: opts.action,
          });
          if (outputJson(opts, events)) return;
          for (const event of events) console.log(JSON.stringify(event));
        },
      ),
    );
}

function printMachineTable(hosts: Host[]): void {
  const now = Date.now();
  const rows = hosts.map((host) => [
    host.name,
    host.id,
    host.type,
    host.status,
    host.machineProviderId ?? "user-enrolled",
    formatMachineLastSeen(host.lastSeenAt, now),
  ]);
  printBorderlessTable(
    {
      head: ["Name", "ID", "Type", "Status", "Provider", "Last seen"],
      colWidths: columnWidths(rows, [4, 2, 4, 6, 8, 9]),
      trimTrailingWhitespace: true,
    },
    rows,
  );
}
