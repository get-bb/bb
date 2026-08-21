import { existsSync } from "node:fs";
import { join } from "node:path";

export interface DesktopPathContext {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
}

interface ResolveDesktopBridgePathArgs {
  paths: DesktopPathContext;
}

interface ResolveDesktopIconPathArgs {
  packagedIconFileName: string;
  paths: DesktopPathContext;
}

interface AssertPathExistsArgs {
  label: string;
  path: string;
}

export function resolveDesktopBridgePath(
  args: ResolveDesktopBridgePathArgs,
): string {
  if (args.paths.isPackaged) {
    if (args.paths.appPath.endsWith(".asar")) {
      return join(
        `${args.paths.appPath}.unpacked`,
        "dist",
        "bb-app-bridge.mjs",
      );
    }

    return join(args.paths.resourcesPath, "app", "dist", "bb-app-bridge.mjs");
  }

  return join(args.paths.appPath, "dist", "bb-app-bridge.mjs");
}

export function resolveDesktopIconPath(
  args: ResolveDesktopIconPathArgs,
): string {
  return join(
    args.paths.appPath,
    "assets",
    args.paths.isPackaged ? args.packagedIconFileName : "icon-dev.png",
  );
}

export function assertPathExists(args: AssertPathExistsArgs): void {
  if (!existsSync(args.path)) {
    throw new Error(`Missing ${args.label}: ${args.path}`);
  }
}
