import fs from "node:fs";
import path from "node:path";

/**
 * Turbo runs the suite with `apps/server` as the working directory while the
 * documented invocations name files relative to the repository root. A
 * relative path is tried against the working directory and then each
 * ancestor, so both spellings work; a file that exists nowhere is an error
 * rather than a silently empty gate.
 */
export function resolveRepoRelativeFile(envName: string, value: string): string {
  if (path.isAbsolute(value)) {
    if (!fs.existsSync(value)) {
      throw new Error(`${envName} names a missing file: ${value}`);
    }
    return value;
  }
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, value);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `${envName} names a missing file: ${value} (tried ${process.cwd()} and its ancestors)`,
  );
}
