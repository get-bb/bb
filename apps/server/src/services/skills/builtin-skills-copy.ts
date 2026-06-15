import { cp } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locates and copies the built-in skills that ship beside this module.
 *
 * This module is shared between the server runtime (built-in injected skill
 * discovery in ./injected-skills.ts) and the build step that copies the
 * skills into dist (scripts/copy-builtin-skills.ts, loaded with tsx before
 * workspace packages are built). Keep it free of workspace and third-party
 * imports.
 */

interface CopyBuiltinSkillsArgs {
  skillsRootPath: string;
  targetPath: string;
}

interface ResolveBuiltinSkillsRootPathArgs {
  moduleDir: string;
}

export const BUILTIN_SKILLS_DIRECTORY_NAME = "builtin-skills";
// Structural essential the server itself depends on. Skill content may change
// without breaking root detection.
const BUILTIN_SKILLS_SENTINEL_PATH = path.join(
  "bb-cli",
  "SKILL.md",
);
const BUILTIN_SKILLS_COPY_MODE = fsConstants.COPYFILE_FICLONE;
const builtinSkillsModuleDir = path.dirname(fileURLToPath(import.meta.url));

function hasBuiltinSkillsRoot(skillsRootPath: string): boolean {
  return existsSync(path.join(skillsRootPath, BUILTIN_SKILLS_SENTINEL_PATH));
}

/**
 * The built-in skills directory sits beside this module in both layouts:
 * src/services/skills/ in the source tree, and dist/ in the bundled server
 * (the build copies the skills to dist/builtin-skills and esbuild bundles
 * this module into the dist entry points).
 */
export function resolveBuiltinSkillsRootPathForModuleDir(
  args: ResolveBuiltinSkillsRootPathArgs,
): string {
  const skillsRootPath = path.resolve(
    args.moduleDir,
    BUILTIN_SKILLS_DIRECTORY_NAME,
  );
  if (!hasBuiltinSkillsRoot(skillsRootPath)) {
    throw new Error(`Missing built-in skills at ${skillsRootPath}`);
  }
  return skillsRootPath;
}

export function resolveBuiltinSkillsRootPath(): string {
  return resolveBuiltinSkillsRootPathForModuleDir({
    moduleDir: builtinSkillsModuleDir,
  });
}

export async function copyBuiltinSkills(
  args: CopyBuiltinSkillsArgs,
): Promise<void> {
  await cp(args.skillsRootPath, args.targetPath, {
    force: false,
    mode: BUILTIN_SKILLS_COPY_MODE,
    recursive: true,
  });
}
