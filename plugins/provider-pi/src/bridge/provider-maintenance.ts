import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  type ProviderHealthResult,
  type ProviderInstallationRunResult,
  type ProviderInstallationStatus,
  experimental_compareVersions as compareVersions,
  experimental_formatCommand as formatCommand,
  experimental_installationVerification as installationVerification,
  experimental_npmGlobalInstallCommand as npmGlobalInstallCommand,
  experimental_npmGlobalInstallSource as npmGlobalInstallSource,
  experimental_npmLatestVersion as npmLatestVersion,
  experimental_probeNpmGlobalPackage as probeNpmGlobalPackage,
  experimental_resolveExecutablePath as resolveExecutablePath,
  experimental_versionFrom as versionFrom,
} from "@get-bb/plugin-sdk/provider-bridge";
import { resolvePiLaunch } from "./rpc-child.js";

const execFileAsync = promisify(execFile);
export const PI_MINIMUM_SUPPORTED_VERSION = "0.84.0";
export const PI_NPM_PACKAGE = "@earendil-works/pi-coding-agent";
const VERSION_PROBE_TIMEOUT_MS = 15_000;
const INSTALL_GATE_TTL_MS = 30_000;

type PiVersionProbe =
  | { version: string; failure: null }
  | { version: null; failure: string };

const piVersionProbeFailureSchema = z
  .object({
    code: z.union([z.string(), z.number()]).nullable().optional(),
    killed: z.boolean().optional(),
    message: z.string().optional(),
    signal: z.string().nullable().optional(),
  })
  .passthrough()
  .transform((value) => Object.assign(new Error(value.message ?? ""), value));

export async function probePiVersion(): Promise<PiVersionProbe> {
  const launch = resolvePiLaunch(process.env);
  const display = formatCommand(launch.command, [...launch.args, "--version"]);
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      launch.command,
      [...launch.args, "--version"],
      {
        timeout: VERSION_PROBE_TIMEOUT_MS,
      },
    ));
  } catch (error) {
    const parsedError = piVersionProbeFailureSchema.safeParse(error);
    return {
      version: null,
      failure: `\`${display}\` ${describePiVersionProbeFailure(
        parsedError.success ? parsedError.data : new Error(String(error)),
      )}`,
    };
  }
  const version = versionFrom(stdout);
  return version === null
    ? { version: null, failure: `\`${display}\` printed no version` }
    : { version, failure: null };
}

export function describePiVersionProbeFailure(
  error: Error & {
    code?: string | number | null;
    killed?: boolean;
    signal?: string | null;
  },
): string {
  if (error.killed === true) {
    return `timed out after ${VERSION_PROBE_TIMEOUT_MS / 1000} s`;
  }
  if (error.signal !== undefined && error.signal !== null) {
    return `was stopped by ${error.signal} before it answered`;
  }
  if (error.code !== undefined && error.code !== null) {
    return `exited with ${String(error.code)}`;
  }
  return error.message;
}

export async function getPiProviderInstallationStatus(): Promise<ProviderInstallationStatus> {
  const launch = resolvePiLaunch(process.env);
  const [resolvedExecutable, probe, latestVersion, npmGlobal] =
    await Promise.all([
      resolveExecutablePath(launch.command),
      probePiVersion(),
      npmLatestVersion(PI_NPM_PACKAGE),
      probeNpmGlobalPackage(PI_NPM_PACKAGE),
    ]);
  const currentVersion = probe.version;
  const installed = resolvedExecutable !== null || currentVersion !== null;
  const needsUpdate =
    installed &&
    currentVersion !== null &&
    latestVersion !== null &&
    compareVersions(latestVersion, currentVersion) > 0;
  const versionUnsupported =
    installed &&
    currentVersion !== null &&
    compareVersions(currentVersion, PI_MINIMUM_SUPPORTED_VERSION) < 0;
  const actionKind = !installed
    ? "install"
    : needsUpdate || versionUnsupported
      ? "update"
      : null;

  return {
    executableName: "pi",
    executablePath: resolvedExecutable,
    installed,
    installSource: npmGlobalInstallSource({
      installed,
      executablePath: resolvedExecutable,
      npmBin: npmGlobal.npmBin,
    }),
    currentVersion,
    latestVersion,
    minimumSupportedVersion: PI_MINIMUM_SUPPORTED_VERSION,
    npmPackageName: PI_NPM_PACKAGE,
    npmGlobalPackageVersion: npmGlobal.npmGlobalPackageVersion,
    installAction:
      actionKind === null
        ? null
        : {
            kind: actionKind,
            label: actionKind === "install" ? "Install" : "Update",
            command: npmGlobalInstallCommand(PI_NPM_PACKAGE).displayCommand,
          },
    needsUpdate,
    versionUnsupported,
  };
}

export async function getPiProviderInstallationRun(
  action: "install" | "update",
): Promise<ProviderInstallationRunResult> {
  const status = await getPiProviderInstallationStatus();
  if (status.installAction?.kind !== action) {
    return {
      available: false,
      message: `Pi ${action} is no longer available on this host.`,
    };
  }
  return {
    available: true,
    command: npmGlobalInstallCommand(PI_NPM_PACKAGE),
    verification: installationVerification(status, action),
  };
}

export function piHealthResult(
  status:
    | "ready"
    | "not_installed"
    | "unauthenticated"
    | "unsupported_version"
    | "unknown",
  args: {
    installedVersion?: string | null;
    statusMessage?: string | null;
  } = {},
): ProviderHealthResult {
  return {
    supported: true,
    health: {
      status,
      statusMessage: args.statusMessage ?? null,
      accountEmail: null,
      planLabel: null,
      installedVersion: args.installedVersion ?? null,
      minimumSupportedVersion: PI_MINIMUM_SUPPORTED_VERSION,
      canInstall: true,
      canUpdate: status !== "not_installed",
      loginCommand: "pi",
    },
  };
}

export type PiInstallGate =
  | { ok: true; installedVersion: string }
  | {
      ok: false;
      status: "not_installed" | "unsupported_version" | "unknown";
      statusMessage: string | null;
      result: ProviderHealthResult;
    };

const INSTALL_GUIDANCE = `Install ${PI_NPM_PACKAGE} ${PI_MINIMUM_SUPPORTED_VERSION} or newer: ${npmGlobalInstallCommand(PI_NPM_PACKAGE).displayCommand}`;

async function probePiInstallGate(): Promise<PiInstallGate> {
  const launch = resolvePiLaunch(process.env);
  if ((await resolveExecutablePath(launch.command)) === null) {
    return {
      ok: false,
      status: "not_installed",
      statusMessage: null,
      result: piHealthResult("not_installed"),
    };
  }
  const probe = await probePiVersion();
  if (probe.version === null) {
    const statusMessage = `Could not determine the pi version: ${probe.failure}. ${INSTALL_GUIDANCE}`;
    return {
      ok: false,
      status: "unknown",
      statusMessage,
      result: piHealthResult("unknown", { statusMessage }),
    };
  }
  const installedVersion = probe.version;
  if (compareVersions(installedVersion, PI_MINIMUM_SUPPORTED_VERSION) < 0) {
    const statusMessage = `Pi ${installedVersion} is older than the supported minimum ${PI_MINIMUM_SUPPORTED_VERSION}. ${INSTALL_GUIDANCE}`;
    return {
      ok: false,
      status: "unsupported_version",
      statusMessage,
      result: piHealthResult("unsupported_version", {
        installedVersion,
        statusMessage,
      }),
    };
  }
  return { ok: true, installedVersion };
}

const installGateMemo = new Map<
  string,
  { expiresAt: number; gate: Promise<PiInstallGate> }
>();

export function getPiInstallGate(): Promise<PiInstallGate> {
  const launch = resolvePiLaunch(process.env);
  const key = JSON.stringify([launch.command, launch.args]);
  const now = Date.now();
  const cached = installGateMemo.get(key);
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.gate;
  }
  const gate = probePiInstallGate();
  installGateMemo.set(key, { expiresAt: now + INSTALL_GATE_TTL_MS, gate });
  gate.catch(() => {
    if (installGateMemo.get(key)?.gate === gate) installGateMemo.delete(key);
  });
  return gate;
}

export function resetPiInstallGateForTests(): void {
  installGateMemo.clear();
}
