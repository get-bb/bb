/**
 * The host-file primitives every agent resolver shares: vendor path
 * conventions (`~`, `$VAR`, paths stored relative to the home directory),
 * tolerant config-file reads, and the repository ancestor walk.
 *
 * A vendor file that is missing, unparseable, or not the shape bb expects
 * yields nothing: the agent's own skills are a convenience in bb's composer,
 * and a bad config line must never fail the listing.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type {
  AcpNativeRootsEnvironment,
  AcpResolvedSkillRoot,
} from "./resolver.js";

export type ResolvedRootOrigin = "project" | "user";

/** A path a vendor stores: `~`, `~/...`, absolute, or relative to the home. */
export function resolveStoredPath(homeDir: string, storedPath: string): string {
  if (storedPath === "~") {
    return homeDir;
  }
  if (storedPath.startsWith("~/")) {
    return path.join(homeDir, storedPath.slice(2));
  }
  return path.resolve(homeDir, storedPath);
}

/** `$VAR` / `${VAR}` from the host environment, then `~`. */
export function expandConfiguredPath(
  homeDir: string,
  env: AcpNativeRootsEnvironment,
  value: string,
): string {
  const expandedEnvironment = value.replace(
    /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (match, bracedName: string | undefined, plainName: string | undefined) =>
      env[bracedName ?? plainName ?? ""] ?? match,
  );
  if (expandedEnvironment === "~") {
    return homeDir;
  }
  if (expandedEnvironment.startsWith("~/")) {
    return path.join(homeDir, expandedEnvironment.slice(2));
  }
  return expandedEnvironment;
}

/**
 * A path from a vendor config file, made absolute against `basePath`. The
 * result is normalized: the contract refuses dot segments.
 */
export function resolveConfiguredPath(args: {
  basePath: string;
  env: AcpNativeRootsEnvironment;
  homeDir: string;
  value: string;
}): string {
  const expanded = expandConfiguredPath(
    args.homeDir,
    args.env,
    args.value.trim(),
  );
  return path.resolve(args.basePath, expanded);
}

export async function readJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  return readParsedFile(filePath, JSON.parse, schema);
}

export async function readParsedFile<T>(
  filePath: string,
  parse: (content: string) => unknown,
  schema: z.ZodType<T>,
): Promise<T | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }

  let value: unknown;
  try {
    value = parse(content);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isPathWithinDirectory(
  directoryPath: string,
  candidatePath: string,
): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function hasProjectRootMarker(directoryPath: string): Promise<boolean> {
  try {
    await fs.lstat(path.join(directoryPath, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * The repository ancestor chain: the nearest ancestor with a `.git` entry is
 * the repository root. Without a marker, only the cwd. Runs from the
 * repository root to cwd.
 */
export async function resolveProjectAncestorDirectories(cwd: string): Promise<{
  directories: string[];
  projectRootPath: string;
}> {
  const directories: string[] = [];
  let directoryPath = cwd;
  while (true) {
    directories.push(directoryPath);
    if (await hasProjectRootMarker(directoryPath)) {
      break;
    }
    const parentPath = path.dirname(directoryPath);
    if (parentPath === directoryPath) {
      directories.splice(1);
      break;
    }
    directoryPath = parentPath;
  }

  const projectRootPath = directories.at(-1) ?? cwd;
  return { directories: directories.reverse(), projectRootPath };
}

export async function childDirectoryPaths(
  directoryPath: string,
): Promise<string[]> {
  try {
    return (await fs.readdir(directoryPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directoryPath, entry.name));
  } catch {
    return [];
  }
}

/** A directory of skill directories. */
export function skillsRoot(args: {
  ancestors?: boolean;
  origin: ResolvedRootOrigin;
  path: string;
  recursive: boolean;
  skipIfManifest?: string;
}): AcpResolvedSkillRoot {
  return {
    path: args.path,
    origin: args.origin,
    recursive: args.recursive,
    ...(args.ancestors === true ? { ancestors: true } : {}),
    ...(args.skipIfManifest === undefined
      ? {}
      : { skipIfManifest: args.skipIfManifest }),
    shape: "skills",
  };
}

/**
 * A path a vendor config names as a skill location: a `SKILL.md` file is one
 * skill (its directory name is the fallback name); anything else is a
 * directory of skills.
 */
export function configuredSkillRoot(args: {
  origin: ResolvedRootOrigin;
  recursive: boolean;
  skillPath: string;
}): AcpResolvedSkillRoot {
  if (path.basename(args.skillPath) === "SKILL.md") {
    return {
      path: args.skillPath,
      origin: args.origin,
      recursive: false,
      shape: "skill-file",
    };
  }
  return skillsRoot({
    origin: args.origin,
    path: args.skillPath,
    recursive: args.recursive,
  });
}
