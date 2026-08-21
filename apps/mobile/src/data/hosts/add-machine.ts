import type { Host } from "@bb/domain";
import { BbHttpError, type BrowserBbSdk } from "@bb/sdk/browser";
import type { CreateHostJoinCodeResponse } from "@bb/server-contract";
import { z } from "zod";

/**
 * Add-a-machine pairing (mirror of
 * apps/app/src/components/dialogs/AddMachineDialog.tsx): mint a join code
 * plus, when bb connect is paired, a connect machine code, and build the
 * installer one-liner the user runs on the new machine.
 */

const connectMachineCodeSchema = z.object({
  code: z.string(),
  expiresAt: z.number(),
  serverUrl: z.string(),
});
export type ConnectMachineCode = z.infer<typeof connectMachineCodeSchema>;

const pluginRpcErrorEnvelopeSchema = z.object({
  error: z.object({ message: z.string() }),
});

/**
 * Outcome of asking the connect plugin for a machine code.
 * - `issued`: connect is paired; the command routes through getbb.app.
 * - `unpaired`: connect is installed but not paired (or not installed at all).
 * - `disabled`: the connect plugin is turned off; enabling it is the fix.
 * - `unavailable`: a temporary failure (the plugin is still starting).
 */
export type ConnectMachineCodeResult =
  | { kind: "issued"; code: ConnectMachineCode }
  | { kind: "unpaired" }
  | { kind: "disabled" }
  | { kind: "unavailable" };

function isNotPairedRpcError(error: BbHttpError): boolean {
  const envelope = pluginRpcErrorEnvelopeSchema.safeParse(error.body);
  return envelope.success && envelope.data.error.message === "not_paired";
}

async function isConnectPluginDisabled(sdk: BrowserBbSdk): Promise<boolean> {
  try {
    const { plugins } = await sdk.plugins.list();
    const connect = plugins.find((plugin) => plugin.id === "connect");
    return connect !== undefined && !connect.enabled;
  } catch {
    return false;
  }
}

export async function createConnectMachineCode(
  sdk: BrowserBbSdk,
): Promise<ConnectMachineCodeResult> {
  try {
    const code = await sdk.plugins.callRpc({
      pluginId: "connect",
      method: "createMachineCode",
      input: null,
      outputSchema: connectMachineCodeSchema,
    });
    return { kind: "issued", code };
  } catch (error) {
    if (!(error instanceof BbHttpError)) throw error;
    if (
      error.code === "not_paired" ||
      isNotPairedRpcError(error) ||
      error.status === 404
    ) {
      return { kind: "unpaired" };
    }
    if (error.status === 503) {
      return (await isConnectPluginDisabled(sdk))
        ? { kind: "disabled" }
        : { kind: "unavailable" };
    }
    if (error.status === 422) return { kind: "unavailable" };
    throw error;
  }
}

export interface AddMachineCodes {
  join: CreateHostJoinCodeResponse;
  machine: ConnectMachineCodeResult;
}

/** Mint both codes at once (the web dialog's `mintJoinCode` mutation). */
export async function mintAddMachineCodes(
  sdk: BrowserBbSdk,
): Promise<AddMachineCodes> {
  const [join, machine] = await Promise.all([
    sdk.hosts.createJoinCode(),
    createConnectMachineCode(sdk),
  ]);
  return { join, machine };
}

/**
 * The pairing one-liner (the install script's flag contract: `--join-code`,
 * `--host-id`, `--server`, optional `--machine-code`). With a machine code
 * the whole command targets the connect serverUrl the code was minted for;
 * otherwise the server URL the config reports.
 */
export function pairingCommand(
  joinCode: string,
  hostId: string,
  machineCode: ConnectMachineCode | null,
  directServerUrl: string | null,
): string | null {
  const serverUrl = machineCode?.serverUrl ?? directServerUrl;
  if (serverUrl === null) return null;
  const machineFlag =
    machineCode === null ? "" : ` --machine-code ${machineCode.code}`;
  return `curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 ${serverUrl}/install.sh | sh -s -- --join-code ${joinCode} --host-id ${hostId} --server ${serverUrl}${machineFlag}`;
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

function isIpv4Loopback(hostname: string): boolean {
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d+$/u.test(part) && Number(part) <= 255)
  );
}

/**
 * Whether a URL's host is loopback or unspecified (`0.0.0.0`, `::`,
 * `::ffff:127.x`): an address that never routes to another machine, so a
 * pairing command targeting it would dial the new machine itself (web
 * `isLocalOnlyUrl`). Invalid URLs are not local-only.
 */
export function isLocalOnlyUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  const host = normalizeHostname(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "::" || host === "0.0.0.0") return true;
  if (isIpv4Loopback(host)) return true;
  const dotted = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  if (dotted !== null) return isIpv4Loopback(dotted[1] ?? "");
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (hex === null) return false;
  return Number.parseInt(hex[1] ?? "", 16) >> 8 === 127;
}

export type AddMachinePresentation =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "connect-unavailable" }
  | {
      kind: "unreachable";
      serverUrl: string;
      reason: "unpaired" | "disabled";
    }
  | {
      kind: "command";
      command: string;
      /** Earliest expiry of the join code and the machine code. */
      expiresAt: number;
      viaConnect: boolean;
    };

/**
 * What the add-machine sheet shows for the minted codes and the direct
 * server URL (`GET /system/config → serverUrl`). When connect cannot issue a
 * machine code and the only URL is loopback, explain instead of printing a
 * command that dials the wrong machine.
 */
export function resolveAddMachinePresentation(args: {
  codes: AddMachineCodes | null;
  error: string | null;
  serverUrl: string | null;
}): AddMachinePresentation {
  if (args.error !== null) return { kind: "error", message: args.error };
  if (args.codes === null) return { kind: "loading" };
  const { join, machine } = args.codes;
  const localOnlyServerUrl =
    args.serverUrl !== null && isLocalOnlyUrl(args.serverUrl)
      ? args.serverUrl
      : null;
  if (
    (machine.kind === "unpaired" || machine.kind === "disabled") &&
    localOnlyServerUrl !== null
  ) {
    return {
      kind: "unreachable",
      serverUrl: localOnlyServerUrl,
      reason: machine.kind,
    };
  }
  if (machine.kind === "unavailable" && localOnlyServerUrl !== null) {
    return { kind: "connect-unavailable" };
  }
  const machineCode = machine.kind === "issued" ? machine.code : null;
  const command = pairingCommand(
    join.joinCode,
    join.hostId,
    machineCode,
    args.serverUrl,
  );
  if (command === null) {
    return {
      kind: "error",
      message:
        "This server has not reported an address other machines can use.",
    };
  }
  return {
    kind: "command",
    command,
    expiresAt: Math.min(join.expiresAt, machineCode?.expiresAt ?? Infinity),
    viaConnect: machineCode !== null,
  };
}

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * The machine the user just paired: a connected host outside the set known
 * when the sheet opened. Null until one shows up (or before the baseline).
 */
export function findNewlyConnectedHost(
  hosts: readonly Host[] | undefined,
  baselineHostIds: ReadonlySet<string> | null,
): Host | null {
  if (!hosts || baselineHostIds === null) return null;
  return (
    hosts.find(
      (host) => host.status === "connected" && !baselineHostIds.has(host.id),
    ) ?? null
  );
}
