import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import {
  mobilePairingPayload,
  type MobilePairingPayload,
} from "@bb/connect-client";
import type { ShareHostResolver } from "./hosts.js";
import { MachineCodeError } from "./machine-code.js";
import type { MobilePairingGate } from "./rpc.js";
import { parseSharePort } from "./shares.js";
import type { ConnectTunnel } from "./tunnel.js";
import type { ConnectStatus } from "./types.js";

const DESCRIPTION = [
  "Remote access via getbb.app — this bb becomes reachable at https://<handle>.getbb.app.",
  "Share HTTP ports from any enrolled host (owner session only).",
  "",
  "  1. Sign in at https://getbb.app and claim a handle.",
  "  2. Copy the connect command from the dashboard and run it here:",
  "       bb connect --code <code> --server https://<handle>.getbb.app",
  "",
  "The server holds the tunnel; it stays up while bb is running.",
].join("\n");

const HOST_OPTION = {
  type: "string",
  placeholder: "name-or-id",
  description: "Enrolled host to act on; defaults to the thread's host",
} as const;

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

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

function notPairedError(): PluginCliError {
  return new PluginCliError(
    "this bb is not connected to getbb.app — run `bb connect` for how to pair",
    { code: "not_paired" },
  );
}

function machineCodeError(
  error: MachineCodeError,
  dashboardUrl: string,
): PluginCliError {
  switch (error.code) {
    case "not_paired":
      return notPairedError();
    case "machine_limit":
      return new PluginCliError(
        `this account has reached its connect machine limit — revoke a device you no longer use at ${dashboardUrl}, then try again`,
        { code: "machine_limit" },
      );
    case "network":
      return new PluginCliError(
        "could not reach the connect service to mint a machine code — check the connection and try again",
        { code: "network" },
      );
  }
}

function formatMachineCode(payload: MobilePairingPayload): string {
  const minutes = Math.max(
    0,
    Math.round((payload.expiresAt - Date.now()) / 60_000),
  );
  return [
    `Code:       ${payload.code}`,
    `Server:     ${payload.serverUrl}`,
    `Apex:       ${payload.apex}`,
    `Expires:    ${new Date(payload.expiresAt).toISOString()} (in about ${minutes} min)`,
    "",
    "Enter the code in the bb mobile app when it asks to pair over bb connect (or",
    "scan the QR code from Settings → Remote access → Add mobile device). The phone",
    "enrolls as a connect machine on this account — it appears in the getbb.app",
    "dashboard's machine list, where you can revoke it. The code works once.",
  ].join("\n");
}

async function attempt(
  work: () => Promise<PluginCliResult>,
): Promise<PluginCliResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PluginCliError) throw error;
    throw new PluginCliError(
      error instanceof Error ? error.message : String(error),
      { code: "connect_failed" },
    );
  }
}

export function registerConnectCli(args: {
  bb: Pick<BbPluginApi, "cli">;
  tunnel: ConnectTunnel;
  hostResolver: ShareHostResolver;
  mobilePairing: MobilePairingGate;
}): void {
  const { bb, tunnel, hostResolver, mobilePairing } = args;
  bb.cli.register(
    defineCli({
      name: "connect",
      summary:
        "Expose this bb at https://<handle>.getbb.app (pair with --code/--server from the dashboard)",
      description: DESCRIPTION,
      root: cliCommand({
        summary: "Pair this bb with a getbb.app handle",
        options: {
          code: {
            type: "string",
            placeholder: "code",
            description: "One-time pairing code from the getbb.app dashboard",
          },
          server: {
            type: "string",
            placeholder: "url",
            description: "Server URL the dashboard printed for the handle",
          },
          "base-url": {
            type: "string",
            placeholder: "url",
            description: "Connect service base URL; only for local testing",
          },
          json: JSON_OPTION,
        },
        run: (input) =>
          attempt(async () => {
            const code = input.options.code;
            if (code === undefined) {
              return { exitCode: 0, stdout: input.help };
            }
            const server = input.options.server;
            const baseUrl = input.options["base-url"];
            const status = await tunnel.pair({
              code,
              ...(server !== undefined ? { serverUrl: server } : {}),
              ...(baseUrl !== undefined ? { baseUrl } : {}),
            });
            if (input.options.json) {
              return { exitCode: 0, stdout: asJson(status) };
            }
            return {
              exitCode: 0,
              stdout:
                `Paired as ${status.handle} — reachable at ${status.url}\n` +
                "The server holds the tunnel; it stays up while bb is running.\n",
            };
          }),
      }),
      commands: {
        status: cliCommand({
          summary: "Show remote-access status",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await tunnel.refreshStatus();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(status)
                  : `${formatStatus(status)}\n`,
              };
            }),
        }),
        off: cliCommand({
          summary: "Disconnect and forget the pairing",
          description:
            "Re-pairing needs a new code from the getbb.app dashboard.",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await tunnel.disconnect();
              return {
                exitCode: 0,
                stdout: input.options.json ? asJson(status) : "Disconnected\n",
              };
            }),
        }),
        expose: cliCommand({
          summary: "Share an HTTP port from an enrolled host",
          positionals: [
            {
              name: "port",
              description: "TCP port to share, 1-65535",
              required: true,
            },
          ],
          options: { host: HOST_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              if (!tunnel.status().paired) throw notPairedError();
              const targetHost = await hostResolver.resolve(
                ctx,
                input.options.host,
              );
              const listing = await tunnel.expose(
                parseSharePort(input.positionals.port),
                targetHost,
              );
              if (input.options.json) {
                return { exitCode: 0, stdout: asJson(listing) };
              }
              return { exitCode: 0, stdout: `${listing.url}\n` };
            }),
        }),
        unexpose: cliCommand({
          summary: "Stop sharing an HTTP port from a host",
          positionals: [
            {
              name: "port",
              description: "TCP port to stop sharing",
              required: true,
            },
          ],
          options: { host: HOST_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const targetHost =
                input.options.host ?? (await hostResolver.resolveId(ctx));
              const result = await tunnel.unexpose(
                parseSharePort(input.positionals.port),
                targetHost,
              );
              if (input.options.json) {
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
            }),
        }),
        shares: cliCommand({
          summary: "List shared ports and their public URLs",
          suggestFor: ["list", "ls", "ports"],
          options: { host: HOST_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const targetHost = await hostResolver.resolve(
                ctx,
                input.options.host,
              );
              const shares = await tunnel.listShares(targetHost.id);
              if (input.options.json) {
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
            }),
        }),
        servers: cliCommand({
          summary: "List every bb server on this account",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              if (!tunnel.status().paired) throw notPairedError();
              const result = await tunnel.listAccountServers();
              if (input.options.json) {
                return { exitCode: 0, stdout: asJson(result) };
              }
              if (result.servers.length === 0) {
                return { exitCode: 0, stdout: "No servers on this account\n" };
              }
              const handleWidth = Math.max(
                "HANDLE".length,
                ...result.servers.map((server) => server.handle.length),
              );
              const nameWidth = Math.max(
                "NAME".length,
                ...result.servers.map((server) => server.name.length),
              );
              const urlWidth = Math.max(
                "URL".length,
                ...result.servers.map((server) => server.url.length),
              );
              const lines = [
                `${"HANDLE".padEnd(handleWidth)}  ${"NAME".padEnd(nameWidth)}  ${"URL".padEnd(urlWidth)}  LIVE  SELF`,
                ...result.servers.map((server) => {
                  const live = server.live ? "yes" : "no";
                  const self = server.handle === result.selfHandle ? "*" : "";
                  return `${server.handle.padEnd(handleWidth)}  ${server.name.padEnd(nameWidth)}  ${server.url.padEnd(urlWidth)}  ${live.padEnd(4)}  ${self}`;
                }),
              ];
              return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
            }),
        }),
        "machine-code": cliCommand({
          summary:
            'Mint a one-time code that enrolls the bb mobile app as a connect machine (needs the "Mobile app" experiment)',
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              if (!(await mobilePairing.enabled())) {
                throw new PluginCliError(
                  'mobile pairing is off — turn on the "Mobile app" experiment in Settings → Experiments (or `bb settings experiment mobileApp true`), then run this again',
                  { code: "mobile_pairing_disabled" },
                );
              }
              let payload: MobilePairingPayload;
              try {
                payload = mobilePairingPayload(
                  await tunnel.createMachineCode(),
                );
              } catch (error) {
                if (error instanceof MachineCodeError) {
                  throw machineCodeError(error, tunnel.status().dashboardUrl);
                }
                throw error;
              }
              if (input.options.json) {
                return { exitCode: 0, stdout: asJson(payload) };
              }
              return { exitCode: 0, stdout: `${formatMachineCode(payload)}\n` };
            }),
        }),
      },
    }),
  );
}
