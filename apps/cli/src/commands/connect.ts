import { Command } from "commander";
import { action, CliExitError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";
import type { ConnectStatusResult } from "@bb/sdk";

interface ConnectCommandOptions {
  code?: string;
  server?: string;
  baseUrl?: string;
  json?: boolean;
}

interface ConnectStatusOptions {
  json?: boolean;
}

interface ConnectOffOptions {
  json?: boolean;
}

function printStatus(status: ConnectStatusResult): void {
  if (!status.paired) {
    console.log("Not paired");
    return;
  }
  const live = status.connected ? "connected" : "disconnected";
  console.log(`${status.handle}  ${status.url}  ${live}`);
  if (status.lastError && !status.connected) {
    console.log(`  last error: ${status.lastError}`);
  }
}

export function registerConnectCommands(
  program: Command,
  getUrl: () => string,
): void {
  const connect = program
    .command("connect")
    .description(
      "Expose this bb server at <handle>.getbb.app (the server holds the tunnel)",
    )
    .option(
      "--code <code>",
      "One-time connect code from the getbb.app dashboard (first pairing only)",
    )
    .option(
      "--server <url>",
      "Your server URL, https://<handle>.getbb.app (from the dashboard)",
    )
    .option(
      "--base-url <url>",
      "Connect cloud base URL for redeeming --code (default: derived from --server)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ConnectCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        if (!opts.code) {
          throw new CliExitError(
            "Provide --code (and --server) from the getbb.app dashboard to pair. Use `bb connect status` to inspect an existing pairing.",
            1,
          );
        }
        if (!opts.server) {
          throw new CliExitError(
            "Provide --server https://<handle>.getbb.app (copy the connect command from the dashboard).",
            1,
          );
        }
        // Pairing is a thin call: the SERVER redeems the code, stores the
        // credential, and holds the tunnel from here on (surviving this
        // command and reconnecting on restart).
        const status = await sdk.connect.pair({
          code: opts.code,
          serverUrl: opts.server,
          ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
        });
        if (outputJson(opts, status)) return;
        console.log(
          `Paired as ${status.handle} — your bb is reachable at ${status.url}`,
        );
        console.log(
          "The server holds the tunnel; it stays up while bb is running.",
        );
      }),
    );

  connect
    .command("status")
    .description("Show the server's connect status")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ConnectStatusOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const status = await sdk.connect.status();
        if (outputJson(opts, status)) return;
        printStatus(status);
      }),
    );

  connect
    .command("off")
    .description("Disconnect and forget the server's connect pairing")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ConnectOffOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const status = await sdk.connect.disconnect();
        if (outputJson(opts, status)) return;
        console.log("Disconnected");
      }),
    );
}
