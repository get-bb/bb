// bb-fork(windows): a Windows host has no execute bit, Node's execFile refuses a .cmd
// launcher (EINVAL on Node 22) and cannot run an extensionless shim at all, so the bb CLI
// is probed through cmd.exe, through Node for an extensionless bundle, and a POSIX-shell
// shim is reported as unusable instead of "found".
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import { extname } from "node:path";

const POSIX_SHELLS = new Set(["sh", "bash", "dash", "zsh", "ksh"]);
const WINDOWS_BATCH_EXTENSIONS = new Set([".bat", ".cmd"]);
const SHEBANG_PROBE_BYTES = 128;

export interface BbProbeCommand {
  command: string;
  args: string[];
  shell: boolean;
}

function readShebang(entry: string): string | null {
  let handle: number | null = null;
  try {
    handle = openSync(entry, "r");
    const buffer = Buffer.alloc(SHEBANG_PROBE_BYTES);
    const bytesRead = readSync(handle, buffer, 0, SHEBANG_PROBE_BYTES, 0);
    return (
      buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0] ?? ""
    );
  } catch {
    return null;
  } finally {
    if (handle !== null) closeSync(handle);
  }
}

export function isPosixShellEntry(entry: string): boolean {
  const shebang = readShebang(entry);
  if (shebang === null || !shebang.startsWith("#!")) return false;
  const parts = shebang
    .replace(/^#!\s*/u, "")
    .trim()
    .split(/\s+/u);
  const interpreter = (parts[0] ?? "").split("/").pop()?.toLowerCase() ?? "";
  const names = interpreter === "env" ? parts.slice(1) : [interpreter];
  return names.some(
    (name) => !name.startsWith("-") && POSIX_SHELLS.has(name.toLowerCase()),
  );
}

/**
 * Adds the launchers a Windows host actually runs next to every candidate: a packaged
 * host ships `bb.cmd` beside its `bb` bundle, and a dev checkout ships one beside its
 * POSIX shim. Off Windows the candidates are returned unchanged.
 */
export function bbProbeCandidates(
  candidates: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== "win32") return [...candidates];
  const expanded: string[] = [];
  for (const candidate of candidates) {
    expanded.push(`${candidate}.cmd`, candidate);
  }
  return expanded;
}

/** `null` means the candidate is not runnable on this platform. */
export function bbProbeCommand(
  candidate: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): BbProbeCommand | null {
  if (platform !== "win32") {
    return { command: candidate, args: [...args], shell: false };
  }
  const extension = extname(candidate).toLowerCase();
  if (WINDOWS_BATCH_EXTENSIONS.has(extension)) {
    return { command: candidate, args: [...args], shell: true };
  }
  if (extension === "") {
    if (isPosixShellEntry(candidate)) return null;
    return { command: execPath, args: [candidate, ...args], shell: false };
  }
  return { command: candidate, args: [...args], shell: false };
}

/**
 * bb-fork(windows): a Windows host has no POSIX process groups, so killing the shell
 * leaves script descendants alive and holding the child's stdout pipe open, which keeps
 * `close` from firing. Kill the whole tree with `taskkill /T /F` instead. Returns false
 * off Windows so the caller keeps the existing POSIX process-group path.
 */
export function killWindowsProcessTree(
  child: ChildProcess,
  fallback: () => void,
): boolean {
  if (process.platform !== "win32") return false;
  if (child.pid === undefined) {
    fallback();
    return true;
  }
  try {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    killer.once("error", () => fallback());
  } catch {
    fallback();
  }
  return true;
}

/**
 * bb-fork(windows): `taskkill /T` cannot reap a Git Bash descendant, which keeps the
 * child's stdout/stderr pipes open and stops `close` from firing, so a timed-out run never
 * resolves. Release the pipes once buffered output has had a moment to arrive.
 */
export function releaseWindowsStdioAfterKill(
  child: ChildProcess,
  delayMs = 250,
): void {
  if (process.platform !== "win32") return;
  const timer = setTimeout(() => {
    if (child.stdout && !child.stdout.destroyed) child.stdout.destroy();
    if (child.stderr && !child.stderr.destroyed) child.stderr.destroy();
  }, delayMs);
  timer.unref();
}
