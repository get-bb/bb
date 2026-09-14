// bb-fork(windows): Node cannot spawn a bb.cmd shim (EINVAL on Node 22), so resolve it to the sibling extensionless entry for both the identity guard and the re-exec spawn.
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";

const WINDOWS_BATCH_EXTENSIONS = new Set([".bat", ".cmd"]);
const NODE_ENTRY_EXTENSIONS = new Set(["", ".js", ".mjs", ".cjs"]);

export function resolveBbCliEntryTarget(
  target: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") {
    return target;
  }
  if (!WINDOWS_BATCH_EXTENSIONS.has(extname(target).toLowerCase())) {
    return target;
  }
  const sibling = join(dirname(target), "bb");
  return existsSync(sibling) ? sibling : target;
}

export function resolveBbCliSpawn(
  entry: string,
  argv: string[],
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): { command: string; args: string[] } {
  if (platform !== "win32") {
    return { command: entry, args: argv };
  }
  if (NODE_ENTRY_EXTENSIONS.has(extname(entry).toLowerCase())) {
    return { command: execPath, args: [entry, ...argv] };
  }
  return { command: entry, args: argv };
}
