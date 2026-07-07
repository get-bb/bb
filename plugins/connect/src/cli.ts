import type { BbPluginApi, PluginCliResult } from "@bb/plugin-sdk";
import type { ConnectTunnel } from "./tunnel.js";
import type { ConnectStatus } from "./types.js";

// `bb connect` — resolved through the plugin CLI proxy. The dashboard-issued
// command `npx -p bb-app@latest bb connect --code <code> --server <url>` must
// keep working verbatim, so the root command takes the pairing flags and
// `status` / `off` are subcommands (same surface as the kernel-era command).

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

function helpText(): string {
  return [
    "Remote access via getbb.app — this bb becomes reachable at https://<handle>.getbb.app.",
    "",
    "  1. Sign in at https://getbb.app and claim a handle.",
    "  2. Copy the connect command from the dashboard and run it here:",
    "       bb connect --code <code> --server https://<handle>.getbb.app",
    "",
    "  bb connect status   Show remote-access status",
    "  bb connect off      Disconnect and forget the pairing (re-pairing needs a new code)",
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
  return lines.join("\n");
}

function asJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function registerConnectCli(args: {
  bb: Pick<BbPluginApi, "cli">;
  tunnel: ConnectTunnel;
}): void {
  const { bb, tunnel } = args;
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
    ],
    async run(argv): Promise<PluginCliResult> {
      try {
        const [first] = argv;
        if (first === "status") {
          const parsed = parseFlags(argv.slice(1));
          const status = tunnel.status();
          return {
            exitCode: 0,
            stdout: parsed.flags.has("json")
              ? asJson(status)
              : `${formatStatus(status)}\n`,
          };
        }
        if (first === "off") {
          const parsed = parseFlags(argv.slice(1));
          const status = await tunnel.disconnect();
          return {
            exitCode: 0,
            stdout: parsed.flags.has("json") ? asJson(status) : "Disconnected\n",
          };
        }
        if (first !== undefined && !first.startsWith("--")) {
          return {
            exitCode: 1,
            stderr: `Unknown connect command '${first}'.\n\n${helpText()}\n`,
          };
        }
        const parsed = parseFlags(argv);
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
