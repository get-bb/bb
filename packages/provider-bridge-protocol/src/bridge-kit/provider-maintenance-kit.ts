import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type {
  PackageManagerPreference,
  ProviderInstallationCommand,
  ProviderInstallationShadowingInstall,
  ProviderInstallationSource,
  ProviderInstallationStatus,
  ProviderInstallationVerification,
} from "../provider-maintenance.js";

const execFileAsync = promisify(execFile);

const CLI_PROBE_TIMEOUT_MS = 5_000;
const INSTALLATION_CHECK_TIMEOUT_MS = 15_000;

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

export function versionFrom(value: string | null): string | null {
  return (
    value?.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u)?.[1] ?? null
  );
}

export async function readCliVersion(command: string): Promise<string | null> {
  try {
    const probe = execFileAsync(command, ["--version"], {
      timeout: CLI_PROBE_TIMEOUT_MS,
    });
    probe.child.stdin?.end();
    const { stdout, stderr } = await probe;
    return (
      `${stdout}\n${stderr}`.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/u)?.[0] ??
      null
    );
  } catch {
    return null;
  }
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

export function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
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
): ProviderInstallationCommand {
  const command = npmCommand();
  const args = ["install", "-g", `${npmPackage}@latest`];
  return { command, args, displayCommand: formatCommand(command, args) };
}

export async function npmLatestVersion(
  npmPackage: string,
): Promise<string | null> {
  return versionFrom(
    await commandOutput(npmCommand(), ["view", npmPackage, "version"]),
  );
}

export interface NpmGlobalPackageProbe {
  npmBin: string | null;
  npmGlobalPackageVersion: string | null;
}

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

export function clampPercent(value: number): number {
  return Math.min(
    100,
    Math.max(0, Math.round(Number.isFinite(value) ? value : 0)),
  );
}

export interface MiseKitIo {
  commandStdout(
    command: string,
    args: readonly string[],
  ): Promise<string | null>;
  isExecutable(filePath: string): Promise<boolean>;
  realpath(filePath: string): Promise<string | null>;
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

function defaultMiseKitIo(): MiseKitIo {
  return {
    async commandStdout(command, args) {
      try {
        const { stdout } = await execFileAsync(command, [...args], {
          timeout: INSTALLATION_CHECK_TIMEOUT_MS,
        });
        return stdout;
      } catch {
        return null;
      }
    },
    async isExecutable(filePath) {
      try {
        await access(filePath, fsConstants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    async realpath(filePath) {
      try {
        return await realpath(filePath);
      } catch {
        return null;
      }
    },
    env: process.env,
    homeDir: homedir(),
  };
}

function miseExecutableName(): string {
  return process.platform === "win32" ? "mise.exe" : "mise";
}

export async function resolveMiseBinary(
  pathEnv: string | undefined,
  io: MiseKitIo = defaultMiseKitIo(),
): Promise<string | null> {
  const directories = [
    ...(pathEnv ?? "").split(path.delimiter).filter(Boolean),
    path.join(io.homeDir, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const directory of directories) {
    const candidate = path.join(directory, miseExecutableName());
    if (await io.isExecutable(candidate)) return candidate;
  }
  return null;
}

function miseDataDir(io: MiseKitIo): string {
  return (
    io.env.MISE_DATA_DIR ??
    path.join(
      io.env.XDG_DATA_HOME ?? path.join(io.homeDir, ".local", "share"),
      "mise",
    )
  );
}

const miseListEntrySchema = z.object({
  version: z.string().min(1),
  requested_version: z.string().min(1).optional(),
  install_path: z.string().min(1),
  installed: z.boolean(),
  active: z.boolean().optional(),
});

function miseListEntry(
  output: string | null,
): z.infer<typeof miseListEntrySchema> | null {
  if (output === null) return null;
  try {
    const parsed = z
      .array(miseListEntrySchema.passthrough())
      .safeParse(JSON.parse(output));
    if (!parsed.success) return null;
    const installed = parsed.data.filter((entry) => entry.installed);
    return (
      installed.find((entry) => entry.active === true) ?? installed[0] ?? null
    );
  } catch {
    return null;
  }
}

export interface MisePackageProbe {
  installDir: string | null;
  installedVersion: string | null;
  requestedVersion: string | null;
  active: boolean;
  executableManaged: boolean;
  shadowingInstall: ProviderInstallationShadowingInstall | null;
}

export async function probeMisePackage(
  args: {
    mise: string;
    npmPackage: string;
    executablePath: string | null;
    npmBin: string | null;
  },
  io: MiseKitIo = defaultMiseKitIo(),
): Promise<MisePackageProbe> {
  const entry = miseListEntry(
    await io.commandStdout(args.mise, [
      "-y",
      "ls",
      "--json",
      `npm:${args.npmPackage}`,
    ]),
  );
  if (entry === null) {
    return {
      installDir: null,
      installedVersion: null,
      requestedVersion: null,
      active: false,
      executableManaged: false,
      shadowingInstall: null,
    };
  }
  const installDir = entry.install_path;
  const installsDir = path.dirname(path.dirname(installDir));
  const shimsDir = io.env.MISE_SHIMS_DIR ?? path.join(miseDataDir(io), "shims");
  const realExecutable =
    args.executablePath === null
      ? null
      : ((await io.realpath(args.executablePath)) ?? args.executablePath);
  const executableManaged =
    args.executablePath !== null &&
    realExecutable !== null &&
    (pathIsInside(args.executablePath, shimsDir) ||
      pathIsInside(args.executablePath, installDir) ||
      pathIsInside(realExecutable, installDir));
  return {
    installDir,
    installedVersion: entry.version,
    requestedVersion: entry.requested_version ?? null,
    active: entry.active === true,
    executableManaged,
    shadowingInstall:
      args.executablePath === null ||
      realExecutable === null ||
      executableManaged
        ? null
        : shadowingInstall({
            npmPackage: args.npmPackage,
            executablePath: args.executablePath,
            realExecutable,
            miseNodeDir: path.join(installsDir, "node"),
            npmBin: args.npmBin,
          }),
  };
}

function shadowingInstall(args: {
  npmPackage: string;
  executablePath: string;
  realExecutable: string;
  miseNodeDir: string;
  npmBin: string | null;
}): ProviderInstallationShadowingInstall | null {
  const npm = npmCommand();
  if (pathIsInside(args.realExecutable, args.miseNodeDir)) {
    const nodeVersionDir = path
      .relative(args.miseNodeDir, args.realExecutable)
      .split(path.sep)[0];
    if (nodeVersionDir === undefined || nodeVersionDir === "") return null;
    const prefix = path.join(args.miseNodeDir, nodeVersionDir);
    return {
      executablePath: args.executablePath,
      removeCommand: formatCommand(npm, [
        "uninstall",
        "-g",
        "--prefix",
        prefix,
        args.npmPackage,
      ]),
    };
  }
  if (args.npmBin !== null && pathIsInside(args.executablePath, args.npmBin)) {
    return {
      executablePath: args.executablePath,
      removeCommand: formatCommand(npm, ["uninstall", "-g", args.npmPackage]),
    };
  }
  return null;
}

export function misePackageSpec(
  requestedVersion: string | null,
  latestVersion: string | null,
): string {
  if (requestedVersion === null) return "latest";
  if (!/^\d/u.test(requestedVersion)) return requestedVersion;
  return latestVersion ?? "latest";
}

export function miseUseCommand(
  mise: string,
  npmPackage: string,
  spec: string,
): ProviderInstallationCommand {
  const args = ["use", "-g", "-y", `npm:${npmPackage}@${spec}`];
  return {
    command: mise,
    args,
    displayCommand: formatCommand("mise", args),
  };
}

export interface PackageInstallerResolution {
  packageManager: "mise" | "npm";
  source: ProviderInstallationSource;
  installCommand: ProviderInstallationCommand;
  updateCommand: ProviderInstallationCommand;
  shadowingInstall: ProviderInstallationShadowingInstall | null;
}

export async function resolvePackageInstaller(
  args: {
    packageManager: PackageManagerPreference;
    npmPackage: string;
    installed: boolean;
    executablePath: string | null;
    npmBin: string | null;
    latestVersion: string | null;
  },
  io: MiseKitIo = defaultMiseKitIo(),
): Promise<PackageInstallerResolution> {
  const mise = await resolveMiseBinary(io.env.PATH, io);
  const probe =
    mise === null
      ? null
      : await probeMisePackage(
          {
            mise,
            npmPackage: args.npmPackage,
            executablePath: args.executablePath,
            npmBin: args.npmBin,
          },
          io,
        );
  const managed = probe?.installDir != null;
  const useMise =
    args.packageManager === "mise" ||
    (args.packageManager === "auto" && managed);
  const source: ProviderInstallationSource = !args.installed
    ? "notInstalled"
    : probe?.executableManaged
      ? "mise"
      : npmGlobalInstallSource({
          installed: true,
          executablePath: args.executablePath,
          npmBin: args.npmBin,
        });
  const miseBinary = mise ?? miseExecutableName();
  return {
    packageManager: useMise ? "mise" : "npm",
    source,
    installCommand: useMise
      ? miseUseCommand(miseBinary, args.npmPackage, "latest")
      : npmGlobalInstallCommand(args.npmPackage),
    updateCommand: useMise
      ? miseUseCommand(
          miseBinary,
          args.npmPackage,
          misePackageSpec(probe?.requestedVersion ?? null, args.latestVersion),
        )
      : npmGlobalInstallCommand(args.npmPackage),
    shadowingInstall: probe?.shadowingInstall ?? null,
  };
}
