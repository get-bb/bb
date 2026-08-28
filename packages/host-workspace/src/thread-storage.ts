import fs from "node:fs/promises";
import path from "node:path";
import { resolveContainedPath } from "@bb/process-utils";
import { withCheckoutMutationLock } from "./checkout-mutation-lock.js";
import { runGit, WorkspaceError, type GitProcessOptions } from "./git.js";
import { withWorktreeMetadataLock } from "./worktree-metadata-lock.js";

export interface DeleteThreadStorageArgs {
  threadStorageRootPath: string;
  threadId: string;
  shellPath?: string;
}

interface LinkedWorktree {
  commonDir: string;
  path: string;
}

function resolveThreadStoragePath(args: DeleteThreadStorageArgs): string {
  if (
    args.threadId.length === 0 ||
    args.threadId === "." ||
    args.threadId === ".." ||
    args.threadId.includes("/") ||
    args.threadId.includes("\\")
  ) {
    throw new WorkspaceError(
      "invalid_thread_storage_path",
      "Thread storage threadId must be a single path segment",
    );
  }

  const threadStoragePath = resolveContainedPath({
    rootPath: args.threadStorageRootPath,
    candidatePath: path.join(args.threadStorageRootPath, args.threadId),
  });
  if (!threadStoragePath) {
    throw new WorkspaceError(
      "invalid_thread_storage_path",
      "Thread storage path must be under the thread storage root",
    );
  }
  return threadStoragePath;
}

async function lstatOrNull(
  targetPath: string,
): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function resolveLinkedWorktree(
  workspacePath: string,
  gitProcessOptions: GitProcessOptions,
): Promise<LinkedWorktree | null> {
  const [gitDirResult, commonDirResult] = await Promise.all([
    runGit(["rev-parse", "--absolute-git-dir"], {
      cwd: workspacePath,
      ...gitProcessOptions,
      allowFailure: true,
    }),
    runGit(["rev-parse", "--git-common-dir"], {
      cwd: workspacePath,
      ...gitProcessOptions,
      allowFailure: true,
    }),
  ]);
  if (gitDirResult.exitCode !== 0 || commonDirResult.exitCode !== 0) {
    return null;
  }

  const gitDir = gitDirResult.stdout.trim();
  const commonDir = commonDirResult.stdout.trim();
  if (!gitDir || !commonDir) {
    return null;
  }

  const resolvedGitDir = path.resolve(gitDir);
  const resolvedCommonDir = path.resolve(workspacePath, commonDir);
  if (resolvedGitDir === resolvedCommonDir) {
    return null;
  }

  return { commonDir: resolvedCommonDir, path: workspacePath };
}

async function findLinkedWorktrees(
  threadStoragePath: string,
  gitProcessOptions: GitProcessOptions,
): Promise<LinkedWorktree[]> {
  const linkedWorktrees: LinkedWorktree[] = [];
  const directories = [threadStoragePath];

  while (directories.length > 0) {
    const directory = directories.pop();
    if (!directory) {
      continue;
    }

    const entries = await fs.readdir(directory, { withFileTypes: true });
    const dotGit = entries.find((entry) => entry.name === ".git");
    if (dotGit?.isFile()) {
      const worktree = await resolveLinkedWorktree(
        directory,
        gitProcessOptions,
      );
      if (worktree) {
        linkedWorktrees.push(worktree);
      }
    }

    for (const entry of entries) {
      if (entry.name !== ".git" && entry.isDirectory()) {
        directories.push(path.join(directory, entry.name));
      }
    }
  }

  return linkedWorktrees.sort(
    (left, right) => right.path.length - left.path.length,
  );
}

async function unregisterLinkedWorktree(
  worktree: LinkedWorktree,
  gitProcessOptions: GitProcessOptions,
): Promise<void> {
  const result = await withCheckoutMutationLock(
    worktree.path,
    () =>
      withWorktreeMetadataLock(worktree.commonDir, () =>
        runGit(
          [
            "--git-dir",
            worktree.commonDir,
            "worktree",
            "remove",
            worktree.path,
            "--force",
          ],
          {
            cwd: path.dirname(worktree.path),
            ...gitProcessOptions,
            allowFailure: true,
          },
        ),
      ),
    undefined,
    gitProcessOptions,
  );
  if (result.exitCode !== 0) {
    throw new WorkspaceError(
      "worktree_cleanup_failed",
      `Failed to unregister linked worktree ${worktree.path}: ${result.stderr.trim()}`,
    );
  }
}

export async function deleteThreadStorage(
  args: DeleteThreadStorageArgs,
): Promise<void> {
  const threadStoragePath = resolveThreadStoragePath(args);
  const storageStat = await lstatOrNull(threadStoragePath);
  if (!storageStat) {
    return;
  }

  if (!storageStat.isDirectory()) {
    await fs.rm(threadStoragePath, { force: true });
    return;
  }

  const gitProcessOptions =
    args.shellPath === undefined ? {} : { shellPath: args.shellPath };
  const linkedWorktrees = await findLinkedWorktrees(
    threadStoragePath,
    gitProcessOptions,
  );
  for (const worktree of linkedWorktrees) {
    await unregisterLinkedWorktree(worktree, gitProcessOptions);
  }

  await fs.rm(threadStoragePath, { recursive: true, force: true });
}
