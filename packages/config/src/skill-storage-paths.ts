import { join } from "node:path";

export function resolveDataDirSkillsRootPath(dataDir: string): string {
  return join(dataDir, "skills");
}
