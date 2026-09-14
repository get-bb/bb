import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { PackageManagerPreference } from "@bb/domain";
import {
  type MiseKitIo,
  probeMisePackage,
  resolveMiseBinary,
} from "@bb/provider-bridge-protocol/bridge-kit";

const BB_APP_NPM_PACKAGE = "bb-app";
export const NPM_UPGRADE_COMMAND = "npx bb-app@latest";
export const MISE_UPGRADE_COMMAND = "mise use -g npm:bb-app@latest";

interface ResolveBbAppUpgradeCommandArgs {
  packageManager: PackageManagerPreference;
  pathEnv: string | undefined;
  bundlePath?: string;
  io?: MiseKitIo;
}

function pathIsInside(child: string, parent: string): boolean {
  const relativePath = relative(parent, child);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

async function packageJsonName(directory: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    return parsed !== null &&
      typeof parsed === "object" &&
      "name" in parsed &&
      typeof parsed.name === "string"
      ? parsed.name
      : null;
  } catch {
    return null;
  }
}

async function findBbAppPackageRoot(
  bundlePath: string,
): Promise<string | null> {
  let directory = dirname(bundlePath);
  while (true) {
    if ((await packageJsonName(directory)) === BB_APP_NPM_PACKAGE) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export async function resolveBbAppUpgradeCommand(
  args: ResolveBbAppUpgradeCommandArgs,
): Promise<string> {
  if (args.packageManager === "npm") return NPM_UPGRADE_COMMAND;
  if (args.packageManager === "mise") return MISE_UPGRADE_COMMAND;
  const mise = await resolveMiseBinary(args.pathEnv, args.io);
  if (mise === null) return NPM_UPGRADE_COMMAND;
  const [probe, packageRoot] = await Promise.all([
    probeMisePackage(
      {
        mise,
        npmPackage: BB_APP_NPM_PACKAGE,
        executablePath: null,
        npmBin: null,
      },
      args.io,
    ),
    findBbAppPackageRoot(args.bundlePath ?? fileURLToPath(import.meta.url)),
  ]);
  const probedInstallDir = probe.active ? probe.installDir : null;
  if (probedInstallDir === null || packageRoot === null) {
    return NPM_UPGRADE_COMMAND;
  }
  const [installDir, resolvedPackageRoot] = await Promise.all([
    realpath(probedInstallDir).catch(() => probedInstallDir),
    realpath(packageRoot).catch(() => packageRoot),
  ]);
  return pathIsInside(resolvedPackageRoot, installDir)
    ? MISE_UPGRADE_COMMAND
    : NPM_UPGRADE_COMMAND;
}
