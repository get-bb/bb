import { registerMachineEnvironmentCommands } from "./machine-environment.js";
import { registerMachineLifecycleCommands } from "./machine-lifecycle.js";
import {
  enrollMachine,
  type MachineEnrollmentOptions,
} from "./machine-enrollment.js";
import { Command } from "commander";
import { jsonValueSchema, type Host, type JsonValue } from "@bb/domain";
import { action, CliExitError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";
import { confirmDestructiveAction } from "./helpers.js";

interface MachineListCommandOptions {
  json?: boolean;
  project?: string;
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
  const hosts = await createCliBbSdk(args.serverUrl).hosts.list();
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

  registerMachineLifecycleCommands(machine);
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
    .option("--no-wait", "Return the durable launch ID immediately")
    .requiredOption("--provider <id>", "Machine provider ID")
    .option(
      "--key <idempotency-key>",
      "Reuse a stable key when retrying creation",
    )
    .option("--inputs <JSON>", "Provider inputs as JSON")
    .option("--project <id/name>", "Project ID or exact project name")
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
          let projectId: string | null = null;
          if (opts.project !== undefined) {
            const target = opts.project.trim();
            if (!target) throw new Error("Project must not be empty.");
            const projects = await sdk.projects.list({
              includePersonal: true,
              signal: controller.signal,
            });
            const byId = projects.find((project) => project.id === target);
            const matches = byId
              ? [byId]
              : projects.filter((project) => project.name === target);
            if (matches.length === 0) throw new Error("Project was not found.");
            if (matches.length > 1) {
              throw new Error("Project name is ambiguous; use its ID.");
            }
            projectId = matches[0].id;
          }
          controller.signal.throwIfAborted();
          let launch = await sdk.hosts.submit({
            machineProviderId,
            projectId,
            inputs,
            ...(key === undefined ? {} : { key }),
            signal: controller.signal,
          });
          let command: string | null = null;
          if (machineProviderId === "manual") {
            while (launch.phase === "creating" && command === null) {
              controller.signal.throwIfAborted();
              command = (
                await sdk.hosts.experimental_enrollmentCommand({
                  id: launch.id,
                  signal: controller.signal,
                })
              ).command;
              if (command !== null) break;
              await new Promise<void>((resolve) => setTimeout(resolve, 100));
              launch = await sdk.hosts.launch({
                id: launch.id,
                signal: controller.signal,
              });
            }
          }
          if (!opts.wait) {
            if (
              !outputJson(
                opts,
                machineProviderId === "manual"
                  ? { ...launch, command }
                  : launch,
              )
            )
              console.log([launch.id, command ?? launch.step].join("\n"));
            return;
          }
          if (command !== null) console.error(command);
          console.error(`Following machine launch ${launch.id}`);
          let step = "";
          const host = await sdk.hosts.follow({
            id: launch.id,
            signal: controller.signal,
            onProgress: (status) => {
              if (status.step !== step) {
                step = status.step;
                console.error(step);
              }
            },
          });
          if (!outputJson(opts, host))
            console.log(`Machine ${host.id} created`);
        } catch (error) {
          if (controller.signal.aborted) {
            throw new CliExitError(
              "Stopped following; creation continues. Use bb machine cancel <launch-id> to cancel.",
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
    .command("cancel <launch-id>")
    .description("Explicitly cancel a durable machine launch")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: MachineListCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).hosts.cancel({ id });
        if (!outputJson(opts, result))
          console.log(`${result.id}: ${result.phase}`);
      }),
    );

  machine
    .command("status <launch-id>")
    .description("Show durable machine launch progress")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: MachineListCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).hosts.launch({ id });
        if (!outputJson(opts, result))
          console.log(
            `${result.id}: ${result.phase} — ${result.message ?? result.step}`,
          );
      }),
    );

  machine
    .command("lifecycle <machine>")
    .description("Show machine maintenance state")
    .option("--remove", "Remove the machine and its retained snapshots")
    .option("--yes", "Skip removal confirmation")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          target: string,
          opts: {
            remove?: boolean;
            yes?: boolean;
            json?: boolean;
          },
        ) => {
          const sdk = createCliBbSdk(getUrl());
          const hostId = resolveMachineId(await sdk.hosts.list(), target);
          if (opts.remove) {
            if (
              !opts.yes &&
              !(await confirmDestructiveAction(
                `Remove machine ${hostId} and its snapshots?`,
              ))
            )
              return;
            const removed = await sdk.hosts.delete({ hostId });
            if (!outputJson(opts, removed))
              console.log(`Machine ${hostId} removed`);
            return;
          }
          const result = await sdk.hosts.experimental_lifecycle({
            hostId,
          });
          if (!outputJson(opts, result))
            console.log(
              `${result.phase}: ${result.recoveryState}${result.message === null ? "" : ` — ${result.message}`}\nControls: --remove --yes`,
            );
        },
      ),
    );

  machine
    .command("ready <machine>")
    .description("Check CLI, authentication and project workspace readiness")
    .requiredOption("--provider <id>", "Agent provider")
    .requiredOption("--project <id>", "Project ID")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          target: string,
          opts: { provider: string; project: string; json?: boolean },
        ) => {
          const sdk = createCliBbSdk(getUrl());
          const hostId = resolveMachineId(await sdk.hosts.list(), target);
          const result = await sdk.hosts.experimental_ensureReady({
            hostId,
            projectId: opts.project,
            providerId: opts.provider,
          });
          if (!outputJson(opts, result))
            console.log(
              result.status === "ready"
                ? "Machine is ready"
                : `${result.stage}: ${result.message}`,
            );
          if (result.status === "blocked")
            throw new CliExitError("Machine readiness is blocked", 1);
        },
      ),
    );

  machine
    .command("providers")
    .description("List installed machine providers")
    .option("--project <id>", "Evaluate availability for a project")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: MachineListCommandOptions) => {
        const providers = await createCliBbSdk(getUrl()).hosts.listProviders({
          ...(opts.project === undefined ? {} : { projectId: opts.project }),
        });
        if (outputJson(opts, providers)) return;
        if (providers.length === 0) {
          console.log("No machine providers found");
          return;
        }
        console.log(
          providers
            .map(
              (provider) =>
                `${provider.id}  ${provider.displayName}  ${provider.availability?.status ?? "available"}`,
            )
            .join("\n"),
        );
      }),
    );

  machine
    .command("list")
    .description("List execution machines")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: MachineListCommandOptions) => {
        const hosts = await createCliBbSdk(getUrl()).hosts.list();
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
        const hostId = resolveMachineId(await sdk.hosts.list(), target);
        const host = {
          ...(await sdk.hosts.get({ hostId })),
          providerDetails: await sdk.hosts.experimental_providerDetails({
            hostId,
          }),
        };
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
          const hostId = resolveMachineId(await sdk.hosts.list(), target);
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
        const hosts = await sdk.hosts.list();
        const hostId = resolveMachineId(hosts, target);
        if (
          !opts.yes &&
          !(await confirmDestructiveAction(`Remove machine ${hostId}?`))
        )
          return;
        const result = await sdk.hosts.delete({ hostId });
        if (outputJson(opts, result)) return;
        console.log(`Machine ${hostId} removed`);
        if (
          hosts.find((host) => host.id === hostId)?.machineProviderId ===
          "manual"
        )
          console.log(
            `Uninstall manually on the machine: bb machine uninstall --host-id ${hostId}`,
          );
      }),
    );

  machine
    .command("retry-update <id-or-name>")
    .description("Retry a pending daemon protocol update now")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (target: string, opts: MachineListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hostId = resolveMachineId(await sdk.hosts.list(), target);
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
        const hostId = resolveMachineId(await sdk.hosts.list(), target);
        const result = await sdk.hosts.suspend({ hostId });
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
        const hostId = resolveMachineId(await sdk.hosts.list(), target);
        const result = await sdk.hosts.resume({ hostId });
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
        const hostId = resolveMachineId(await sdk.hosts.list(), target);
        const result = await sdk.hosts.retryCleanup({ hostId });
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
        const hostId = resolveMachineId(await sdk.hosts.list(), target);
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
          const hostId = resolveMachineId(await sdk.hosts.list(), target);
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
    host.status,
    host.machineProviderId ?? "user-enrolled",
    formatMachineLastSeen(host.lastSeenAt, now),
  ]);
  const widths = [
    Math.max(4, ...rows.map((row) => row[0].length)),
    Math.max(2, ...rows.map((row) => row[1].length)),
    Math.max(6, ...rows.map((row) => row[2].length)),
    Math.max(8, ...rows.map((row) => row[3].length)),
    Math.max(9, ...rows.map((row) => row[4].length)),
  ];
  console.log("");
  console.log(
    renderBorderlessTable(
      {
        head: ["Name", "ID", "Status", "Provider", "Last seen"],
        colWidths: widths,
        trimTrailingWhitespace: true,
      },
      rows,
    ),
  );
  console.log("");
}
