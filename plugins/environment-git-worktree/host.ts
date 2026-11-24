import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { createHostProgress } from "bb-environment-provider-host/progress";
import { emitOutput } from "bb-environment-provider-host/transcript";
import { worktreeHostContract, worktreeHostSignals } from "./contract.js";
import { resolveWorktreeBaseBranch } from "./host/base-branch.js";
import {
  createFolderWorktrees,
  listFolderRepositories,
} from "./host/folders.js";
import {
  resolveFolderWorktreePaths,
  resolveManagedEnvironmentRoot,
  resolveWorktreeChildPath,
  resolveWorktreesRoot,
  resolveWorktreeAttemptRoot,
  resolveWorktreeTargetPath,
} from "./host/paths.js";
import {
  checkPoolMember,
  fastForwardWorktree,
  nameHandedOffBranch,
  readRemoteBase,
  refreshDefaultBase,
  restorePoolMember,
} from "./host/handoff.js";
import {
  createWorktree,
  deleteOwnedBranch,
  listAdoptableWorktrees,
  nameWorktreeBranch,
  readNamedWorktreeBranch,
  removeWorktree,
  resolveAdoptableWorktree,
} from "./host/worktree.js";

function completionPathForWorktree(worktreePath: string): string {
  return `${worktreePath}.completed`;
}

async function childWorktreePaths(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        resolveWorktreeChildPath({
          environmentRoot: root,
          childName: entry.name,
        }),
      );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function environmentWorktreePaths(args: {
  dataDir: string;
  pathKey: string;
  path: string | null;
}): Promise<string[]> {
  if (args.path === null) {
    return childWorktreePaths(resolveWorktreeAttemptRoot(args));
  }
  const root = resolveManagedEnvironmentRoot({
    dataDir: args.dataDir,
    worktreePath: args.path,
  });
  const mainPath = path.resolve(args.path);
  if (root === null) return [mainPath];
  return [
    mainPath,
    ...(await childWorktreePaths(root)).filter((child) => child !== mainPath),
  ];
}

export function createWorktreeHostEntry() {
  return experimental_defineHostEntry({
    contract: worktreeHostContract,
    experimental_signals: worktreeHostSignals,
    handlers: {
      async defaultBaseBranch(input) {
        const resolved = await resolveWorktreeBaseBranch(input.sourcePath, {
          kind: "default",
        });
        return { branch: resolved?.ref ?? null };
      },
      async listWorktrees(input, context) {
        const worktrees = await listAdoptableWorktrees({
          sourcePath: input.sourcePath,
          managedRoot: resolveWorktreesRoot(context.experimental_paths.dataDir),
        });
        return {
          worktrees: worktrees.map((entry) => ({
            path: entry.path,
            branch: entry.branch,
            locked: entry.locked,
            prunable: entry.prunable,
          })),
        };
      },
      async resolveExistingWorktree(input, context) {
        return resolveAdoptableWorktree({
          sourcePath: input.sourcePath,
          path: input.path,
          managedRoot: resolveWorktreesRoot(context.experimental_paths.dataDir),
        });
      },
      async refreshPoolBase(input, context) {
        return refreshDefaultBase({
          sourcePath: input.sourcePath,
          memberPaths: input.memberPaths,
          signal: context.signal,
        });
      },
      async restorePoolMember(input, context) {
        return restorePoolMember({
          sourcePath: input.sourcePath,
          path: input.path,
          placeholder: input.placeholder,
          signal: context.signal,
        });
      },
      async readRemoteBase(input, context) {
        return readRemoteBase({
          sourcePath: input.sourcePath,
          signal: context.signal,
        });
      },
      async fastForward(input, context) {
        await fastForwardWorktree({
          path: input.path,
          commit: input.commit,
          signal: context.signal,
        });
        return null;
      },
      async checkPoolMember(input, context) {
        return checkPoolMember({
          sourcePath: input.sourcePath,
          path: input.path,
          placeholder: input.placeholder,
          baseBranch: input.baseBranch,
          baseCommit: input.baseCommit,
          signal: context.signal,
        });
      },
      async nameHandedOffBranch(input, context) {
        await nameHandedOffBranch({
          path: input.path,
          fromBranch: input.fromBranch,
          toBranch: input.toBranch,
          completionPath: completionPathForWorktree(input.path),
          signal: context.signal,
        });
        return null;
      },
      async create(input, context) {
        const targetPath = resolveWorktreeTargetPath({
          dataDir: context.experimental_paths.dataDir,
          pathKey: input.pathKey,
          sourcePath: input.sourcePath,
        });
        try {
          const baseBranch = await resolveWorktreeBaseBranch(
            input.sourcePath,
            input.baseBranch,
          );
          const created = await createWorktree({
            sourcePath: input.sourcePath,
            targetPath,
            completionPath: completionPathForWorktree(targetPath),
            ownWorktreesRoot: resolveWorktreesRoot(
              context.experimental_paths.dataDir,
            ),
            branchName: input.branchName,
            baseBranch,
            branchMode: input.branchMode,
            role: "workspace",
            onProgress: createHostProgress({
              operationId: input.operationId,
              emit: (payload) =>
                context.experimental_emitSignal("progress", payload),
            }),
            signal: context.signal,
          });
          return {
            status: "created",
            path: created.path,
            baseBranch: baseBranch?.ref ?? null,
            ownsBranch: created.ownsBranch,
          } as const;
        } catch (error) {
          if (context.signal.aborted) throw error;
          return {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          } as const;
        }
      },

      async listFolderRepositories(input, context) {
        return {
          paths: await listFolderRepositories({
            paths: input.paths,
            signal: context.signal,
          }),
        };
      },

      async createFolders(input, context) {
        try {
          const targetPaths = resolveFolderWorktreePaths({
            dataDir: context.experimental_paths.dataDir,
            mainPath: input.path,
            sourcePaths: input.folders,
          });
          const folders = await createFolderWorktrees({
            mainSourcePath: input.sourcePath,
            ownWorktreesRoot: resolveWorktreesRoot(
              context.experimental_paths.dataDir,
            ),
            folders: input.folders.map((sourcePath, index) => {
              const targetPath = targetPaths[index] ?? input.path;
              return {
                sourcePath,
                targetPath,
                completionPath: completionPathForWorktree(targetPath),
              };
            }),
            branchName: input.branchName,
            branchMode: input.branchMode,
            onProgress: createHostProgress({
              operationId: input.operationId,
              emit: (payload) =>
                context.experimental_emitSignal("progress", payload),
            }),
            signal: context.signal,
          });
          return { status: "created", folders } as const;
        } catch (error) {
          if (context.signal.aborted) throw error;
          return {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          } as const;
        }
      },

      async nameBranch(input, context) {
        try {
          await nameWorktreeBranch({
            sourcePath: input.sourcePath,
            path: input.path,
            completionPath: completionPathForWorktree(input.path),
            ownWorktreesRoot: resolveWorktreesRoot(
              context.experimental_paths.dataDir,
            ),
            branchName: input.branchName,
            onProgress: createHostProgress({
              operationId: input.operationId,
              emit: (payload) =>
                context.experimental_emitSignal("progress", payload),
            }),
            signal: context.signal,
          });
          return { status: "named" } as const;
        } catch (error) {
          if (context.signal.aborted) throw error;
          return {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          } as const;
        }
      },

      async remove(input, context) {
        const onProgress = createHostProgress({
          operationId: input.operationId,
          emit: (payload) =>
            context.experimental_emitSignal("progress", payload),
        });
        const namedBranches: string[] = [];
        try {
          const paths = await environmentWorktreePaths({
            dataDir: context.experimental_paths.dataDir,
            pathKey: input.pathKey,
            path: input.path,
          });
          for (const path of paths) {
            const named = await readNamedWorktreeBranch(
              completionPathForWorktree(path),
            );
            if (named !== null && named !== input.ownedBranch?.name)
              namedBranches.push(named);
            await rm(completionPathForWorktree(path), { force: true });
            await removeWorktree({
              path,
              onProgress,
              signal: context.signal,
            });
          }
        } catch (error) {
          if (context.signal.aborted) throw error;
          return {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          } as const;
        }
        const ownedBranch = input.ownedBranch;
        const ownedBranches = [
          ...(ownedBranch === null
            ? []
            : [ownedBranch.name, ...namedBranches].map((name) => ({
                ...ownedBranch,
                name,
              }))),
          ...input.folderBranches,
        ];
        for (const branch of ownedBranches) {
          try {
            await deleteOwnedBranch({
              repositoryPath: branch.repositoryPath,
              branchName: branch.name,
              baseBranch: branch.baseBranch,
              onProgress,
              signal: context.signal,
            });
          } catch (error) {
            if (context.signal.aborted) throw error;
            emitOutput(
              onProgress,
              "branch-cleanup",
              `Kept branch ${branch.name}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        return { status: "removed" } as const;
      },
    },
  });
}

export default createWorktreeHostEntry();
