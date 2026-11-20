import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import type { TailscaleControls } from "./rpc.js";
import type { TailscaleStatus } from "./types.js";

const DESCRIPTION = [
  "Reach this bb privately at https://<machine>.<tailnet>.ts.net through Tailscale Serve.",
  "The tailnet is the access boundary: only devices on your tailnet that its ACLs allow can reach the address.",
  "",
  "`bb tailscale setup` runs `tailscale serve --bg --https=443 <bb's loopback URL>` on the server's machine,",
  "or uses bb's own port (https://<machine>.<tailnet>.ts.net:<bb port>) when another service already has 443.",
  "It never replaces someone else's Serve mapping or shadows a service already listening on the tailnet address.",
  "A Serve mapping you made yourself that points at bb is adopted as it is.",
  "`bb tailscale teardown` removes only the mapping bb created.",
  "Tailscale must be installed, signed in, with MagicDNS and HTTPS certificates on in the tailnet.",
].join("\n");

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const STATE_TEXT: Record<TailscaleStatus["state"], string> = {
  "not-installed": "not installed",
  "not-running": "not running",
  "logged-out": "signed out",
  "needs-approval": "waiting for approval",
  "needs-magicdns": "MagicDNS is off",
  "needs-https": "HTTPS certificates are off",
  "not-served": "not set up",
  conflict: "Serve ports in use",
  served: "serving bb",
  error: "error",
};

export function formatStatus(status: TailscaleStatus): string {
  const state =
    status.state !== "served"
      ? STATE_TEXT[status.state]
      : status.https?.result === "other-server"
        ? "set up, but reaches a different bb server"
        : status.https?.result === "no-answer"
          ? "set up, but not answering"
          : status.serve?.funnel === true
            ? "public on the internet (Funnel is on)"
            : STATE_TEXT.served;
  const lines = [`Tailscale: ${state}`];
  if (status.serve !== null) {
    lines.push(
      `  address: ${status.serve.url}${status.serve.owner === "adopted" ? "  (set up outside bb; adopted)" : ""}`,
    );
  }
  if (status.https !== null) {
    lines.push(
      `  https: ${status.https.result === "ok" ? "ok" : `failing (${status.https.error ?? "unknown error"})`}`,
    );
  }
  if (status.message !== null) {
    lines.push(
      `  ${status.message}${status.adminUrl === null ? "" : `: ${status.adminUrl}`}`,
    );
  }
  if (status.dnsName !== null) lines.push(`  machine: ${status.dnsName}`);
  if (status.tailnet !== null) lines.push(`  tailnet: ${status.tailnet}`);
  lines.push(`  forwards to: ${status.target}`);
  if (status.cliPath !== null) {
    lines.push(
      `  cli: ${status.cliPath}${status.version === null ? "" : ` (${status.version})`}`,
    );
  }
  return lines.join("\n");
}

function asJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
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
      { code: "tailscale_failed" },
    );
  }
}

export function registerTailscaleCli(
  bb: Pick<BbPluginApi, "cli">,
  controls: TailscaleControls,
): void {
  bb.cli.register(
    defineCli({
      name: "tailscale",
      summary:
        "Reach this bb privately at https://<machine>.<tailnet>.ts.net through Tailscale Serve",
      description: DESCRIPTION,
      commands: {
        status: cliCommand({
          summary:
            "Show whether Tailscale Serve reaches this bb, and its address",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await controls.status();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(status)
                  : `${formatStatus(status)}\n`,
              };
            }),
        }),
        setup: cliCommand({
          summary:
            "Set up Tailscale Serve for this bb (port 443, or bb's own port when 443 is taken)",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await controls.setup();
              if (input.options.json) {
                return { exitCode: 0, stdout: asJson(status) };
              }
              const url = status.serve?.url ?? "its tailnet address";
              return {
                exitCode: 0,
                stdout:
                  status.serve?.owner === "adopted"
                    ? `Tailscale Serve already reaches this bb at ${url}; bb adopted that mapping without changing it.\n`
                    : `This bb now answers at ${url} on your tailnet.\n`,
              };
            }),
        }),
        teardown: cliCommand({
          summary: "Remove the Tailscale Serve mapping bb created",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await controls.teardown();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(status)
                  : "bb's Tailscale Serve mapping is removed. Other Serve mappings are untouched.\n",
              };
            }),
        }),
      },
    }),
  );
}
