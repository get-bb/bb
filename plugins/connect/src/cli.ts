import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import {
  deriveConnectBaseUrl,
  mobilePairingPayload,
  type MobilePairingPayload,
} from "@bb/connect-client";
import {
  accountErrorCode,
  AccountUnavailableError,
  type AccountClient,
} from "./account-client.js";
import type { HostedConnectApi } from "./hosted.js";
import type { ShareHostResolver } from "./hosts.js";
import { MachineCodeError } from "./machine-code.js";
import type { RemoteAccessSwitch } from "./rpc.js";
import { parseSharePort } from "./shares.js";
import type { ConnectTunnel } from "./tunnel.js";
import type { ConnectStatus } from "./types.js";
import type { SealedAccess } from "./sealed/sealed-access.js";
import type {
  SealedDeviceCode,
  SealedDeviceSummary,
  SealedStatus,
} from "./sealed/types.js";

const DESCRIPTION = [
  "Remote access via getbb.app — this bb becomes reachable at https://<handle>.getbb.app.",
  "Share HTTP ports from any enrolled host (owner session only).",
  "",
  "  1. Sign this bb in to your bb account:",
  "       bb account login",
  "     (or paste a dashboard code: bb connect --code <code>, which also turns",
  "     remote access back on)",
  "  2. Remote access starts on its own and stays up while bb is running.",
  "",
  "`bb connect off` turns remote access off and keeps the account signed in;",
  "`bb connect on` turns it back on; `bb account logout` forgets the pairing.",
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

const PAIR_ERROR_TEXT: Record<string, string> = {
  invalid_code:
    "that code is invalid or has expired — get a new one from the getbb.app dashboard",
  expired_code:
    "that code has expired — get a new one from the getbb.app dashboard",
  already_used:
    "that code was already used — get a new one from the getbb.app dashboard",
  network: "couldn't reach getbb.app — check the connection and try again",
  unauthorized:
    "getbb.app rejected the new pairing — get a new code from the getbb.app dashboard and try again",
  profile_unavailable:
    "this bb saved the pairing, but getbb.app didn't return your account yet — bb keeps retrying, and remote access starts once it does (see `bb account status`)",
  superseded:
    "another sign-in or a sign-out replaced this one — run `bb account status` to see which account this bb uses",
};

function formatStatus(status: ConnectStatus): string {
  if (!status.paired) {
    return "Not signed in to a bb account\nRun `bb account status` to see why, or `bb account login` to sign in; remote access starts once the account is ready.";
  }
  if (!status.enabled) {
    return `${status.handle}  ${status.url}  off\nRemote access is off. Run \`bb connect on\` to turn it back on.`;
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
    "this bb isn't signed in to a bb account — run `bb account login`",
    { code: "not_paired" },
  );
}

function pairError(error: unknown): PluginCliError {
  if (error instanceof AccountUnavailableError) {
    return new PluginCliError(
      "the bb account plugin isn't running — enable it in Settings → Plugins, then try again",
      { code: "account_unavailable" },
    );
  }
  const code = accountErrorCode(error);
  return new PluginCliError(PAIR_ERROR_TEXT[code] ?? code, { code });
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
    ...(payload.sealed !== undefined
      ? [
          `Encryption: ${payload.sealed.fingerprint} (server key; the phone pins it and enrolls with device code ${payload.sealed.deviceCode})`,
        ]
      : []),
    "",
    "Enter the code in the bb mobile app when it asks to pair over bb connect (or",
    "scan the QR code from Settings → Mobile → Add mobile device). The phone",
    "enrolls as a connect machine on this account — it appears in the getbb.app",
    "dashboard's machine list, where you can revoke it. The code works once.",
  ].join("\n");
}

function formatDevice(device: SealedDeviceSummary): string {
  const state =
    device.status === "approved"
      ? device.connected
        ? "approved, connected"
        : "approved"
      : device.status;
  const seen =
    device.lastSeenAt === null
      ? "never seen"
      : `seen ${new Date(device.lastSeenAt).toISOString()}`;
  const via = device.approvedVia === null ? "" : `  via ${device.approvedVia}`;
  return `${device.id}  ${device.name} (${device.surface})  ${state}${via}  ${device.fingerprint}  ${seen}`;
}

function formatSealedStatus(status: SealedStatus): string {
  const pending = status.devices.filter(
    (device) => device.status === "pending",
  );
  const approved = status.devices.filter(
    (device) => device.status === "approved",
  );
  const lines = [
    `End-to-end encryption: ${status.required ? "required for remote access" : "available (not required)"}`,
    `Server key fingerprint: ${status.fingerprint}`,
    `Sealed connections: ${status.activeChannels}`,
    `Devices: ${approved.length} approved, ${pending.length} pending`,
  ];
  if (pending.length > 0) {
    lines.push("Pending approval:");
    for (const device of pending) lines.push(`  ${formatDevice(device)}`);
    lines.push(
      "Approve with `bb connect approve-device <id>` after comparing the fingerprint shown on that device.",
    );
  }
  return lines.join("\n");
}

function formatDeviceCode(code: SealedDeviceCode): string {
  const minutes = Math.max(
    0,
    Math.round((code.expiresAt - Date.now()) / 60_000),
  );
  return [
    `Device code:            ${code.code}`,
    `Server key fingerprint: ${code.fingerprint}`,
    `Expires:                ${new Date(code.expiresAt).toISOString()} (in about ${minutes} min)`,
    "",
    "Enter the code on the device when it asks to verify this bb's encryption. The",
    "device and this bb each prove they know the code without sending it, so a",
    "relay that impersonates this bb cannot use it; the device then pins this key",
    "and is approved without a manual step. The code works once.",
  ].join("\n");
}

function assertLocalCaller(ctx: { experimental_remoteCaller?: boolean }): void {
  if (ctx.experimental_remoteCaller === true) {
    throw new PluginCliError(
      "this command changes remote-access trust and only runs from the computer running bb, not through bb connect",
      { code: "local_only" },
    );
  }
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
  account: AccountClient;
  hosted: HostedConnectApi;
  hostResolver: ShareHostResolver;
  remoteAccess: RemoteAccessSwitch;
  sealed: SealedAccess;
}): void {
  const { bb, tunnel, account, hosted, hostResolver, remoteAccess, sealed } =
    args;
  const deviceIdPositional = [
    {
      name: "device",
      description: "Device id from `bb connect devices`",
      required: true,
    },
  ] as const;
  bb.cli.register(
    defineCli({
      name: "connect",
      summary:
        "Expose this bb at https://<handle>.getbb.app once it is signed in to your bb account",
      description: DESCRIPTION,
      root: cliCommand({
        summary:
          "Sign in with a dashboard code (bb account login --code) and turn remote access on",
        options: {
          code: {
            type: "string",
            placeholder: "code",
            description:
              "One-time pairing code from the getbb.app dashboard; signs this bb in to your bb account",
          },
          server: {
            type: "string",
            placeholder: "url",
            description:
              "Server URL the dashboard printed, https://<handle>.getbb.app or https://<handle>.vibecodethis.site; only its apex origin is used",
          },
          "base-url": {
            type: "string",
            placeholder: "url",
            description:
              "getbb.app origin: https://getbb.app or https://vibecodethis.site (development builds also accept http://bb.localhost:<port>)",
          },
          json: JSON_OPTION,
        },
        constraints: [
          { kind: "requires", option: "server", needs: ["code"] },
          { kind: "requires", option: "base-url", needs: ["code"] },
        ],
        run: (input) =>
          attempt(async () => {
            const code = input.options.code;
            if (code === undefined) {
              return { exitCode: 0, stdout: input.help };
            }
            const server = input.options.server;
            const baseUrl =
              input.options["base-url"] ??
              (server === undefined ? null : deriveConnectBaseUrl(server));
            let status: ConnectStatus;
            try {
              status = await tunnel.signIn(
                async () =>
                  (await account.redeemCode({ code: code.trim(), baseUrl }))
                    .account,
              );
            } catch (error) {
              const failure = pairError(error);
              if (failure.code === "profile_unavailable") {
                await remoteAccess.set(true);
              }
              throw failure;
            }
            if (!status.enabled) status = await remoteAccess.set(true);
            if (input.options.json) {
              return { exitCode: 0, stdout: asJson(status) };
            }
            return {
              exitCode: 0,
              stdout:
                `Paired as ${status.handle} — reachable at ${status.url}\n` +
                "This bb is signed in to your bb account (see `bb account status`); the server holds the tunnel while bb is running.\n" +
                (sealed.required
                  ? "Sealed connections are required: the first browser or phone waits for `bb connect approve-device <id>` or a code from `bb connect device-code`. Turn this off with `bb connect require-encryption off`.\n"
                  : ""),
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
          summary: "Turn remote access off and stay signed in",
          description:
            "Closes the tunnel until `bb connect on`. This bb stays signed in to your bb account; `bb account logout` forgets the pairing.",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await remoteAccess.set(false);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(status)
                  : "Remote access is off. This bb stays signed in to your bb account; run `bb connect on` to turn it back on, or `bb account logout` to forget the pairing.\n",
              };
            }),
        }),
        on: cliCommand({
          summary: "Turn remote access back on",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await remoteAccess.set(true);
              if (input.options.json) {
                return { exitCode: 0, stdout: asJson(status) };
              }
              return {
                exitCode: 0,
                stdout: status.paired
                  ? `Remote access is on — reachable at ${status.url}\n`
                  : "Remote access is on. Run `bb account login` to sign in; the tunnel starts once you do.\n",
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
        "unexpose-all": cliCommand({
          summary: "Stop sharing all HTTP ports on a machine",
          options: {
            host: {
              type: "string",
              placeholder: "id",
              description: "Machine ID; defaults to the thread's host",
            },
            json: JSON_OPTION,
          },
          run: (input, ctx) =>
            attempt(async () => {
              const hostId =
                input.options.host ?? (await hostResolver.resolveId(ctx));
              const result = await tunnel.unexposeAll(hostId);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(result)
                  : `Stopped sharing ${result.removed} ports on ${hostId}\n`,
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
              const identity = tunnel.getIdentity();
              if (identity === null) throw notPairedError();
              const result = await hosted.listAccountServers(identity);
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
            "Mint a one-time code that enrolls the bb mobile app as a connect machine",
          options: { json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              assertLocalCaller(ctx);
              if (tunnel.getIdentity() === null) throw notPairedError();
              let payload: MobilePairingPayload;
              try {
                const machineCode = await hosted.createMachineCode(
                  AbortSignal.timeout(10_000),
                );
                const deviceCode = await sealed.createDeviceCode();
                payload = mobilePairingPayload(machineCode, {
                  serverKey: deviceCode.serverKey,
                  fingerprint: deviceCode.fingerprint,
                  deviceCode: deviceCode.code,
                });
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
        encryption: cliCommand({
          summary:
            "Show sealed connection status: server key fingerprint, policy, and devices",
          suggestFor: ["e2ee", "sealed", "fingerprint"],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await sealed.status();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(status)
                  : `${formatSealedStatus(status)}\n`,
              };
            }),
        }),
        "require-encryption": cliCommand({
          summary:
            "Require sealed connections for remote API and realtime traffic (on|off)",
          positionals: [
            {
              name: "mode",
              description:
                "on to require sealed connections, off to allow readable relay traffic",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              assertLocalCaller(ctx);
              const mode = input.positionals.mode;
              if (mode !== "on" && mode !== "off") {
                throw new PluginCliError("mode must be on or off", {
                  code: "invalid_mode",
                });
              }
              const wasRequired = sealed.required;
              const status = await sealed.setRequired(mode === "on");
              const notice =
                mode === "on" && !wasRequired
                  ? [
                      "",
                      "Devices approved while encryption was optional need approval again: run `bb connect approve-device <id>` or pair them with a new device code.",
                      "If this bb was reachable through Connect while encryption was optional, also run `bb connect rotate-key` so a key copied over the readable tunnel cannot impersonate this bb.",
                    ].join("\n")
                  : "";
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(status)
                  : `${formatSealedStatus(status)}${notice}\n`,
              };
            }),
        }),
        devices: cliCommand({
          summary: "List devices that opened sealed connections to this bb",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const devices = await sealed.listDevices();
              if (input.options.json) {
                return { exitCode: 0, stdout: asJson(devices) };
              }
              if (devices.length === 0) {
                return { exitCode: 0, stdout: "No sealed devices\n" };
              }
              return {
                exitCode: 0,
                stdout: `${devices.map(formatDevice).join("\n")}\n`,
              };
            }),
        }),
        "approve-device": cliCommand({
          summary:
            "Approve a pending device after comparing its fingerprint with the one it displays",
          positionals: deviceIdPositional,
          options: { json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              assertLocalCaller(ctx);
              const device = await sealed.approveDevice(
                input.positionals.device,
              );
              if (device === null) {
                throw new PluginCliError(
                  `no sealed device ${input.positionals.device}`,
                  { code: "unknown_device" },
                );
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(device)
                  : `Approved ${formatDevice(device)}\n`,
              };
            }),
        }),
        "revoke-device": cliCommand({
          summary: "Revoke a device; its sealed connections close immediately",
          positionals: deviceIdPositional,
          options: { json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              assertLocalCaller(ctx);
              const device = await sealed.revokeDevice(
                input.positionals.device,
              );
              if (device === null) {
                throw new PluginCliError(
                  `no sealed device ${input.positionals.device}`,
                  { code: "unknown_device" },
                );
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(device)
                  : `Revoked ${formatDevice(device)}\n`,
              };
            }),
        }),
        "remove-device": cliCommand({
          summary:
            "Forget a device record; the device must enroll again to connect",
          positionals: deviceIdPositional,
          options: { json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              assertLocalCaller(ctx);
              const removed = await sealed.removeDevice(
                input.positionals.device,
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson({ removed })
                  : removed
                    ? `Removed ${input.positionals.device}\n`
                    : `No sealed device ${input.positionals.device} (idempotent)\n`,
              };
            }),
        }),
        "device-code": cliCommand({
          summary:
            "Mint a one-time code that pins this bb's key on a device and approves it",
          options: { json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              assertLocalCaller(ctx);
              const code = await sealed.createDeviceCode();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(code)
                  : `${formatDeviceCode(code)}\n`,
              };
            }),
        }),
        "rotate-key": cliCommand({
          summary:
            "Replace this bb's encryption identity; every device must verify the new fingerprint",
          options: {
            yes: {
              type: "boolean",
              description: "Confirm the rotation",
            },
            json: JSON_OPTION,
          },
          run: (input, ctx) =>
            attempt(async () => {
              assertLocalCaller(ctx);
              if (!input.options.yes) {
                throw new PluginCliError(
                  "rotating the key disconnects every sealed device until it verifies the new fingerprint; re-run with --yes",
                  { code: "confirmation_required" },
                );
              }
              const status = await sealed.rotateIdentity();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(status)
                  : `Rotated. New server key fingerprint: ${status.fingerprint}\n`,
              };
            }),
        }),
      },
    }),
  );
}
