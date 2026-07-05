import { Command } from "commander";
import type { Host } from "@bb/domain";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";

interface HostListCommandOptions {
  json?: boolean;
}

export function registerHostCommands(
  program: Command,
  getUrl: () => string,
): void {
  const host = program
    .command("host")
    .description("Inspect hosts (machines connected to this server)");

  host
    .command("list")
    .description("List hosts and their connection status")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: HostListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hosts = await sdk.hosts.list();
        if (outputJson(opts, hosts)) return;
        if (hosts.length === 0) {
          console.log("No hosts found");
          return;
        }
        printHostTable(hosts);
      }),
    );
}

function formatLastSeen(lastSeenAt: number | null): string {
  return lastSeenAt === null ? "-" : new Date(lastSeenAt).toLocaleString();
}

function printHostTable(hosts: Host[]): void {
  const rows = hosts.map((host) => [
    host.id,
    host.name,
    host.status,
    formatLastSeen(host.lastSeenAt),
  ]);
  const colWidths = [2, 4, 6, 9].map((minWidth, index) =>
    Math.max(minWidth, ...rows.map((row) => row[index].length)),
  );
  const table = renderBorderlessTable(
    {
      head: ["ID", "Name", "Status", "Last seen"],
      colWidths,
      trimTrailingWhitespace: true,
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}
