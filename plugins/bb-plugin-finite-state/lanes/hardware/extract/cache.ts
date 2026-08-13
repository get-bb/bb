import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, opendir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import type Database from "better-sqlite3";
import { discoverProjects, resolveInsideRoot } from "../discovery.js";
import {
  buildExtractCommand,
  detectKicadCli,
  executeExtractCommand,
  type HwArtifactKind,
  type KicadCapability,
} from "./driver.js";
import {
  artifactPathPresent,
  findArtifacts,
  recordArtifact,
  replaceArtifactsForKind,
  type ArtifactScope,
  type HwArtifactStatus,
} from "./provenance.js";

const execFileAsync = promisify(execFile);
export const HW_CACHE_DIRECTORY = ".fs-hw";
export const ALL_HW_ARTIFACT_KINDS: readonly HwArtifactKind[] = [
  "sheet_svg", "board_svg", "glb", "bom", "netlist", "gerber", "drill", "drc", "erc",
];

export class HardwareCacheError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HardwareCacheError";
  }
}

export interface ExtractResult {
  projectKey: string;
  produced: HwArtifactStatus[];
  failures: { kind: HwArtifactKind; exitCode: number; stderr: string }[];
}

export function projectCacheKey(projectKey: string): string {
  return createHash("sha256").update(projectKey).digest("hex");
}

export function artifactRelativePath(projectKey: string, kind: HwArtifactKind): string {
  const root = `${HW_CACHE_DIRECTORY}/${projectCacheKey(projectKey)}`;
  switch (kind) {
    case "sheet_svg": return `${root}/sheets`;
    case "board_svg": return `${root}/board.svg`;
    case "glb": return `${root}/board.glb`;
    case "bom": return `${root}/bom.csv`;
    case "netlist": return `${root}/netlist.net`;
    case "gerber": return `${root}/gerbers`;
    case "drill": return `${root}/drill`;
    case "drc": return `${root}/drc.json`;
    case "erc": return `${root}/erc.json`;
  }
}

export function artifactIsFresh(recordedHash: string | null, currentHash: string, force = false): boolean {
  return !force && recordedHash === currentHash;
}

interface ValidatedHardwareSource {
  sourceRoot: string;
  gitRoot: string;
}

export async function validateHardwareSourceRoot(worktreeRoot: string): Promise<ValidatedHardwareSource> {
  if (!isAbsolute(worktreeRoot)) throw new HardwareCacheError("INVALID_WORKTREE_ROOT", "An absolute project source root is required.");
  let sourceRoot: string;
  try {
    sourceRoot = await realpath(worktreeRoot);
    if (!(await stat(sourceRoot)).isDirectory()) throw new Error("not a directory");
  } catch (error) {
    throw new HardwareCacheError("INVALID_WORKTREE_ROOT", "The project source root is unavailable or is not a directory.", { cause: error });
  }
  let gitRoot: string;
  try {
    const git = await execFileAsync("git", ["-C", sourceRoot, "rev-parse", "--show-toplevel"], {
      encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024,
    });
    gitRoot = await realpath(git.stdout.trim());
  } catch (error) {
    throw new HardwareCacheError("HW_SOURCE_NOT_GIT_REPOSITORY", "The project source must be inside a Git worktree before hardware artifacts can be cached.", { cause: error });
  }
  const fromGitRoot = relative(gitRoot, sourceRoot);
  if (fromGitRoot === ".." || fromGitRoot.startsWith(`..${sep}`) || isAbsolute(fromGitRoot)) {
    throw new HardwareCacheError("INVALID_WORKTREE_ROOT", "The project source resolves outside its Git worktree.");
  }
  return { sourceRoot, gitRoot };
}

export async function validateHardwareWorktreeRoot(worktreeRoot: string): Promise<string> {
  return (await validateHardwareSourceRoot(worktreeRoot)).sourceRoot;
}

export async function assertHardwareCacheIgnored(worktreeRoot: string): Promise<string> {
  const { sourceRoot, gitRoot } = await validateHardwareSourceRoot(worktreeRoot);
  const probe = relative(gitRoot, resolveInsideRoot(sourceRoot, `${HW_CACHE_DIRECTORY}/.ignore-probe`));
  try {
    await execFileAsync("git", ["-C", gitRoot, "check-ignore", "--quiet", "--no-index", "--", probe], { timeout: 5_000 });
  } catch (error) {
    throw new HardwareCacheError("HW_CACHE_NOT_IGNORED", ".fs-hw must be gitignored before hardware artifacts are created.", { cause: error });
  }
  return sourceRoot;
}

function sourceForKind(project: Awaited<ReturnType<typeof discoverProjects>>[number], kind: HwArtifactKind) {
  const board = kind === "board_svg" || kind === "glb" || kind === "gerber" || kind === "drill" || kind === "drc";
  if (board && project.pcbPath === null) return null;
  return board
    ? { path: project.pcbPath!, hash: project.pcbSha256! }
    : { path: project.schPath, hash: project.schSha256 };
}

export interface ExtractDependencies {
  db: Database.Database;
  scope: ArtifactScope;
  capability?: KicadCapability;
  execute?: typeof executeExtractCommand;
}

function statusFromRow(
  projectKey: string,
  row: ReturnType<typeof findArtifacts>[number],
): HwArtifactStatus {
  return {
    projectKey,
    kind: row.kind,
    sheetPath: row.sheet_path,
    path: row.path,
    sourceHash: row.source_hash,
    cliVersion: row.cli_version,
    generatedAt: row.generated_at,
    fresh: true,
  };
}

async function allPriorArtifactsFresh(
  root: string,
  rows: ReturnType<typeof findArtifacts>,
  currentHash: string,
  force: boolean,
): Promise<boolean> {
  if (force || rows.length === 0 || rows.some((row) => row.source_hash !== currentHash)) return false;
  const present = await Promise.all(rows.map((row) => artifactPathPresent(root, row.path, row.kind)));
  return present.every(Boolean);
}

async function sheetSvgArtifacts(
  root: string,
  output: string,
  sourceHash: string,
  cliVersion: string,
  generatedAt: string,
): Promise<Array<Omit<HwArtifactStatus, "fresh" | "projectKey">>> {
  const artifacts: Array<Omit<HwArtifactStatus, "fresh" | "projectKey">> = [];
  async function walk(directory: string): Promise<void> {
    for await (const entry of await opendir(directory)) {
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".svg") && (await stat(absolute)).size > 0) {
        const sheetPath = relative(output, absolute).split(sep).join("/");
        const path = relative(root, absolute).split(sep).join("/");
        artifacts.push({ kind: "sheet_svg", sheetPath, path, sourceHash, cliVersion, generatedAt });
      }
    }
  }
  await walk(output);
  return artifacts.sort((left, right) => (left.sheetPath ?? "").localeCompare(right.sheetPath ?? ""));
}

export async function runExtractCached(
  worktreeRoot: string,
  projectKey: string,
  kinds: HwArtifactKind[],
  deps: ExtractDependencies,
  opts: { force?: boolean } = {},
): Promise<ExtractResult> {
  const root = await validateHardwareWorktreeRoot(worktreeRoot);
  const project = (await discoverProjects(root)).find((candidate) => candidate.projectKey === projectKey);
  if (!project) throw new HardwareCacheError("HW_PROJECT_NOT_FOUND", `No discovered KiCad project matches ${projectKey}.`);
  const capability = deps.capability ?? await detectKicadCli();
  if (!capability.installed || !capability.cliPath) {
    return { projectKey, produced: [], failures: kinds.map((kind) => ({ kind, exitCode: -1, stderr: "KICAD_NOT_INSTALLED: kicad-cli was not found" })) };
  }
  if (!capability.supported || capability.version === null) {
    return { projectKey, produced: [], failures: kinds.map((kind) => ({ kind, exitCode: -1, stderr: `KICAD_VERSION_UNSUPPORTED: ${capability.version ?? "unknown"}` })) };
  }
  const major = Number(capability.version.split(".")[0]);
  const produced: HwArtifactStatus[] = [];
  const failures: ExtractResult["failures"] = [];
  let ignoreVerified = false;
  for (const kind of [...new Set(kinds)]) {
    const source = sourceForKind(project, kind);
    if (!source) continue;
    const prior = findArtifacts(deps.db, deps.scope, kind);
    if (await allPriorArtifactsFresh(root, prior, source.hash, opts.force ?? false)) {
      produced.push(...prior.map((row) => statusFromRow(projectKey, row)));
      continue;
    }
    const relativeOutput = artifactRelativePath(projectKey, kind);
    const output = resolveInsideRoot(root, relativeOutput);
    const sourcePath = resolveInsideRoot(root, source.path);
    const command = buildExtractCommand(capability.cliPath, kind, sourcePath, output, root);
    if (major < command.minMajor) {
      failures.push({ kind, exitCode: -1, stderr: `KICAD_ARTIFACT_UNSUPPORTED: ${kind} requires KiCad ${command.minMajor}+` });
      continue;
    }
    if (!ignoreVerified) { await assertHardwareCacheIgnored(root); ignoreVerified = true; }
    await mkdir(kind === "sheet_svg" || kind === "gerber" || kind === "drill" ? output : dirname(output), { recursive: true });
    const result = await (deps.execute ?? executeExtractCommand)(command);
    if (result.exitCode !== 0) {
      failures.push({ kind, exitCode: result.exitCode, stderr: result.stderr });
      continue;
    }
    const generatedAt = new Date().toISOString();
    try {
      if (kind === "sheet_svg") {
        const sheets = await sheetSvgArtifacts(root, output, source.hash, capability.version, generatedAt);
        if (sheets.length === 0) {
          failures.push({ kind, exitCode: -1, stderr: "KICAD_OUTPUT_MISSING: sheet SVG export produced no non-empty SVG files" });
          continue;
        }
        produced.push(...replaceArtifactsForKind(deps.db, deps.scope, kind, sheets));
        continue;
      }
      if (!await artifactPathPresent(root, relativeOutput, kind)) {
        failures.push({ kind, exitCode: -1, stderr: `KICAD_OUTPUT_MISSING: ${kind} export did not create the expected artifact` });
        continue;
      }
      produced.push(recordArtifact(deps.db, deps.scope, {
        kind, sheetPath: null, path: relativeOutput, sourceHash: source.hash,
        cliVersion: capability.version, generatedAt,
      }));
    } catch (error) {
      failures.push({
        kind,
        exitCode: -1,
        stderr: `HW_PROVENANCE_WRITE_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return { projectKey, produced, failures };
}

export async function runExtract(
  worktreeRoot: string,
  projectKey: string,
  kinds: HwArtifactKind[],
  opts: { force?: boolean } = {},
): Promise<ExtractResult> {
  const capability = await detectKicadCli();
  if (!capability.installed) {
    return { projectKey, produced: [], failures: kinds.map((kind) => ({ kind, exitCode: -1, stderr: "KICAD_NOT_INSTALLED: kicad-cli was not found" })) };
  }
  throw new HardwareCacheError("HW_PROVENANCE_SCOPE_REQUIRED", "Use the registered extraction service so provenance is recorded in SQLite.");
}
