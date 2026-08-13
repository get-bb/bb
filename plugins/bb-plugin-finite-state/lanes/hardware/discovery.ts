import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { opendir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { BbPluginApi } from "@bb/plugin-sdk";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5_000;
export const WORKTREE_INCLUDE_HINT = "Untracked or ignored KiCad sources need .worktreeinclude to appear in agent worktrees.";

export interface KicadProjectRow {
  projectKey: string;
  name: string;
  schPath: string;
  pcbPath: string | null;
  schSha256: string;
  pcbSha256: string | null;
  kicadVersion: string | null;
  supported: boolean;
  discoveredAt: string;
}

export interface HardwareProjectSource {
  hostId: string;
  path: string;
}

export interface ProjectDiscoveryResult {
  projects: KicadProjectRow[];
  truncated: boolean;
}

const SKIP_DIRECTORIES = new Set([".git", ".fs-hw", "node_modules"]);

function posixPath(path: string): string {
  return path.split(sep).join("/");
}

export function assertRelativeProjectPath(path: string): string {
  const normalized = posixPath(path).replace(/^\.\//u, "");
  if (
    normalized.length === 0 || isAbsolute(path) || normalized === ".." ||
    normalized.startsWith("../") || normalized.includes("/../") || normalized.includes("\0")
  ) {
    throw new Error("HW_PROJECT_PATH_INVALID: projectKey must remain inside the project source root");
  }
  return normalized;
}

export function resolveInsideRoot(root: string, relativePath: string): string {
  const safe = assertRelativeProjectPath(relativePath);
  const target = resolve(root, safe);
  const fromRoot = relative(resolve(root), target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("HW_PROJECT_PATH_INVALID: path escapes the project source root");
  }
  return target;
}

export function readKicadVersion(text: string): { version: string | null; supported: boolean } {
  const generator = /\(generator_version\s+"?([0-9]+(?:\.[0-9]+){0,3})"?\)/u.exec(text)?.[1];
  if (generator) return { version: generator, supported: Number(generator.split(".")[0]) >= 6 };
  const format = /\(version\s+([0-9]{8})\)/u.exec(text)?.[1];
  if (!format) return { version: null, supported: false };
  const year = Number(format.slice(0, 4));
  return { version: format, supported: year >= 2021 };
}

async function hashLocalFile(root: string, path: string): Promise<{ hash: string; text: string }> {
  const target = resolveInsideRoot(root, path);
  const canonicalRoot = await realpath(root);
  const canonical = await realpath(target);
  const fromRoot = relative(canonicalRoot, canonical);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`HW_SOURCE_OUTSIDE_WORKTREE: ${path}`);
  }
  if (!(await stat(canonical)).isFile()) throw new Error(`HW_SOURCE_NOT_FILE: ${path}`);
  const bytes = await readFile(canonical);
  return { hash: createHash("sha256").update(bytes).digest("hex"), text: bytes.toString("utf8") };
}

async function localProjectFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(directory: string): Promise<void> {
    for await (const entry of await opendir(directory)) {
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) await walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".kicad_pro")) {
        results.push(posixPath(relative(root, absolute)));
      }
    }
  }
  await walk(root);
  return results.sort();
}

async function projectRow(
  projectKey: string,
  read: (path: string) => Promise<{ hash: string; text: string } | null>,
): Promise<KicadProjectRow | null> {
  const safeKey = assertRelativeProjectPath(projectKey);
  const stem = safeKey.slice(0, -".kicad_pro".length);
  const schPath = `${stem}.kicad_sch`;
  const pcbPath = `${stem}.kicad_pcb`;
  const schematic = await read(schPath);
  if (!schematic) return null;
  const board = await read(pcbPath);
  const compat = readKicadVersion(schematic.text);
  return {
    projectKey: safeKey,
    name: basename(stem),
    schPath,
    pcbPath: board ? pcbPath : null,
    schSha256: schematic.hash,
    pcbSha256: board?.hash ?? null,
    kicadVersion: compat.version,
    supported: compat.supported,
    discoveredAt: new Date().toISOString(),
  };
}

export async function discoverProjects(worktreeRoot: string): Promise<KicadProjectRow[]> {
  const root = await realpath(worktreeRoot);
  const rows = await Promise.all((await localProjectFiles(root)).map((key) =>
    projectRow(key, async (path) => {
      try { return await hashLocalFile(root, path); } catch (error) {
        if (error instanceof Error && /ENOENT/u.test(error.message)) return null;
        throw error;
      }
    })));
  return rows.filter((row): row is KicadProjectRow => row !== null);
}

function decode(content: string, encoding: "utf8" | "base64"): string {
  return encoding === "utf8" ? content : Buffer.from(content, "base64").toString("utf8");
}

export async function resolveHardwareProjectSource(
  bb: BbPluginApi,
  projectId: string,
): Promise<HardwareProjectSource> {
  const project = await bb.sdk.projects.get({ projectId });
  const source = project.sources.find((candidate) => candidate.isDefault) ?? project.sources[0];
  if (!source) {
    bb.log.warn(
      "Hardware discovery advisory: this project has no workspace source. Hardware discovery is unavailable for this project; other plugin lanes remain available.",
    );
    throw new Error("HW_PROJECT_SOURCE_UNAVAILABLE: the project has no workspace source");
  }
  return { hostId: source.hostId, path: source.path };
}

export async function scanProjectsFromSource(
  bb: BbPluginApi,
  source: HardwareProjectSource,
): Promise<ProjectDiscoveryResult> {
  const listing = await bb.sdk.files.listPaths({
    hostId: source.hostId,
    path: source.path,
    query: ".kicad_pro",
    limit: 10_000,
    includeFiles: true,
    includeDirectories: false,
  });
  const keys = listing.paths
    .filter((entry) => entry.kind === "file" && entry.path.endsWith(".kicad_pro"))
    .map((entry) => assertRelativeProjectPath(entry.path))
    .sort();
  const read = async (path: string) => {
    try {
      const file = await bb.sdk.files.read({
        hostId: source.hostId,
        path: resolveInsideRoot(source.path, path),
        rootPath: source.path,
      });
      return { hash: file.sha256, text: decode(file.content, file.contentEncoding) };
    } catch (error) {
      if (/ENOENT|not found|does not exist/iu.test(error instanceof Error ? error.message : String(error))) return null;
      throw error;
    }
  };
  const rows = await Promise.all(keys.map((key) => projectRow(key, read)));
  return {
    projects: rows.filter((row): row is KicadProjectRow => row !== null),
    truncated: listing.truncated,
  };
}

export async function discoverProjectsFromSource(
  bb: BbPluginApi,
  source: HardwareProjectSource,
): Promise<KicadProjectRow[]> {
  return (await scanProjectsFromSource(bb, source)).projects;
}

export async function worktreeIncludeHint(
  sourceRoot: string,
  projects: KicadProjectRow[],
): Promise<string | null> {
  if (!isAbsolute(sourceRoot) || projects.length === 0) return null;
  const paths = projects.flatMap((project) => [
    project.projectKey,
    project.schPath,
    ...(project.pcbPath ? [project.pcbPath] : []),
  ]);
  try {
    const status = await execFileAsync(
      "git",
      ["-C", sourceRoot, "status", "--porcelain=v1", "--untracked-files=all", "--", ...paths],
      { encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    if (status.stdout.split("\n").some((line) => line.startsWith("??"))) return WORKTREE_INCLUDE_HINT;
    for (const path of paths) {
      try {
        await execFileAsync("git", ["-C", sourceRoot, "check-ignore", "--quiet", "--", path], { timeout: GIT_TIMEOUT_MS });
        return WORKTREE_INCLUDE_HINT;
      } catch { /* a non-zero status means this path is not ignored */ }
    }
  } catch { /* tracking metadata is unavailable for a remote or non-Git source */ }
  return null;
}
