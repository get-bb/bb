import type { BbPluginApi, PluginCliResult } from "@get-bb/plugin-sdk";
import type { ShareHostResolver } from "./hosts.js";
import { parseSharePort } from "./shares.js";
import type { ConnectTunnel } from "./tunnel.js";
import type { ConnectStatus } from "./types.js";

// `bb connect` — resolved through the plugin CLI proxy. The dashboard-issued
// command `npx -p bb-app@latest bb connect --code <code> --server <url>` must
// keep working verbatim, so the root command takes the pairing flags and
// `status` / `off` / `expose` / `unexpose` / `shares` / `servers` are subcommands.

interface ParsedFlags {
  flags: Map<string, string | true>;
}

function parseFlags(argv: string[]): ParsedFlags {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument "${arg}".\n\n${helpText()}`);
    }
    const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    if (!rawName) throw new Error(`Invalid flag ${arg}`);
    if (inlineValue !== undefined) {
      flags.set(rawName, inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(rawName, next);
      index += 1;
    } else {
      flags.set(rawName, true);
    }
  }
  return { flags };
}

function stringFlag(parsed: ParsedFlags, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return value === undefined || value === true ? undefined : value;
}

function validateFlags(
  parsed: ParsedFlags,
  options: { boolean?: readonly string[]; value?: readonly string[] },
): void {
  const booleans = new Set(options.boolean ?? []);
  const values = new Set(options.value ?? []);
  for (const [name, value] of parsed.flags) {
    if (!booleans.has(name) && !values.has(name)) {
      throw new Error(`Unknown flag --${name}`);
    }
    if (booleans.has(name) && value !== true) {
      throw new Error(`--${name} does not take a value`);
    }
    if (values.has(name) && value === true) {
      throw new Error(`--${name} requires a value`);
    }
  }
}

function helpText(): string {
  return [
    "Remote access via getbb.app — this bb becomes reachable at https://<handle>.getbb.app.",
    "Share HTTP ports from any enrolled host (owner session only).",
    "",
    "  1. Sign in at https://getbb.app and claim a handle.",
    "  2. Copy the connect command from the dashboard and run it here:",
    "       bb connect --code <code> --server https://<handle>.getbb.app",
    "",
    "  bb connect status              Show remote-access status",
    "  bb connect off                 Disconnect and forget the pairing (re-pairing needs a new code)",
    "  bb connect expose <port> [--host <name-or-id>]    Share a port from the thread's host",
    "  bb connect unexpose <port> [--host <name-or-id>]  Stop sharing a port on that host",
    "  bb connect shares [--host <name-or-id>]           List shares for the thread's host",
    "  bb connect servers             List every bb on this account (from getbb.app)",
    "",
    "The server holds the tunnel; it stays up while bb is running.",
  ].join("\n");
}

function formatStatus(status: ConnectStatus): string {
  if (!status.paired) {
    return "Not paired\nPair from the getbb.app dashboard — run `bb connect` for a how-to.";
  }
  const lines = [`${status.handle}  ${status.url}  ${status.state}`];
  if (status.lastError !== null && status.state !== "connected") {
    lines.push(`  last error: ${status.lastError}`);
  }
  if (status.shares.length > 0) {
    lines.push("  shares:");
    for (const share of status.shares) {
      lines.push(
        `    ${share.hostName} (${share.hostId})  ${share.port}  ${share.url || `unavailable: ${share.unavailableReason ?? "unknown reason"}`}`,
      );
    }
  }
  return lines.join("\n");
}

function asJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function notPairedError(): string {
  return "this bb is not connected to getbb.app — run `bb connect` for how to pair";
}

export function registerConnectCli(args: {
  bb: Pick<BbPluginApi, "cli">;
  tunnel: ConnectTunnel;
  hostResolver: ShareHostResolver;
}): void {
  const { bb, tunnel, hostResolver } = args;
  bb.cli.register({
    name: "connect",
    summary:
      "Expose this bb at https://<handle>.getbb.app (pair with --code/--server from the dashboard)",
    commands: [
      {
        name: "status",
        summary: "Show remote-access status",
        usage: "bb connect status [--json]",
      },
      {
        name: "off",
        summary: "Disconnect and forget the pairing",
        usage: "bb connect off [--json]",
      },
      {
        name: "expose",
        summary: "Share an HTTP port from an enrolled host",
        usage: "bb connect expose <port> [--host <name-or-id>] [--json]",
      },
      {
        name: "unexpose",
        summary: "Stop sharing an HTTP port from a host",
        usage: "bb connect unexpose <port> [--host <name-or-id>] [--json]",
      },
      {
        name: "shares",
        summary: "List shared ports and their public URLs",
        usage: "bb connect shares [--host <name-or-id>] [--json]",
      },
      {
        name: "servers",
        summary: "List every bb server on this account",
        usage: "bb connect servers [--json]",
      },
    ],
    async run(argv, ctx): Promise<PluginCliResult> {
      try {
        const [first] = argv;
        if (first === "status") {
          const parsed = parseFlags(argv.slice(1));
          validateFlags(parsed, { boolean: ["json"] });
          const status = await tunnel.refreshStatus();
          return {
            exitCode: 0,
            stdout: parsed.flags.has("json")
              ? asJson(status)
              : `${formatStatus(status)}\n`,
          };
        }
        if (first === "off") {
          const parsed = parseFlags(argv.slice(1));
          validateFlags(parsed, { boolean: ["json"] });
          const status = await tunnel.disconnect();
          return {
            exitCode: 0,
            stdout: parsed.flags.has("json")
              ? asJson(status)
              : "Disconnected\n",
          };
        }
        if (first === "expose") {
          const portArg = argv[1];
          if (portArg === undefined || portArg.startsWith("--")) {
            return {
              exitCode: 1,
              stderr:
                "Usage: bb connect expose <port> [--host <name-or-id>] [--json]\n",
            };
          }
          const parsed = parseFlags(argv.slice(2));
          validateFlags(parsed, { boolean: ["json"], value: ["host"] });
          if (!tunnel.status().paired) {
            return { exitCode: 1, stderr: `${notPairedError()}\n` };
          }
          const targetHost = await hostResolver.resolve(
            ctx,
            stringFlag(parsed, "host"),
          );
          const listing = await tunnel.expose(
            parseSharePort(portArg),
            targetHost,
          );
          if (parsed.flags.has("json")) {
            return { exitCode: 0, stdout: asJson(listing) };
          }
          return {
            exitCode: 0,
            stdout: `${listing.url}\n`,
          };
        }
        if (first === "unexpose") {
          const portArg = argv[1];
          if (portArg === undefined || portArg.startsWith("--")) {
            return {
              exitCode: 1,
              stderr:
                "Usage: bb connect unexpose <port> [--host <name-or-id>] [--json]\n",
            };
          }
          const parsed = parseFlags(argv.slice(2));
          validateFlags(parsed, { boolean: ["json"], value: ["host"] });
          const targetHost =
            stringFlag(parsed, "host") ?? (await hostResolver.resolveId(ctx));
          const result = await tunnel.unexpose(
            parseSharePort(portArg),
            targetHost,
          );
          if (parsed.flags.has("json")) {
            return { exitCode: 0, stdout: asJson(result) };
          }
          if (!result.removed) {
            return {
              exitCode: 0,
              stdout: `Port ${result.port} was not shared on ${result.hostName} (${result.hostId}) (idempotent).\n`,
            };
          }
          return {
            exitCode: 0,
            stdout: `Stopped sharing port ${result.port} on ${result.hostName} (${result.hostId})\n`,
          };
        }
        if (first === "shares") {
          const parsed = parseFlags(argv.slice(1));
          validateFlags(parsed, { boolean: ["json"], value: ["host"] });
          const targetHost = await hostResolver.resolve(
            ctx,
            stringFlag(parsed, "host"),
          );
          const shares = await tunnel.listShares(targetHost.id);
          if (parsed.flags.has("json")) {
            return {
              exitCode: 0,
              stdout: asJson({ host: targetHost, shares }),
            };
          }
          if (shares.length === 0) {
            return { exitCode: 0, stdout: "No shared ports\n" };
          }
          const lines = shares.map(
            (share) =>
              `${share.hostName} (${share.hostId})  ${share.port}  ${share.url || `unavailable: ${share.unavailableReason ?? "unknown reason"}`}`,
          );
          return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
        }
        if (first === "servers") {
          const parsed = parseFlags(argv.slice(1));
          validateFlags(parsed, { boolean: ["json"] });
          if (!tunnel.status().paired) {
            return { exitCode: 1, stderr: `${notPairedError()}\n` };
          }
          const result = await tunnel.listAccountServers();
          if (parsed.flags.has("json")) {
            return { exitCode: 0, stdout: asJson(result) };
          }
          if (result.servers.length === 0) {
            return { exitCode: 0, stdout: "No servers on this account\n" };
          }
          const handleWidth = Math.max(
            "HANDLE".length,
            ...result.servers.map((s) => s.handle.length),
          );
          const nameWidth = Math.max(
            "NAME".length,
            ...result.servers.map((s) => s.name.length),
          );
          const urlWidth = Math.max(
            "URL".length,
            ...result.servers.map((s) => s.url.length),
          );
          const lines = [
            `${"HANDLE".padEnd(handleWidth)}  ${"NAME".padEnd(nameWidth)}  ${"URL".padEnd(urlWidth)}  LIVE  SELF`,
            ...result.servers.map((s) => {
              const live = s.live ? "yes" : "no";
              const self = s.handle === result.selfHandle ? "*" : "";
              return `${s.handle.padEnd(handleWidth)}  ${s.name.padEnd(nameWidth)}  ${s.url.padEnd(urlWidth)}  ${live.padEnd(4)}  ${self}`;
            }),
          ];
          return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
        }
        if (first !== undefined && !first.startsWith("--")) {
          return {
            exitCode: 1,
            stderr: `Unknown connect command '${first}'.\n\n${helpText()}\n`,
          };
        }
        const parsed = parseFlags(argv);
        validateFlags(parsed, {
          boolean: ["json"],
          value: ["code", "server", "base-url"],
        });
        const code = stringFlag(parsed, "code");
        if (code === undefined) {
          // Bare `bb connect` is a how-to, not an argument error: it is a
          // brand-new user's first command, copied without flags.
          return { exitCode: 0, stdout: `${helpText()}\n` };
        }
        const server = stringFlag(parsed, "server");
        const baseUrl = stringFlag(parsed, "base-url");
        const status = await tunnel.pair({
          code,
          ...(server !== undefined ? { serverUrl: server } : {}),
          ...(baseUrl !== undefined ? { baseUrl } : {}),
        });
        if (parsed.flags.has("json")) {
          return { exitCode: 0, stdout: asJson(status) };
        }
        return {
          exitCode: 0,
          stdout:
            `Paired as ${status.handle} — reachable at ${status.url}\n` +
            "The server holds the tunnel; it stays up while bb is running.\n",
        };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        };
      }
    },
  });
}
