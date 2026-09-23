import { readFileSync } from "node:fs";
import { extname } from "node:path";

// bb-fork(windows): Windows cannot execute a Node `.mjs`/`.js`/extensionless
// entry through its shebang the way POSIX does, so run it through Node.
export function resolveClaudeSpawn(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): { command: string; args: string[] } {
  if (platform !== "win32") {
    return { command, args: [...args] };
  }
  const extension = extname(command).toLowerCase();
  const nodeEntry =
    extension === ".mjs" ||
    extension === ".cjs" ||
    extension === ".js" ||
    (extension === "" && isNodeShebang(command));
  return nodeEntry
    ? { command: execPath, args: [command, ...args] }
    : { command, args: [...args] };
}

function isNodeShebang(command: string): boolean {
  try {
    const firstLine = readFileSync(command, "utf8").split("\n", 1)[0] ?? "";
    return /^#!.*\bnode\b/u.test(firstLine);
  } catch {
    return false;
  }
}
