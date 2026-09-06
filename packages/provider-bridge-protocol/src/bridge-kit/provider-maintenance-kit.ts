import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  parseBinaryLookupOutput,
  resolveBinaryLookupCommand,
  resolveNpmCommand,
  resolveNpmGlobalBinDir,
  runPortableCommandCapture,
  type PortableSpawnFn,
} from "./portable-executable.js";
import type {
  ProviderInstallationCommand,
  ProviderInstallationSource,
  ProviderInstallationStatus,
  ProviderInstallationVerification,
} from "../provider-maintenance.js";

const execFileAsync = promisify(execFile);

const CLI_PROBE_TIMEOUT_MS = 5_000;
const INSTALLATION_CHECK_TIMEOUT_MS = 15_000;

export interface ExecutableProbeDeps {
  platform?: NodeJS.Platform;
  runLookup?: (
    file: string,
    args: string[],
  ) => Promise<{ stdout: string }>;
  runCommand?: (
    command: string,
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string }>;
  spawnImpl?: PortableSpawnFn;
}

export async function resolveExecutablePath(
  command: string,
  deps: ExecutableProbeDeps = {},
): Promise<string | null> {
  const platform = deps.platform ?? process.platform;
  if (isAbsoluteForPlatform(command, platform)) {
    try {
      await access(command, fsConstants.X_OK);
      return command;
    } catch {
      return null;
    }
  }
  const runLookup =
    deps.runLookup ??
    ((file, args) =>
      execFileAsync(file, args, { timeout: CLI_PROBE_TIMEOUT_MS }));
  try {
    const { stdout } = await runLookup(
      resolveBinaryLookupCommand(platform),
      [command],
    );
    return parseBinaryLookupOutput(stdout);
  } catch {
    return null;
  }
}

export async function commandOutput(
  command: string,
  args: readonly string[],
  deps: ExecutableProbeDeps = {},
): Promise<string | null> {
  try {
    const { stdout, stderr } = await runProbeCommand(
      command,
      args,
      INSTALLATION_CHECK_TIMEOUT_MS,
      deps,
    );
    return `${stdout}\n${stderr}`.trim();
  } catch {
    return null;
  }
}

export function versionFrom(value: string | null): string | null {
  return (
    value?.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u)?.[1] ?? null
  );
}

export async function readCliVersion(
  command: string,
  deps: ExecutableProbeDeps = {},
): Promise<string | null> {
  try {
    const { stdout, stderr } = await runProbeCommand(
      command,
      ["--version"],
      CLI_PROBE_TIMEOUT_MS,
      deps,
    );
    return (
      `${stdout}\n${stderr}`.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/u)?.[0] ??
      null
    );
  } catch {
    return null;
  }
}

function platformPaths(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function isAbsoluteForPlatform(
  candidate: string,
  platform: NodeJS.Platform,
): boolean {
  return platformPaths(platform).isAbsolute(candidate);
}

function runProbeCommand(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  deps: ExecutableProbeDeps,
): Promise<{ stdout: string; stderr: string }> {
  if (deps.runCommand !== undefined) {
    return deps.runCommand(command, args);
  }
  return runPortableCommandCapture(
    {
      command,
      args,
      timeoutMs,
      ...(deps.platform !== undefined ? { platform: deps.platform } : {}),
    },
    deps.spawnImpl,
  );
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u);
    return match === null
      ? { core: [0, 0, 0], prerelease: null }
      : {
          core: [Number(match[1]), Number(match[2]), Number(match[3])],
          prerelease: match[4] ?? null,
        };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (delta !== 0) return delta;
  }
  if (a.prerelease === null && b.prerelease !== null) return 1;
  if (a.prerelease !== null && b.prerelease === null) return -1;
  if (a.prerelease !== null && b.prerelease !== null) {
    return a.prerelease.localeCompare(b.prerelease);
  }
  return 0;
}

export function npmCommand(
  platform: NodeJS.Platform = process.platform,
): string {
  return resolveNpmCommand(platform);
}

export function formatCommand(
  command: string,
  args: readonly string[],
): string {
  return [command, ...args]
    .map((part) =>
      /^[A-Za-z0-9_./:@+-]+$/u.test(part)
        ? part
        : `'${part.replace(/'/gu, "'\\''")}'`,
    )
    .join(" ");
}

export function npmGlobalInstallCommand(
  npmPackage: string,
  platform: NodeJS.Platform = process.platform,
): ProviderInstallationCommand {
  const command = npmCommand(platform);
  const args = ["install", "-g", `${npmPackage}@latest`];
  return { command, args, displayCommand: formatCommand(command, args) };
}

export async function npmLatestVersion(
  npmPackage: string,
  deps: ExecutableProbeDeps = {},
): Promise<string | null> {
  return versionFrom(
    await commandOutput(
      npmCommand(deps.platform),
      ["view", npmPackage, "version"],
      deps,
    ),
  );
}

export interface NpmGlobalPackageProbe {
  npmBin: string | null;
  npmGlobalPackageVersion: string | null;
}

export async function probeNpmGlobalPackage(
  npmPackage: string,
  deps: ExecutableProbeDeps = {},
): Promise<NpmGlobalPackageProbe> {
  const platform = deps.platform ?? process.platform;
  const npm = npmCommand(platform);
  const [prefixOutput, listOutput] = await Promise.all([
    commandOutput(npm, ["prefix", "-g"], deps),
    commandOutput(npm, ["list", "-g", npmPackage, "--depth=0", "--json"], deps),
  ]);
  const npmPrefix = firstLine(prefixOutput);
  return {
    npmBin:
      npmPrefix === null
        ? null
        : resolveNpmGlobalBinDir(npmPrefix, platform),
    npmGlobalPackageVersion: npmGlobalPackageVersion(listOutput, npmPackage),
  };
}

function firstLine(value: string | null): string | null {
  return (
    value
      ?.split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function npmGlobalPackageVersion(
  value: string | null,
  npmPackage: string,
): string | null {
  if (value === null) return null;
  try {
    const parsed = z
      .object({
        dependencies: z
          .record(z.string(), z.object({ version: z.string().min(1) }))
          .default({}),
      })
      .safeParse(JSON.parse(value));
    return parsed.success
      ? (parsed.data.dependencies[npmPackage]?.version ?? null)
      : null;
  } catch {
    return null;
  }
}

function pathIsInside(
  child: string,
  parent: string,
  platform: NodeJS.Platform,
): boolean {
  const paths = platformPaths(platform);
  const relativePath = paths.relative(
    paths.resolve(parent),
    paths.resolve(child),
  );
  if (platform === "win32") {
    const lowered = relativePath.toLowerCase();
    return (
      lowered === "" ||
      (!lowered.startsWith("..") && !paths.isAbsolute(relativePath))
    );
  }
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !paths.isAbsolute(relativePath))
  );
}

export function npmGlobalInstallSource(args: {
  installed: boolean;
  executablePath: string | null;
  npmBin: string | null;
  platform?: NodeJS.Platform;
}): ProviderInstallationSource {
  const platform = args.platform ?? process.platform;
  return !args.installed
    ? "notInstalled"
    : args.executablePath !== null &&
        args.npmBin !== null &&
        pathIsInside(args.executablePath, args.npmBin, platform)
      ? "npmGlobal"
      : "external";
}

export function installationVerification(
  status: Pick<ProviderInstallationStatus, "currentVersion" | "latestVersion">,
  action: "install" | "update",
): ProviderInstallationVerification {
  return action === "install"
    ? { kind: "installed" }
    : status.latestVersion !== null
      ? { kind: "version_at_least", version: status.latestVersion }
      : {
          kind: "version_changed",
          previousVersion: status.currentVersion ?? "unknown",
        };
}

function quotePosixShellWord(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function quotePowerShellSingleQuoted(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

function assertHttpsInstallerUrl(url: string): void {
  if (!/^https:\/\/\S+$/u.test(url)) {
    throw new Error(
      `Refusing to build an installer command for a non-HTTPS URL: ${url}`,
    );
  }
}

export function downloadedInstallerCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): ProviderInstallationCommand {
  assertHttpsInstallerUrl(url);
  if (platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$tmp = Join-Path $env:TEMP ('provider-installation-' + [Guid]::NewGuid().ToString('N') + '.sh')",
      `try { Invoke-WebRequest -Uri ${quotePowerShellSingleQuoted(url)} -OutFile $tmp; $bash = Get-Command bash -ErrorAction SilentlyContinue; if (-not $bash) { throw 'bash not found: install Git for Windows or run the provider installer manually' }; & $bash.Source $tmp } finally { Remove-Item $tmp -ErrorAction SilentlyContinue }`,
    ].join("; ");
    const command = "powershell.exe";
    const args = [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ];
    return {
      command,
      args,
      displayCommand: `${command} -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "${script}"`,
    };
  }
  const script = [
    'tmp=$(mktemp "${TMPDIR:-/tmp}/provider-installation.XXXXXX")',
    "trap 'rm -f \"$tmp\"' EXIT",
    `curl -fsSL ${quotePosixShellWord(url)} -o "$tmp"`,
    'bash "$tmp"',
  ].join(" && ");
  return { command: "sh", args: ["-c", script], displayCommand: script };
}

export function clampPercent(value: number): number {
  return Math.min(
    100,
    Math.max(0, Math.round(Number.isFinite(value) ? value : 0)),
  );
}
