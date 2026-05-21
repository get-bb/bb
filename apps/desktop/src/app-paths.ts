import { existsSync } from "node:fs";
import { join } from "node:path";

export interface DesktopPathContext {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
}

export interface ResolveDesktopBridgePathArgs {
  paths: DesktopPathContext;
}

export interface ResolveDesktopAssetPathArgs {
  fileName: string;
  paths: DesktopPathContext;
}

export interface AssertPathExistsArgs {
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

export function resolveDesktopAssetPath(
  args: ResolveDesktopAssetPathArgs,
): string {
  return join(args.paths.appPath, "assets", args.fileName);
}

export function assertPathExists(args: AssertPathExistsArgs): void {
  if (!existsSync(args.path)) {
    throw new Error(`Missing ${args.label}: ${args.path}`);
  }
}
