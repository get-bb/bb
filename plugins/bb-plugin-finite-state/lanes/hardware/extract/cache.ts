import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
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
import { findArtifact, recordArtifact, type ArtifactScope, type HwArtifactStatus } from "./provenance.js";

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

export async function validateHardwareWorktreeRoot(worktreeRoot: string): Promise<string> {
  if (!isAbsolute(worktreeRoot)) throw new HardwareCacheError("INVALID_WORKTREE_ROOT", "An absolute worktree root is required.");
  const root = await realpath(worktreeRoot);
  if (!(await stat(root)).isDirectory()) throw new HardwareCacheError("INVALID_WORKTREE_ROOT", "The worktree root must be a directory.");
  const git = await execFileAsync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 5_000 });
  if (await realpath(git.stdout.trim()) !== root) throw new HardwareCacheError("INVALID_WORKTREE_ROOT", "The path must be the Git worktree root.");
  return root;
}

export async function assertHardwareCacheIgnored(worktreeRoot: string): Promise<string> {
  const root = await validateHardwareWorktreeRoot(worktreeRoot);
  try {
    await execFileAsync("git", ["-C", root, "check-ignore", "--quiet", "--no-index", "--", `${HW_CACHE_DIRECTORY}/.ignore-probe`], { timeout: 5_000 });
  } catch (error) {
    throw new HardwareCacheError("HW_CACHE_NOT_IGNORED", ".fs-hw must be gitignored before hardware artifacts are created.", { cause: error });
  }
  return root;
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
    const prior = findArtifact(deps.db, deps.scope, kind, null);
    if (artifactIsFresh(prior?.source_hash ?? null, source.hash, opts.force)) {
      if (prior) produced.push({
        projectKey, kind, sheetPath: prior.sheet_path, path: prior.path,
        sourceHash: prior.source_hash, cliVersion: prior.cli_version,
        generatedAt: prior.generated_at, fresh: true,
      });
      continue;
    }
    const relativeOutput = artifactRelativePath(projectKey, kind);
    const output = resolveInsideRoot(root, relativeOutput);
    const sourcePath = resolveInsideRoot(root, source.path);
    const command = buildExtractCommand(capability.cliPath, kind, sourcePath, output);
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
    produced.push(recordArtifact(deps.db, deps.scope, {
      kind, sheetPath: null, path: relativeOutput, sourceHash: source.hash,
      cliVersion: capability.version, generatedAt: new Date().toISOString(),
    }));
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
