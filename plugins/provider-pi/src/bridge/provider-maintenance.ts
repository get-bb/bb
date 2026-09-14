import { execFile } from "node:child_process";
import { open, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  type ExperimentalPackageInstallerResolution as PackageInstallerResolution,
  type ExperimentalPackageManagerPreference as PackageManagerPreference,
  type ProviderHealthResult,
  type ProviderInstallationCommand,
  type ProviderInstallationRunResult,
  type ProviderInstallationStatus,
  experimental_commandOutput as commandOutput,
  experimental_compareVersions as compareVersions,
  experimental_formatCommand as formatCommand,
  experimental_installationVerification as installationVerification,
  experimental_npmLatestVersion as npmLatestVersion,
  experimental_probeNpmGlobalPackage as probeNpmGlobalPackage,
  experimental_resolveExecutablePath as resolveExecutablePath,
  experimental_resolvePackageInstaller as resolvePackageInstaller,
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

function bunCommand(): string {
  return process.platform === "win32" ? "bun.exe" : "bun";
}

function bunGlobalInstallCommand(
  npmPackage: string,
): ProviderInstallationCommand {
  const command = bunCommand();
  const args = ["add", "-g", `${npmPackage}@latest`];
  return { command, args, displayCommand: formatCommand(command, args) };
}

function firstOutputLine(output: string | null): string | null {
  return (
    output
      ?.split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function pathIsInside(child: string, parent: string): boolean {
  const relativePath = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function expandHomePath(value: string): string {
  const home = os.homedir();
  if (value.startsWith("$HOME/")) return path.join(home, value.slice(6));
  if (value.startsWith("${HOME}/")) return path.join(home, value.slice(8));
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  return value;
}

async function shellExecTarget(executablePath: string): Promise<string | null> {
  const handle = await open(executablePath, "r").catch(() => null);
  if (handle === null) return null;
  try {
    const buffer = Buffer.alloc(8_192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const source = buffer.subarray(0, bytesRead).toString("utf8");
    if (!source.startsWith("#!")) return null;
    for (const line of source.split(/\r?\n/u)) {
      const match = line.match(/^\s*exec\s+(?:"([^"]+)"|'([^']+)'|(\S+))/u);
      const target = match?.[1] ?? match?.[2] ?? match?.[3];
      if (target !== undefined) return expandHomePath(target);
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function isBunManagedPi(executablePath: string | null): Promise<boolean> {
  if (executablePath === null) return false;
  const bunBin = firstOutputLine(
    await commandOutput(bunCommand(), ["pm", "bin", "-g"]),
  );
  if (bunBin === null) return false;
  if (pathIsInside(executablePath, bunBin)) return true;
  const bunPi = path.join(
    bunBin,
    process.platform === "win32" ? "pi.exe" : "pi",
  );
  const [resolvedExecutable, resolvedBunPi] = await Promise.all([
    realpath(executablePath).catch(() => null),
    realpath(bunPi).catch(() => null),
  ]);
  if (
    resolvedExecutable !== null &&
    (pathIsInside(resolvedExecutable, bunBin) ||
      resolvedExecutable === resolvedBunPi)
  ) {
    return true;
  }
  const delegatedTarget = await shellExecTarget(executablePath);
  if (delegatedTarget === null) return false;
  if (path.resolve(delegatedTarget) === path.resolve(bunPi)) return true;
  const resolvedDelegatedTarget = await realpath(delegatedTarget).catch(
    () => null,
  );
  return (
    resolvedDelegatedTarget !== null &&
    resolvedDelegatedTarget === resolvedBunPi
  );
}

async function piInstallationCommand(
  packageManager: PackageManagerPreference,
  installer: PackageInstallerResolution,
  executablePath: string | null,
  action: "install" | "update",
): Promise<ProviderInstallationCommand> {
  const packageCommand =
    action === "install" ? installer.installCommand : installer.updateCommand;
  if (packageManager !== "auto" || installer.packageManager === "mise") {
    return packageCommand;
  }
  return (await isBunManagedPi(executablePath))
    ? bunGlobalInstallCommand(PI_NPM_PACKAGE)
    : packageCommand;
}

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
    return {
      version: null,
      failure: `\`${display}\` ${describePiVersionProbeFailure(error)}`,
    };
  }
  const version = versionFrom(stdout);
  return version === null
    ? { version: null, failure: `\`${display}\` printed no version` }
    : { version, failure: null };
}

export function describePiVersionProbeFailure(error: unknown): string {
  const failed =
    error !== null && typeof error === "object"
      ? (error as { code?: unknown; killed?: unknown; signal?: unknown })
      : null;
  if (failed?.killed === true) {
    return `timed out after ${VERSION_PROBE_TIMEOUT_MS / 1000} s`;
  }
  if (typeof failed?.signal === "string") {
    return `was stopped by ${failed.signal} before it answered`;
  }
  if (failed?.code !== undefined && failed.code !== null) {
    return `exited with ${String(failed.code)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

interface PiInstallationDetails {
  status: ProviderInstallationStatus;
  installer: PackageInstallerResolution;
}

async function resolvePiInstallationDetails(
  packageManager: PackageManagerPreference,
): Promise<PiInstallationDetails> {
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

  const installer = await resolvePackageInstaller({
    packageManager,
    npmPackage: PI_NPM_PACKAGE,
    installed,
    executablePath: resolvedExecutable,
    npmBin: npmGlobal.npmBin,
    latestVersion,
  });

  const installAction: ProviderInstallationStatus["installAction"] =
    actionKind === null
      ? null
      : {
          kind: actionKind,
          label: actionKind === "install" ? "Install" : "Update",
          command: (
            await piInstallationCommand(
              packageManager,
              installer,
              resolvedExecutable,
              actionKind,
            )
          ).displayCommand,
        };

  const status: ProviderInstallationStatus = {
    executableName: "pi",
    executablePath: resolvedExecutable,
    installed,
    installSource: installer.source,
    currentVersion,
    latestVersion,
    minimumSupportedVersion: PI_MINIMUM_SUPPORTED_VERSION,
    npmPackageName: PI_NPM_PACKAGE,
    npmGlobalPackageVersion: npmGlobal.npmGlobalPackageVersion,
    installAction,
    shadowingInstall: installer.shadowingInstall,
    needsUpdate,
    versionUnsupported,
  };

  return { status, installer };
}

export async function getPiProviderInstallationStatus(
  packageManager: PackageManagerPreference,
): Promise<ProviderInstallationStatus> {
  return (await resolvePiInstallationDetails(packageManager)).status;
}

export async function getPiProviderInstallationRun(
  packageManager: PackageManagerPreference,
  action: "install" | "update",
): Promise<ProviderInstallationRunResult> {
  const { status, installer } =
    await resolvePiInstallationDetails(packageManager);
  if (status.installAction?.kind !== action) {
    return {
      available: false,
      message: `Pi ${action} is no longer available on this host.`,
    };
  }
  return {
    available: true,
    command: await piInstallationCommand(
      packageManager,
      installer,
      status.executablePath,
      action,
    ),
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

async function piInstallGuidance(executablePath: string): Promise<string> {
  const npmGlobal = await probeNpmGlobalPackage(PI_NPM_PACKAGE);
  const installer = await resolvePackageInstaller({
    packageManager: "auto",
    npmPackage: PI_NPM_PACKAGE,
    installed: true,
    executablePath,
    npmBin: npmGlobal.npmBin,
    latestVersion: null,
  });
  const command = await piInstallationCommand(
    "auto",
    installer,
    executablePath,
    "install",
  );
  return `Install ${PI_NPM_PACKAGE} ${PI_MINIMUM_SUPPORTED_VERSION} or newer: ${command.displayCommand}`;
}

async function probePiInstallGate(): Promise<PiInstallGate> {
  const launch = resolvePiLaunch(process.env);
  const executablePath = await resolveExecutablePath(launch.command);
  if (executablePath === null) {
    return {
      ok: false,
      status: "not_installed",
      statusMessage: null,
      result: piHealthResult("not_installed"),
    };
  }
  const probe = await probePiVersion();
  if (probe.version === null) {
    const statusMessage = `Could not determine the pi version: ${probe.failure}. ${await piInstallGuidance(executablePath)}`;
    return {
      ok: false,
      status: "unknown",
      statusMessage,
      result: piHealthResult("unknown", { statusMessage }),
    };
  }
  const installedVersion = probe.version;
  if (compareVersions(installedVersion, PI_MINIMUM_SUPPORTED_VERSION) < 0) {
    const statusMessage = `Pi ${installedVersion} is older than the supported minimum ${PI_MINIMUM_SUPPORTED_VERSION}. ${await piInstallGuidance(executablePath)}`;
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
