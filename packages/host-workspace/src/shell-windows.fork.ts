import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// bb-fork(windows): Windows has no `/bin/sh`, but Git for Windows ships a POSIX
// shell next to its exec path. The git patch-id pipelines are POSIX shell, so use
// that shell instead of failing to spawn `/bin/sh`.
const POSIX_SHELL = "/bin/sh";

let cachedShell: string | undefined;

export function resolvePosixShell(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return POSIX_SHELL;
  if (cachedShell !== undefined) return cachedShell;
  cachedShell = findGitForWindowsShell() ?? "sh";
  return cachedShell;
}

function findGitForWindowsShell(): string | null {
  try {
    const execPath = execFileSync("git", ["--exec-path"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    const candidate = resolve(
      execPath,
      "..",
      "..",
      "..",
      "usr",
      "bin",
      "sh.exe",
    );
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
