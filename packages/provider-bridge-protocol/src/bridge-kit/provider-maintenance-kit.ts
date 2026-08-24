/**
 * The maintenance toolkit behind `provider/health`, `provider/usage` and
 * `provider/installation/*` for a bridge that fronts a user-installed CLI:
 * the host-local probes (where is the executable, what version does it
 * print, what does npm know about its global package), the version compare
 * those answers feed, and the install-action plumbing (an npm global
 * install, a downloaded installer script, the verification the runtime
 * checks an install run against).
 *
 * What a bridge keeps to itself is its provider's own policy: the minimum
 * supported version, the login command, the credential files and usage
 * endpoints, and how "needs an update" reads for that CLI.
 */
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type {
  ProviderInstallationCommand,
  ProviderInstallationSource,
  ProviderInstallationStatus,
  ProviderInstallationVerification,
} from "../provider-maintenance.js";

const execFileAsync = promisify(execFile);

/** `which` and `--version`: a CLI that cannot answer in 5 s is not there. */
const CLI_PROBE_TIMEOUT_MS = 5_000;
/** npm's registry round-trips and a CLI's self-diagnostics get 15 s. */
const INSTALLATION_CHECK_TIMEOUT_MS = 15_000;

/**
 * The executable's absolute path: the path itself when `command` is
 * absolute and executable (a launch seam may name one), otherwise the first
 * `which`/`where` hit; null when the host has no such command.
 */
export async function resolveExecutablePath(
  command: string,
): Promise<string | null> {
  if (path.isAbsolute(command)) {
    try {
      await access(command, fsConstants.X_OK);
      return command;
    } catch {
      return null;
    }
  }
  try {
    const lookup = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(lookup, [command], {
      timeout: CLI_PROBE_TIMEOUT_MS,
    });
    return (
      stdout
        .split(/\r?\n/u)
        .find((line) => line.trim())
        ?.trim() ?? null
    );
  } catch {
    return null;
  }
}

/**
 * `<command> <args>` stdout and stderr, trimmed, within the installation
 * check budget; null when the command is missing, fails or times out.
 */
export async function commandOutput(
  command: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      timeout: INSTALLATION_CHECK_TIMEOUT_MS,
    });
    return `${stdout}\n${stderr}`.trim();
  } catch {
    return null;
  }
}

/** The first `x.y.z[-prerelease]` token in `value` (an optional `v` prefix dropped). */
export function versionFrom(value: string | null): string | null {
  return (
    value?.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u)?.[1] ?? null
  );
}

/**
 * `<command> --version` → the version it printed (stdout or stderr), null
 * when the command is missing or does not answer within the probe budget.
 */
export async function readCliVersion(command: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ["--version"], {
      timeout: CLI_PROBE_TIMEOUT_MS,
    });
    return (
      `${stdout}\n${stderr}`.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/u)?.[0] ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * Semver-style compare: numeric core first, then a prerelease sorts before
 * its release (`1.2.0-beta.1` < `1.2.0`). Anything that is not `x.y.z[-pre]`
 * reads as `0.0.0`.
 */
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

/** The npm executable for this platform. */
export function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/** A command line for display: each argument single-quoted unless it is plain. */
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

/**
 * `npm install -g <package>@latest`: the install action for an npm-published
 * CLI, and the update action for one without a self-updater.
 */
export function npmGlobalInstallCommand(
  npmPackage: string,
): ProviderInstallationCommand {
  const command = npmCommand();
  const args = ["install", "-g", `${npmPackage}@latest`];
  return { command, args, displayCommand: formatCommand(command, args) };
}

/** The registry's latest version of the package (`npm view <package> version`). */
export async function npmLatestVersion(
  npmPackage: string,
): Promise<string | null> {
  return versionFrom(
    await commandOutput(npmCommand(), ["view", npmPackage, "version"]),
  );
}

export interface NpmGlobalPackageProbe {
  /** npm's global bin directory (`npm prefix -g`, plus `bin` off Windows); null when npm is absent. */
  npmBin: string | null;
  /** The version npm has installed globally for the package; null when none. */
  npmGlobalPackageVersion: string | null;
}

/** What npm knows about a globally installed package. */
export async function probeNpmGlobalPackage(
  npmPackage: string,
): Promise<NpmGlobalPackageProbe> {
  const npm = npmCommand();
  const [prefixOutput, listOutput] = await Promise.all([
    commandOutput(npm, ["prefix", "-g"]),
    commandOutput(npm, ["list", "-g", npmPackage, "--depth=0", "--json"]),
  ]);
  const npmPrefix = firstLine(prefixOutput);
  return {
    npmBin:
      npmPrefix === null
        ? null
        : process.platform === "win32"
          ? npmPrefix
          : path.join(npmPrefix, "bin"),
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

function pathIsInside(child: string, parent: string): boolean {
  const relativePath = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

/**
 * Where an installed CLI came from: inside npm's global bin directory it is
 * npm's (`npmGlobal`), anywhere else it is the user's own (`external`).
 */
export function npmGlobalInstallSource(args: {
  installed: boolean;
  executablePath: string | null;
  npmBin: string | null;
}): ProviderInstallationSource {
  return !args.installed
    ? "notInstalled"
    : args.executablePath !== null &&
        args.npmBin !== null &&
        pathIsInside(args.executablePath, args.npmBin)
      ? "npmGlobal"
      : "external";
}

/**
 * How the runtime verifies an install run: an install is done once the
 * executable exists; an update is done once the version reaches the latest
 * the status saw, or — when the registry was unreachable — once it changed.
 */
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

/**
 * A vendor's `curl | bash` installer, run from a temp file so a truncated
 * download never executes half a script.
 */
export function downloadedInstallerCommand(
  url: string,
): ProviderInstallationCommand {
  const script = [
    'tmp=$(mktemp "${TMPDIR:-/tmp}/provider-installation.XXXXXX")',
    "trap 'rm -f \"$tmp\"' EXIT",
    `curl -fsSL ${url} -o "$tmp"`,
    'bash "$tmp"',
  ].join(" && ");
  return { command: "sh", args: ["-c", script], displayCommand: script };
}

/** A usage percentage as the integer 0–100 the usage surfaces render. */
export function clampPercent(value: number): number {
  return Math.min(
    100,
    Math.max(0, Math.round(Number.isFinite(value) ? value : 0)),
  );
}
