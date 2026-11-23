import fs from "node:fs/promises";
import path from "node:path";
import {
  readGitRepositoryState,
  runGit,
  WorkspaceError,
} from "bb-environment-provider-host/git";
import {
  isProvisionAbortError,
  type ProgressCallback,
} from "bb-environment-provider-host/transcript";
import type { CreatedFolderWorktree } from "../contract.js";
import { resolveWorktreeBaseBranch } from "./base-branch.js";
import {
  abandonCreateTarget,
  createWorktree,
  type BranchMode,
  type CreateWorktreeArgs,
} from "./worktree.js";

async function realpathOrResolved(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return path.resolve(target);
  }
}

export async function readFolderRepository(
  folderPath: string,
  signal: AbortSignal | undefined,
): Promise<{ commonDir: string } | null> {
  const options = signal === undefined ? {} : { signal };
  const result = await runGit(
    ["rev-parse", "--show-toplevel", "--git-common-dir"],
    { cwd: folderPath, ...options, allowFailure: true },
  ).catch((error: unknown) => {
    if (signal?.aborted) throw error;
    return null;
  });
  if (result === null || result.exitCode !== 0) return null;
  const [topLevel, commonDir] = result.stdout.trim().split("\n");
  if (topLevel === undefined || commonDir === undefined) return null;
  if (
    (await realpathOrResolved(topLevel)) !==
    (await realpathOrResolved(folderPath))
  ) {
    return null;
  }
  if ((await readGitRepositoryState(folderPath)) !== "has_commits") {
    return null;
  }
  return {
    commonDir: await realpathOrResolved(path.resolve(folderPath, commonDir)),
  };
}

export async function listFolderRepositories(args: {
  paths: readonly string[];
  signal: AbortSignal | undefined;
}): Promise<string[]> {
  const repositories = await Promise.all(
    args.paths.map((folderPath) =>
      readFolderRepository(folderPath, args.signal),
    ),
  );
  return args.paths.filter((_, index) => repositories[index] !== null);
}

export interface FolderWorktreeTarget {
  sourcePath: string;
  targetPath: string;
  completionPath: string;
}

function prefixProgress(
  onProgress: ProgressCallback | undefined,
  label: string,
): ProgressCallback | undefined {
  if (onProgress === undefined) return undefined;
  return (entry) => onProgress({ ...entry, text: `${label}: ${entry.text}` });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function createFolderWorktrees(args: {
  mainSourcePath: string;
  ownWorktreesRoot: string;
  folders: readonly FolderWorktreeTarget[];
  branchName: string | null;
  branchMode: BranchMode;
  onProgress: ProgressCallback | undefined;
  signal: AbortSignal | undefined;
}): Promise<CreatedFolderWorktree[]> {
  const main = await readFolderRepository(args.mainSourcePath, args.signal);
  const seen = new Map<string, string>(
    main === null ? [] : [[main.commonDir, args.mainSourcePath]],
  );
  for (const folder of args.folders) {
    const repository = await readFolderRepository(
      folder.sourcePath,
      args.signal,
    );
    if (repository === null) {
      throw new WorkspaceError(
        "folder_not_repository",
        `Cannot branch ${folder.sourcePath}: it is not the top folder of a Git repository with at least one commit.`,
      );
    }
    const sameRepository = seen.get(repository.commonDir);
    if (sameRepository !== undefined) {
      throw new WorkspaceError(
        "folder_same_repository",
        `Cannot branch ${folder.sourcePath}: it is a checkout of the same Git repository as ${sameRepository}.`,
      );
    }
    seen.set(repository.commonDir, folder.sourcePath);
  }

  const attempts = await Promise.allSettled(
    args.folders.map(async (folder) => {
      try {
        const createArgs: CreateWorktreeArgs = {
          sourcePath: folder.sourcePath,
          targetPath: folder.targetPath,
          completionPath: folder.completionPath,
          ownWorktreesRoot: args.ownWorktreesRoot,
          branchName: args.branchName,
          baseBranch: await resolveWorktreeBaseBranch(folder.sourcePath, {
            kind: "default",
          }),
          branchMode: args.branchMode,
          onProgress: prefixProgress(
            args.onProgress,
            path.basename(folder.sourcePath),
          ),
          signal: args.signal,
        };
        const created = await createWorktree(createArgs);
        return { createArgs, created };
      } catch (error) {
        if (args.signal?.aborted || isProvisionAbortError(error)) throw error;
        throw new WorkspaceError(
          "folder_worktree_failed",
          `Could not make a worktree of ${folder.sourcePath}: ${errorMessage(error)}`,
          { cause: error },
        );
      }
    }),
  );
  const failure = attempts.find(
    (attempt): attempt is PromiseRejectedResult =>
      attempt.status === "rejected",
  );
  if (failure === undefined) {
    return attempts.flatMap((attempt) =>
      attempt.status === "fulfilled"
        ? [
            {
              sourcePath: attempt.value.createArgs.sourcePath,
              path: attempt.value.created.path,
              baseBranch: attempt.value.createArgs.baseBranch?.ref ?? null,
              ownsBranch: attempt.value.created.ownsBranch,
            },
          ]
        : [],
    );
  }
  for (const attempt of attempts) {
    if (attempt.status !== "fulfilled") continue;
    await abandonCreateTarget(
      { ...attempt.value.createArgs, signal: undefined },
      attempt.value.created.ownsBranch,
    ).catch(() => undefined);
  }
  throw failure.reason;
}
