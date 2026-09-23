import { readFileSync } from "node:fs";
import { extname } from "node:path";

export interface AcpAgentLaunch {
  command: string;
  args: string[];
  shell: boolean;
}

// bb-fork(windows): Windows cannot execute a `.mjs`/`.js`/extensionless script
// through its shebang the way POSIX does, and Node's spawn refuses a `.cmd`
// launcher without a shell. Translate the configured agent command the same way
// the rest of the fork launches host-local CLIs.
export function resolveAcpAgentLaunch(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): AcpAgentLaunch {
  if (platform !== "win32") {
    return { command, args: [...args], shell: false };
  }
  const extension = extname(command).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    return { command, args: [...args], shell: true };
  }
  if (
    extension === ".mjs" ||
    extension === ".cjs" ||
    extension === ".js" ||
    (extension === "" && isNodeShebang(command))
  ) {
    return { command: execPath, args: [command, ...args], shell: false };
  }
  return { command, args: [...args], shell: false };
}

function isNodeShebang(command: string): boolean {
  try {
    const firstLine = readFileSync(command, "utf8").split("\n", 1)[0] ?? "";
    return /^#!.*\bnode\b/u.test(firstLine);
  } catch {
    return false;
  }
}
