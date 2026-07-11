import { Command } from "commander";
import type { Host } from "@bb/domain";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";

interface MachineListCommandOptions {
  json?: boolean;
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
  serverUrl: string;
  target: string;
}): Promise<string> {
  const hosts = await createCliBbSdk(args.serverUrl).hosts.list();
  return resolveMachineId(hosts, args.target);
}

export function registerMachineCommands(
  program: Command,
  getUrl: () => string,
): void {
  const machine = program
    .command("machine")
    .description("Inspect execution machines");

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
}

function printMachineTable(hosts: Host[]): void {
  const now = Date.now();
  const rows = hosts.map((host) => [
    host.name,
    host.id,
    host.status,
    formatMachineLastSeen(host.lastSeenAt, now),
  ]);
  const widths = [
    Math.max(4, ...rows.map((row) => row[0].length)),
    Math.max(2, ...rows.map((row) => row[1].length)),
    Math.max(6, ...rows.map((row) => row[2].length)),
    Math.max(9, ...rows.map((row) => row[3].length)),
  ];
  console.log("");
  console.log(
    renderBorderlessTable(
      {
        head: ["Name", "ID", "Status", "Last seen"],
        colWidths: widths,
        trimTrailingWhitespace: true,
      },
      rows,
    ),
  );
  console.log("");
}
