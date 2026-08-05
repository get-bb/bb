import fs from "node:fs/promises";
import path from "node:path";
import { WORKTREE_INCLUDE_FILE_NAME } from "@bb/domain";
import { runGit } from "./git.js";

export interface CopyWorktreeIncludeFilesArgs {
  /** Existing checkout that owns the `.worktreeinclude` file. */
  sourcePath: string;
  /** Freshly created worktree that receives the copies. */
  targetPath: string;
  signal?: AbortSignal;
}

export interface CopyWorktreeIncludeFilesResult {
  /** False when the source checkout has no usable `.worktreeinclude`. */
  ran: boolean;
  /** Repo-relative paths copied into the worktree. */
  copied: string[];
  /** Human-readable reasons for entries that were not copied. */
  skipped: string[];
}

const EMPTY_RESULT: CopyWorktreeIncludeFilesResult = {
  ran: false,
  copied: [],
  skipped: [],
};

/**
 * True when `.worktreeinclude` holds at least one pattern. Git rejects
 * `ls-files --ignored` when every exclude source is empty, so a file of only
 * comments must short-circuit before we shell out.
 */
function hasPattern(contents: string): boolean {
  return contents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((line) => line.length > 0 && !line.startsWith("#"));
}

async function readIncludeFile(sourcePath: string): Promise<string | null> {
  try {
    return await fs.readFile(
      path.join(sourcePath, WORKTREE_INCLUDE_FILE_NAME),
      "utf8",
    );
  } catch {
    return null;
  }
}

/**
 * List untracked files in `sourcePath` that match the `.worktreeinclude`
 * patterns. `--others` limits the walk to untracked paths, and `--ignored`
 * with `--exclude-from` (and no `--exclude-standard`) makes the include file
 * the only exclude source, so git's own gitignore matcher decides every
 * pattern — including directory patterns, `**`, and negation.
 */
async function listMatchingFiles(
  sourcePath: string,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const result = await runGit(
    [
      "ls-files",
      "--others",
      "--ignored",
      `--exclude-from=${WORKTREE_INCLUDE_FILE_NAME}`,
      "-z",
    ],
    { cwd: sourcePath, allowFailure: true, signal },
  );
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout.split("\0").filter(Boolean);
}

function isInside(parentRealPath: string, childRealPath: string): boolean {
  const relative = path.relative(parentRealPath, childRealPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * Copy the untracked files a repo lists in `.worktreeinclude` from the source
 * checkout into a new worktree. A fresh worktree contains tracked files only,
 * so local `.env` files and credentials never arrive on their own.
 *
 * Nothing here is fatal: a missing file, an unreadable entry, or a failed copy
 * is reported and provisioning continues.
 */
export async function copyWorktreeIncludeFiles(
  args: CopyWorktreeIncludeFilesArgs,
): Promise<CopyWorktreeIncludeFilesResult> {
  const contents = await readIncludeFile(args.sourcePath);
  if (contents === null || !hasPattern(contents)) {
    return EMPTY_RESULT;
  }

  const relativePaths = await listMatchingFiles(args.sourcePath, args.signal);
  if (relativePaths.length === 0) {
    return { ran: true, copied: [], skipped: [] };
  }

  let targetRealPath: string;
  try {
    targetRealPath = await fs.realpath(args.targetPath);
  } catch (error) {
    return {
      ran: true,
      copied: [],
      skipped: [`${args.targetPath}: ${describeError(error)}`],
    };
  }

  const copied: string[] = [];
  const skipped: string[] = [];
  for (const relativePath of relativePaths) {
    const sourceFile = path.join(args.sourcePath, relativePath);
    const targetFile = path.join(targetRealPath, relativePath);
    try {
      const stats = await fs.lstat(sourceFile);
      if (stats.isSymbolicLink()) {
        skipped.push(`${relativePath}: symlink`);
        continue;
      }
      await fs.mkdir(path.dirname(targetFile), { recursive: true });
      const parentRealPath = await fs.realpath(path.dirname(targetFile));
      if (!isInside(targetRealPath, parentRealPath)) {
        skipped.push(`${relativePath}: destination escapes the worktree`);
        continue;
      }
      await fs.copyFile(sourceFile, targetFile);
      copied.push(relativePath);
    } catch (error) {
      skipped.push(`${relativePath}: ${describeError(error)}`);
    }
  }

  return { ran: true, copied, skipped };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
