// bb-fork(windows): Node cannot spawn a bb.cmd shim (EINVAL on Node 22), so resolve it to the sibling extensionless entry for both the identity guard and the re-exec spawn. That sibling is a Node bundle in an installed host and a POSIX-sh shim in a dev checkout, so an unspawnable entry is reported instead of spawned.
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { dirname, extname, join } from "node:path";

const WINDOWS_BATCH_EXTENSIONS = new Set([".bat", ".cmd"]);
const NODE_ENTRY_EXTENSIONS = new Set(["", ".js", ".mjs", ".cjs"]);
const POSIX_SHELLS = new Set(["sh", "bash", "dash", "zsh", "ksh"]);
const SHEBANG_PROBE_BYTES = 128;

export interface BbCliSpawn {
  command: string;
  args: string[];
}

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

function readShebang(entry: string): string | null {
  let handle: number | null = null;
  try {
    handle = openSync(entry, "r");
    const buffer = Buffer.alloc(SHEBANG_PROBE_BYTES);
    const bytesRead = readSync(handle, buffer, 0, SHEBANG_PROBE_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0] ?? "";
  } catch {
    return null;
  } finally {
    if (handle !== null) closeSync(handle);
  }
}

function isPosixShellShebang(shebang: string): boolean {
  const parts = shebang.replace(/^#!\s*/u, "").trim().split(/\s+/u);
  const interpreter = (parts[0] ?? "").split("/").pop()?.toLowerCase() ?? "";
  const names = interpreter === "env" ? parts.slice(1) : [interpreter];
  return names.some(
    (name) => !name.startsWith("-") && POSIX_SHELLS.has(name.toLowerCase()),
  );
}

/**
 * Whether Node can host this entry. `.js`/`.mjs`/`.cjs` always can. An
 * extensionless entry can when it is not a POSIX-shell script: an installed
 * host's bundle starts with a Node shebang, while a dev checkout's
 * `apps/cli/bin/bb` starts with `#!/bin/sh` and only runs under a shell.
 */
export function isNodeHostedBbCliEntry(entry: string): boolean {
  const extension = extname(entry).toLowerCase();
  if (extension !== "") {
    return NODE_ENTRY_EXTENSIONS.has(extension);
  }
  const shebang = readShebang(entry);
  return shebang === null || !isPosixShellShebang(shebang);
}

/**
 * `null` means the entry cannot be re-exec'd by Node: the caller keeps running,
 * because a POSIX-sh shim already launches this same CLI.
 */
export function resolveBbCliSpawn(
  entry: string,
  argv: string[],
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): BbCliSpawn | null {
  if (platform !== "win32") {
    return { command: entry, args: argv };
  }
  if (isNodeHostedBbCliEntry(entry)) {
    return { command: execPath, args: [entry, ...argv] };
  }
  if (extname(entry).toLowerCase() === "") {
    return null;
  }
  return { command: entry, args: argv };
}
