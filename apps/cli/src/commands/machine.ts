import { registerMachineEnvironmentCommands } from "./machine-environment.js";
import { enrollMachine } from "./machine-enrollment.js";
import type { Command } from "commander";
import { jsonValueSchema, type Host, type JsonValue } from "@bb/domain";
import { CliExitError } from "../action.js";
import { JSON_FLAG_DESCRIPTION, arg, flag } from "../cli-door.js";
import { createCliBbSdk } from "../client.js";
import {
  clientCommand,
  mountCommands,
  publicCommand,
  type CliClient,
  type CliCommand,
} from "../operation-doors.js";
import { columnWidths, printBorderlessTable } from "../table.js";

function enrollmentExpiryNotice(expiresAt: number | null): string {
  if (expiresAt === null) return "This command expires once it is used.";
  return `This command expires at ${new Date(expiresAt).toLocaleTimeString()}.`;
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

const TARGET = { target: arg("<id-or-name>") };

function resolveTarget(target: string, client: CliClient): Promise<string> {
  return resolveMachineHostId({ serverUrl: client.url, target });
}

const resolveTargetInput = async (
  { positionals }: { positionals: { target: string } },
  client: CliClient,
) => ({ id: await resolveTarget(positionals.target, client) });

const JSON_OPTION = { json: flag("--json", JSON_FLAG_DESCRIPTION) };

function lifecycleCommand(args: {
  verb: "reconcile" | "suspend" | "resume";
  summary: string;
  request(client: CliClient, id: string): Promise<Host>;
  targetPhase(requested: Host): "active" | "suspended" | null;
  done(id: string, host: Host): string;
}): CliCommand {
  return clientCommand({
    path: ["machine", args.verb],
    summary: args.summary,
    positionals: TARGET,
    async run({ positionals }, client) {
      const id = await resolveTarget(positionals.target, client);
      const requested = await args.request(client, id);
      const targetPhase = args.targetPhase(requested);
      const host =
        targetPhase === null
          ? requested
          : await waitForMachineLifecycle({
              host: requested,
              targetPhase,
              getHost: () => client.call("hosts.get", { id }),
            });
      return { id, host };
    },
    json: ({ host }) => host,
    print: ({ id, host }) => args.done(id, host),
  });
}

export const machineCommands = [
  clientCommand({
    path: ["machine", "enroll"],
    summary: "Enroll this machine using a private bootstrap bundle",
    options: {
      bootstrapFile: flag(
        "--bootstrap-file <path>",
        "Read the bootstrap bundle from a file",
      ),
      bootstrapEnv: flag(
        "--bootstrap-env <name>",
        "Consume the bootstrap bundle from an environment variable",
      ),
    },
    run: ({ options: { bootstrapFile, bootstrapEnv } }) =>
      enrollMachine({
        ...(bootstrapFile === undefined ? {} : { bootstrapFile }),
        ...(bootstrapEnv === undefined ? {} : { bootstrapEnv }),
      }),
    print: (result) => `Machine ${result.hostId} enrolled`,
  }),
  clientCommand({
    path: ["machine", "join-code"],
    summary: "Compatibility notice for removed machine join codes",
    hidden: true,
    run(): never {
      throw new CliExitError("bb machine join-code has been removed.", 1, {
        code: "removed_command",
        hint: "Use `bb machine create --provider manual` and run the printed enrollment command.",
      });
    },
  }),
  clientCommand({
    path: ["machine", "create"],
    summary: "Create a machine using an installed provider",
    interrupt:
      "Stopped following; creation continues. Use bb machine remove <host-id> to cancel.",
    options: {
      wait: flag("--no-wait", "Return the creating host ID immediately"),
      provider: flag("--provider <id>", "Machine provider ID", {
        required: true,
      }),
      key: flag(
        "--key <idempotency-key>",
        "Reuse a stable key when retrying creation",
      ),
      inputs: flag("--inputs <JSON>", "Provider inputs as JSON"),
    },
    async run({ options }, client) {
      const machineProviderId = parseProviderCliKey(options.provider);
      const key = options.key?.trim();
      if (key === "") throw new Error("Creation key must not be empty.");
      let inputs: JsonValue = null;
      if (options.inputs !== undefined) {
        try {
          inputs = jsonValueSchema.parse(JSON.parse(options.inputs));
        } catch {
          throw new Error("--inputs must be valid JSON.");
        }
      }
      const signal = client.signal;
      const sdk = client.sdk();
      signal.throwIfAborted();
      let host = await sdk.hosts.experimental_create({
        machineProviderId,
        inputs,
        ...(key === undefined ? {} : { key }),
        wait: false,
        signal,
      });
      if (!options.wait) return { host, waited: false };
      let enrollmentCommandShown = false;
      const reportEnrollmentCommand = async (current: Host) => {
        if (enrollmentCommandShown || current.lifecycle.phase !== "creating")
          return;
        const enrollmentCommand =
          await sdk.hosts.experimental_getEnrollmentCommand({
            hostId: current.id,
            signal,
          });
        if (enrollmentCommand !== null) {
          console.error("On macOS or Linux, run:");
          console.error(enrollmentCommand.command);
          console.error("On Windows, run in PowerShell:");
          console.error(enrollmentCommand.windowsCommand);
          console.error(enrollmentExpiryNotice(enrollmentCommand.expiresAt));
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
            signal,
          });
          await reportEnrollmentCommand(current);
          return current;
        },
      });
      return { host, waited: true };
    },
    json: ({ host }) => host,
    print: ({ host, waited }) =>
      waited ? `Machine ${host.name} created` : host.id,
  }),
  publicCommand("system.machineProviders", {
    path: ["machine", "providers"],
    summary: "List installed machine providers",
    json: ({ providers }) => providers,
    print: ({ providers }) =>
      providers.length === 0
        ? "No machine providers found"
        : providers
            .map((provider) => `${provider.id}  ${provider.displayName}`)
            .join("\n"),
  }),
  clientCommand({
    path: ["machine", "list"],
    summary: "List execution machines",
    options: {
      all: flag(
        "--all",
        "Include disposable provider sandboxes alongside persistent machines",
      ),
      ...JSON_OPTION,
    },
    async run({ options }, client) {
      const hosts = await client.call("hosts.list", {
        includeCreating: "true",
        ...(options.all ? {} : { type: "persistent" }),
      });
      if (options.json || hosts.length === 0) {
        return { hosts, primaryHostId: null };
      }
      const { primaryHostId } = await client.call("system.config", {});
      return { hosts, primaryHostId };
    },
    json: ({ hosts }) => hosts,
    print({ hosts, primaryHostId }) {
      if (hosts.length === 0) return "No machines found";
      printMachineTable(hosts, primaryHostId);
      return null;
    },
  }),
  publicCommand("hosts.get", {
    path: ["machine", "show"],
    summary: "Show execution machine details",
    positionals: TARGET,
    prepare: resolveTargetInput,
    print: (host) => JSON.stringify(host, null, 2),
  }),
  clientCommand({
    path: ["machine", "reconnect"],
    summary: "Reconnect a machine, keeping its host ID",
    positionals: TARGET,
    options: JSON_OPTION,
    async run({ positionals, options }, client) {
      const hostId = await resolveTarget(positionals.target, client);
      const reconnect = await client.call("hosts.reconnect", { id: hostId });
      if (options.json) return reconnect;
      console.log(
        `Machine ${hostId} keeps its host ID. Run this command on the machine within 15 minutes:`,
      );
      console.log("");
      console.log(reconnect.command);
      console.error(`Waiting for machine ${hostId} to reconnect…`);
      const deadline = Date.now() + MACHINE_LIFECYCLE_TIMEOUT_MS;
      for (;;) {
        const host = await client.call("hosts.get", { id: hostId });
        if (host.status === "connected") break;
        if (Date.now() >= deadline)
          throw new Error(
            `Timed out waiting for machine ${hostId} to reconnect`,
          );
        await new Promise<void>((resolve) =>
          setTimeout(resolve, MACHINE_LIFECYCLE_POLL_MS),
        );
      }
      console.log(`Machine ${hostId} reconnected successfully.`);
      return reconnect;
    },
    print: () => null,
  }),
  publicCommand("hosts.update", {
    path: ["machine", "rename"],
    summary: "Rename an execution machine",
    positionals: { ...TARGET, name: arg("<name>") },
    prepare: async ({ positionals }, client) => ({
      id: await resolveTarget(positionals.target, client),
      name: positionals.name,
    }),
    print: (host) => `Machine ${host.id} renamed to ${host.name}`,
  }),
  publicCommand("hosts.delete", {
    path: ["machine", "remove"],
    summary: "Revoke and remove an execution machine",
    positionals: TARGET,
    options: {
      force: flag(
        "--force",
        "Finish removing a disconnected machine whose environment cleanup failed, leaving its files on disk",
      ),
    },
    prepare: async ({ positionals, options }, client) => ({
      id: await resolveTarget(positionals.target, client),
      ...(options.force ? { force: "true" as const } : {}),
    }),
    confirm: (input) =>
      input.force === "true"
        ? `Remove machine ${input.id} without cleaning up its environments? Files left on its disk are not deleted.`
        : `Remove machine ${input.id}?`,
    print: (_result, input) => `Machine ${input.id} removed`,
  }),
  publicCommand("hosts.retryUpdate", {
    path: ["machine", "retry-update"],
    summary: "Retry a pending daemon protocol update now",
    positionals: TARGET,
    prepare: resolveTargetInput,
    print: (_result, input) => `Machine ${input.id} update retry requested`,
  }),
  lifecycleCommand({
    verb: "reconcile",
    summary: "Reconcile provider compute with the machine's recorded state",
    request: (client, id) => client.call("hosts.reconcile", { id }),
    targetPhase: (requested) =>
      requested.lifecycle.phase === "suspending" ? "suspended" : null,
    done: (id, host) => `Machine ${id}: ${host.lifecycle.phase}`,
  }),
  lifecycleCommand({
    verb: "suspend",
    summary: "Suspend a provider-managed execution machine",
    request: (client, id) => client.call("hosts.suspend", { id }),
    targetPhase: () => "suspended",
    done: (id) => `Machine ${id} suspended`,
  }),
  lifecycleCommand({
    verb: "resume",
    summary: "Resume a suspended provider-managed execution machine",
    request: (client, id) => client.call("hosts.resume", { id }),
    targetPhase: () => "active",
    done: (id) => `Machine ${id} resumed`,
  }),
  publicCommand("hosts.retryCleanup", {
    path: ["machine", "retry-cleanup"],
    summary: "Retry a failed provider teardown immediately",
    positionals: TARGET,
    prepare: resolveTargetInput,
    print: (_result, input) => `Machine ${input.id} cleanup retried`,
  }),
];

export const machineProviderCliCommands = [
  publicCommand("hosts.providerCliStatus", {
    path: ["machine", "provider-cli", "status"],
    summary: "Show registered provider CLI installation/update status",
    positionals: TARGET,
    prepare: async ({ positionals }, client) => ({
      id: await resolveTarget(positionals.target, client),
      refresh: "true" as const,
    }),
    print: (result) => JSON.stringify(result, null, 2),
  }),
  clientCommand({
    path: ["machine", "provider-cli", "install"],
    summary: "Install or update a registered provider CLI by provider ID",
    positionals: { ...TARGET, provider: arg("<provider>") },
    options: {
      action: flag("--action <action>", "Action: install or update", {
        default: "install",
      }),
    },
    run: async ({ positionals, options }, client) => {
      const actionKind = options.action;
      if (actionKind !== "install" && actionKind !== "update") {
        throw new Error("--action must be install or update.");
      }
      const hostId = await resolveTarget(positionals.target, client);
      return client.sdk().hosts.installProviderCli({
        hostId,
        provider: parseProviderCliKey(positionals.provider),
        actionKind,
      });
    },
    print: (events) =>
      events.length === 0
        ? null
        : events.map((event) => JSON.stringify(event)).join("\n"),
  }),
];

export function registerMachineCommands(
  program: Command,
  getUrl: () => string,
): void {
  const machine = program
    .command("machine")
    .description("Inspect execution machines");

  registerMachineEnvironmentCommands(machine, getUrl);
  mountCommands(machine, machineCommands, { getUrl });
  machine
    .command("provider-cli")
    .description("Inspect and install provider CLIs on a machine");
  mountCommands(machine, machineProviderCliCommands, { getUrl });
}

function printMachineTable(hosts: Host[], serverHostId: string | null): void {
  const now = Date.now();
  const rows = hosts.map((host) => [
    host.name,
    host.id === serverHostId ? "server" : "",
    host.id,
    host.type,
    host.status,
    host.machineProviderId ?? "user-enrolled",
    formatMachineLastSeen(host.lastSeenAt, now),
  ]);
  printBorderlessTable(
    {
      head: ["Name", "Role", "ID", "Type", "Status", "Provider", "Last seen"],
      colWidths: columnWidths(rows, [4, 4, 2, 4, 6, 8, 9]),
      trimTrailingWhitespace: true,
    },
    rows,
  );
}
