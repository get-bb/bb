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
  const host = program.command("host").description("Inspect available hosts");

  host
    .command("list")
    .description("List persistent hosts")
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

function printHostTable(hosts: Host[]): void {
  const rows = hosts.map((host) => [host.id, host.name, host.status]);
  const idWidth = Math.max(4, ...rows.map((row) => row[0].length));
  const nameWidth = Math.max(4, ...rows.map((row) => row[1].length));
  const statusWidth = Math.max(6, ...rows.map((row) => row[2].length));
  const table = renderBorderlessTable(
    {
      head: ["ID", "Name", "Status"],
      colWidths: [idWidth, nameWidth, statusWidth],
      trimTrailingWhitespace: true,
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}
