import { existsSync } from "node:fs";
import { join, posix, win32 } from "node:path";

export interface DesktopPathContext {
  appPath: string;
  isPackaged: boolean;
  platform?: NodeJS.Platform;
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

function resolveJoin(paths: DesktopPathContext): typeof join {
  if (paths.platform === "win32") {
    return win32.join;
  }
  if (paths.platform === undefined) {
    return join;
  }
  return posix.join;
}

export function resolveDesktopBridgePath(
  args: ResolveDesktopBridgePathArgs,
): string {
  const joinPaths = resolveJoin(args.paths);
  if (args.paths.isPackaged) {
    if (args.paths.appPath.endsWith(".asar")) {
      return joinPaths(
        `${args.paths.appPath}.unpacked`,
        "dist",
        "bb-app-bridge.mjs",
      );
    }

    return joinPaths(
      args.paths.resourcesPath,
      "app",
      "dist",
      "bb-app-bridge.mjs",
    );
  }

  return joinPaths(args.paths.appPath, "dist", "bb-app-bridge.mjs");
}

export function resolveDesktopIconPath(
  args: ResolveDesktopIconPathArgs,
): string {
  const joinPaths = resolveJoin(args.paths);
  return joinPaths(
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
