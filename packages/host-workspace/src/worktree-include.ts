import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { WORKTREE_INCLUDE_FILE_NAME } from "@bb/domain";
import { runGit, WorkspaceError } from "./git.js";

interface CopyWorktreeIncludeFilesArgs {
  /** Existing checkout that owns the `.worktreeinclude` file. */
  sourcePath: string;
  /** Freshly created worktree that receives the copies. */
  targetPath: string;
  shellPath?: string;
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

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Read `.worktreeinclude`, or return null when the repo has no such file. Any
 * other read failure — a permission error, a directory in its place — is a
 * real problem the caller must report.
 */
async function readIncludeFile(sourcePath: string): Promise<string | null> {
  try {
    return await fs.readFile(
      path.join(sourcePath, WORKTREE_INCLUDE_FILE_NAME),
      "utf8",
    );
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
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
  shellPath: string | undefined,
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
    {
      cwd: sourcePath,
      ...(shellPath !== undefined ? { shellPath } : {}),
      signal,
    },
  );
  return result.stdout.split("\0").filter(Boolean);
}

/**
 * True when anything already occupies `targetPath`, including a broken
 * symlink. `lstat` never follows the last component, so a symlink planted by
 * the base branch reports itself rather than what it points at.
 */
async function pathPresent(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new WorkspaceError(
      "provision_cancelled",
      "Workspace provisioning was cancelled",
      { cause: signal.reason },
    );
  }
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
 * A per-file failure is collected in `skipped` and the remaining files still
 * copy. An unreadable include file or a failed `git ls-files` throws, because
 * silently reporting zero matches would hide the real cause. Cancellation
 * throws `provision_cancelled` between files.
 */
export async function copyWorktreeIncludeFiles(
  args: CopyWorktreeIncludeFilesArgs,
): Promise<CopyWorktreeIncludeFilesResult> {
  const contents = await readIncludeFile(args.sourcePath);
  if (contents === null || !hasPattern(contents)) {
    return EMPTY_RESULT;
  }

  const relativePaths = await listMatchingFiles(
    args.sourcePath,
    args.shellPath,
    args.signal,
  );
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
    throwIfAborted(args.signal);
    const sourceFile = path.join(args.sourcePath, relativePath);
    const targetFile = path.join(targetRealPath, relativePath);
    try {
      const stats = await fs.lstat(sourceFile);
      if (stats.isSymbolicLink()) {
        skipped.push(`${relativePath}: symlink`);
        continue;
      }
      if (await pathPresent(targetFile)) {
        skipped.push(`${relativePath}: already exists in the worktree`);
        continue;
      }
      await fs.mkdir(path.dirname(targetFile), { recursive: true });
      const parentRealPath = await fs.realpath(path.dirname(targetFile));
      if (!isInside(targetRealPath, parentRealPath)) {
        skipped.push(`${relativePath}: destination escapes the worktree`);
        continue;
      }
      // COPYFILE_EXCL fails rather than following a symlink or replacing a
      // file that appeared between the check above and this write.
      await fs.copyFile(sourceFile, targetFile, fsConstants.COPYFILE_EXCL);
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
