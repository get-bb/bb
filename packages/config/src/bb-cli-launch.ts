import { basename, dirname, join } from "node:path";

export interface BbCliLaunchSpec {
  jsEntryPath: string;
  shellPath: string;
}

export interface BbCliSpawnArgv {
  command: string;
  args: string[];
}

export function bbJsEntryFileName(): string {
  return "bb";
}

export function bbShellFileName(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? "bb.cmd" : "bb";
}

export function bbCliLaunchSpec(
  directory: string,
  platform: NodeJS.Platform = process.platform,
): BbCliLaunchSpec {
  const jsEntryPath = join(directory, bbJsEntryFileName());
  return {
    jsEntryPath,
    shellPath:
      platform === "win32" ? join(directory, bbShellFileName(platform)) : jsEntryPath,
  };
}

export function bbCliLaunchSpecFromPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): BbCliLaunchSpec {
  const name = basename(path);
  if (name.toLowerCase().endsWith(".cmd")) {
    return bbCliLaunchSpec(dirname(path), platform);
  }
  const directory = dirname(path);
  return {
    jsEntryPath: path,
    shellPath:
      platform === "win32" ? join(directory, bbShellFileName(platform)) : path,
  };
}

export function spawnArgv(
  spec: BbCliLaunchSpec,
  args: readonly string[] = [],
): BbCliSpawnArgv {
  return {
    command: process.execPath,
    args: [spec.jsEntryPath, ...args],
  };
}

export function isNodeExecutablePath(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === "node" || name === "node.exe";
}
