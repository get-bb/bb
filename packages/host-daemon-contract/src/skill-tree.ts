import { createHash } from "node:crypto";
import type { HostDaemonSkillTreeFile } from "./session.js";

function compareStringsByCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function hashSkillTreeFiles(
  files: readonly HostDaemonSkillTreeFile[],
): string {
  const hash = createHash("sha256");
  hash.update("bb-skill-tree-v2");
  for (const file of [...files].sort((left, right) =>
    compareStringsByCodePoint(left.path, right.path),
  )) {
    hash.update("\0file\0");
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.mode.toString(8));
    hash.update("\0");
    hash.update(String(file.sizeBytes));
    hash.update("\0");
    hash.update(file.sha256);
  }
  return hash.digest("hex");
}
