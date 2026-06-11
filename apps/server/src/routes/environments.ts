import path from "node:path";
import { updateEnvironmentMetadata } from "@bb/db";
import {
  type GitBranchRefClassification,
  resolveEnvironmentWorkspaceDisplayKind,
  type Environment,
} from "@bb/domain";
import {
  environmentActionRequestSchema,
  environmentDiffBranchesQuerySchema,
  environmentDiffFileQuerySchema,
  environmentDiffQuerySchema,
  environmentPathsQuerySchema,
  environmentStatusQuerySchema,
  updateEnvironmentRequestSchema,
  typedRoutes,
  type EnvironmentDiffFileQuery,
  type EnvironmentDiffQuery,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import {
  COMMAND_TIMEOUT_MS,
  WORKSPACE_DIFF_MAX_DIFF_BYTES,
  WORKSPACE_DIFF_MAX_FILE_LIST_BYTES,
} from "../constants.js";
import { ApiError } from "../errors.js";
import {
  requireEnvironment,
  requireReadyEnvironment,
} from "../services/lib/entity-lookup.js";
import { runLiveCommandAndWait } from "../services/hosts/live-command-wait.js";
import { callHostRetryableOnlineRpc } from "../services/hosts/online-rpc.js";
import { generateCommitMessage } from "../services/ai/commit-message.js";
import { archiveEnvironmentThreads } from "../services/threads/thread-archive.js";
import {
  normalizeBranchQuery,
  parseBranchListLimit,
} from "./branch-list-query.js";
import { parseFileListLimit } from "./file-list-query.js";
import { parsePathKindInclusion } from "./path-list-inclusion.js";
import { requireWorkspaceCommandTarget } from "../services/environments/workspace-command-target.js";
import { assembleThreadPullRequest } from "../services/environments/pull-request.js";
import {
  requireAvailableWorkspaceDiff,
  requireAvailableWorkspaceStatus,
} from "../services/environments/workspace-rpc-results.js";

const COMMIT_FALLBACK_MESSAGE = "bb: automated commit";
const SQUASH_MERGE_FALLBACK_MESSAGE = "bb: squash merge";
const PRE_MERGE_COMMIT_MESSAGE = "bb: pre-merge commit";

/** Caps for diffs sent to the inference model for commit message generation. */
const AI_MAX_DIFF_BYTES = 32_000;
const AI_MAX_FILE_LIST_BYTES = 4_000;

interface AssertSquashMergeTargetIsLocalArgs {
  selectedBranch: GitBranchRefClassification | null;
  targetBranch: string;
}

/**
 * Maps the daemon's typed `no_changes` failure (nothing to commit / nothing to
 * merge — e.g. a concurrent commit already captured the changes, or the branch
 * has no committed work) to a clean 409, instead of letting it surface as a
 * generic 502 git_command_failed.
 */
async function mapNoChangesTo409<TResult>(
  conflictMessage: string,
  run: () => Promise<TResult>,
): Promise<TResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "no_changes") {
      throw new ApiError(409, "no_changes", conflictMessage);
    }
    throw error;
  }
}

function assertSquashMergeTargetIsLocal({
  selectedBranch,
  targetBranch,
}: AssertSquashMergeTargetIsLocalArgs): void {
  if (selectedBranch?.kind === "local") {
    return;
  }

  if (selectedBranch?.kind === "remote") {
    throw new ApiError(
      409,
      "invalid_request",
      `Cannot squash merge into remote branch ${targetBranch}; select a local branch`,
    );
  }

  throw new ApiError(
    409,
    "invalid_request",
    `Target branch does not exist: ${targetBranch}`,
  );
}

function toWorkspaceDiffTarget(query: EnvironmentDiffQuery) {
  switch (query.target) {
    case "uncommitted":
      return { type: "uncommitted" as const };
    case "branch_committed":
      return {
        type: "branch_committed" as const,
        mergeBaseBranch: query.mergeBaseBranch,
      };
    case "all":
      return {
        type: "all" as const,
        mergeBaseBranch: query.mergeBaseBranch,
      };
    case "commit":
      return {
        type: "commit" as const,
        sha: query.sha,
      };
    default: {
      const _exhaustive: never = query;
      return _exhaustive;
    }
  }
}

function isWorktreeEnvironment(environment: Environment): boolean {
  return resolveEnvironmentWorkspaceDisplayKind({ environment }) !== "other";
}

/**
 * Pick the git ref to read for the requested side of a diff. Returns
 * `undefined` when the side should be read from the working tree (no ref —
 * `host.read_file` falls back to its disk-read path).
 *
 * Only `uncommitted` and `all` have a working-tree side; the others read
 * from refs on both sides. `branch_committed` and `all` use the merge-base
 * SHA the diff was computed against as their old side (passed in by the
 * client from `workspace.diff`'s response — reading from the branch tip
 * instead would diverge from the diff's hunk coordinates whenever the
 * branch has moved past the merge-base). `commit` uses the parent commit
 * (`<sha>^`); on a root commit that ref is missing, but the daemon's
 * `git cat-file` fallback already returns empty content for missing
 * objects, so we don't special-case the root-commit edge here.
 */
function resolveDiffFileRef(
  query: EnvironmentDiffFileQuery,
): string | undefined {
  switch (query.target) {
    case "uncommitted":
      return query.side === "old" ? "HEAD" : undefined;
    case "branch_committed":
      return query.side === "old" ? query.mergeBaseRef : "HEAD";
    case "all":
      return query.side === "old" ? query.mergeBaseRef : undefined;
    case "commit":
      return query.side === "old" ? `${query.sha}^` : query.sha;
    default: {
      const _exhaustive: never = query;
      return _exhaustive;
    }
  }
}

export function registerEnvironmentRoutes(app: Hono, deps: AppDeps): void {
  const { get, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/environments/:id", (context) =>
    context.json(requireEnvironment(deps.db, context.req.param("id"))),
  );

  patch(
    "/environments/:id",
    updateEnvironmentRequestSchema,
    (context, payload) => {
      const environment = requireEnvironment(deps.db, context.req.param("id"));
      const updated = updateEnvironmentMetadata(
        deps.db,
        deps.hub,
        environment.id,
        payload,
      );
      if (!updated) {
        throw new ApiError(
          404,
          "environment_not_found",
          "Environment not found",
        );
      }
      return context.json(updated);
    },
  );

  post("/environments/:id/archive-threads", (context) => {
    const environment = requireEnvironment(deps.db, context.req.param("id"));
    if (!isWorktreeEnvironment(environment)) {
      throw new ApiError(
        409,
        "invalid_request",
        "Only worktree environments can be archived as a group",
      );
    }

    const archivedThreadIds = archiveEnvironmentThreads(deps, { environment });
    return context.json({
      ok: true,
      archivedThreadIds,
    });
  });

  get(
    "/environments/:id/status",
    environmentStatusQuerySchema,
    async (context, query) => {
      const environment = requireReadyEnvironment(
        deps.db,
        context.req.param("id"),
      );
      if (!environment.isGitRepo) {
        return context.json({
          outcome: "not_applicable",
          reason: "non_git_environment",
          message: "Workspace status is not available for non-git environments",
        });
      }
      const target = requireWorkspaceCommandTarget(environment);
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId: target.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "workspace.status",
          environmentId: target.environmentId,
          workspaceContext: target.workspaceContext,
          ...(query.mergeBaseBranch
            ? { mergeBaseBranch: query.mergeBaseBranch }
            : {}),
        },
      });
      if (result.outcome === "unavailable") {
        return context.json({
          outcome: "unavailable",
          failure: result.failure,
        });
      }
      return context.json({
        outcome: "available",
        workspace: result.workspaceStatus,
      });
    },
  );

  get("/environments/:id/pull-request", async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    // A non-git environment has no branch and therefore no PR; skip the daemon.
    if (!environment.isGitRepo) {
      return context.json({ pullRequest: null });
    }
    const target = requireWorkspaceCommandTarget(environment);
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.pull_request",
        environmentId: target.environmentId,
        workspaceContext: target.workspaceContext,
      },
    });
    return context.json({
      pullRequest: assembleThreadPullRequest(result.pullRequest),
    });
  });

  get(
    "/environments/:id/diff",
    environmentDiffQuerySchema,
    async (context, query) => {
      const environment = requireReadyEnvironment(
        deps.db,
        context.req.param("id"),
      );
      if (!environment.isGitRepo) {
        return context.json({
          outcome: "not_applicable",
          reason: "non_git_environment",
          message: "Workspace diff is not available for non-git environments",
        });
      }
      const target = requireWorkspaceCommandTarget(environment);
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId: target.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "workspace.diff",
          environmentId: target.environmentId,
          workspaceContext: target.workspaceContext,
          target: toWorkspaceDiffTarget(query),
          maxDiffBytes: WORKSPACE_DIFF_MAX_DIFF_BYTES,
          maxFileListBytes: WORKSPACE_DIFF_MAX_FILE_LIST_BYTES,
        },
      });
      if (result.outcome === "unavailable") {
        return context.json({
          outcome: "unavailable",
          failure: result.failure,
        });
      }
      return context.json({
        outcome: "available",
        diff: result.diff,
      });
    },
  );

  get(
    "/environments/:id/diff/file",
    environmentDiffFileQuerySchema,
    async (context, query) => {
      const environment = requireReadyEnvironment(
        deps.db,
        context.req.param("id"),
      );
      const repoRelativePath = query.path.replace(/^\/+/u, "");
      if (
        repoRelativePath.length === 0 ||
        repoRelativePath.split("/").includes("..")
      ) {
        throw new ApiError(400, "invalid_request", "Invalid path");
      }
      const absolutePath = path.join(environment.path, repoRelativePath);
      const ref = resolveDiffFileRef(query);
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId: environment.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.read_file",
          path: absolutePath,
          rootPath: environment.path,
          ...(ref !== undefined ? { ref } : {}),
        },
      });
      return context.json({
        path: result.path,
        content: result.content,
        contentEncoding: result.contentEncoding,
        ...(result.mimeType ? { mimeType: result.mimeType } : {}),
        sizeBytes: result.sizeBytes,
      });
    },
  );

  get(
    "/environments/:id/diff/branches",
    environmentDiffBranchesQuerySchema,
    async (context, query) => {
      const environment = requireReadyEnvironment(
        deps.db,
        context.req.param("id"),
      );
      const branchQuery = normalizeBranchQuery(query.query);
      const selectedBranch = normalizeBranchQuery(query.selectedBranch);
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId: environment.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.list_branches",
          path: environment.path,
          ...(branchQuery ? { query: branchQuery } : {}),
          ...(selectedBranch ? { selectedBranch } : {}),
          limit: parseBranchListLimit(query.limit),
        },
      });
      return context.json({
        branches: result.branches,
        branchesTruncated: result.branchesTruncated,
        remoteBranches: result.remoteBranches,
        remoteBranchesTruncated: result.remoteBranchesTruncated,
        selectedBranch: result.selectedBranch,
      });
    },
  );

  get(
    "/environments/:id/paths",
    environmentPathsQuerySchema,
    async (context, query) => {
      const environment = requireReadyEnvironment(
        deps.db,
        context.req.param("id"),
      );
      const limit = parseFileListLimit(query.limit);
      const inclusion = parsePathKindInclusion({
        includeFiles: query.includeFiles,
        includeDirectories: query.includeDirectories,
      });

      try {
        const result = await callHostRetryableOnlineRpc(deps, {
          hostId: environment.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "host.list_paths",
            path: environment.path,
            ...(query.query ? { query: query.query } : {}),
            limit,
            includeFiles: inclusion.includeFiles,
            includeDirectories: inclusion.includeDirectories,
          },
        });
        return context.json({
          paths: result.paths,
          truncated: result.truncated,
        });
      } catch (error) {
        if (error instanceof ApiError && error.body.code === "ENOENT") {
          return context.json({ paths: [], truncated: false });
        }
        throw error;
      }
    },
  );

  post(
    "/environments/:id/actions",
    environmentActionRequestSchema,
    async (context, payload) => {
      const environment = requireReadyEnvironment(
        deps.db,
        context.req.param("id"),
      );

      switch (payload.action) {
        case "commit": {
          const target = requireWorkspaceCommandTarget(environment);
          const { workspaceContext } = target;

          const [statusResult, diffResult] = await Promise.all([
            callHostRetryableOnlineRpc(deps, {
              hostId: target.hostId,
              timeoutMs: COMMAND_TIMEOUT_MS,
              command: {
                type: "workspace.status",
                environmentId: target.environmentId,
                workspaceContext,
              },
            }),
            callHostRetryableOnlineRpc(deps, {
              hostId: target.hostId,
              timeoutMs: COMMAND_TIMEOUT_MS,
              command: {
                type: "workspace.diff",
                environmentId: target.environmentId,
                workspaceContext,
                target: { type: "uncommitted" },
                maxDiffBytes: AI_MAX_DIFF_BYTES,
                maxFileListBytes: AI_MAX_FILE_LIST_BYTES,
              },
            }),
          ]);
          const workspaceStatus = requireAvailableWorkspaceStatus(statusResult);
          const workspaceDiff = requireAvailableWorkspaceDiff(diffResult);
          if (!workspaceStatus.workingTree.hasUncommittedChanges) {
            throw new ApiError(
              409,
              "no_changes",
              "No uncommitted changes to commit",
            );
          }

          const aiMessage = await generateCommitMessage(deps, {
            diffDescription: "uncommitted changes",
            shortstat: workspaceDiff.shortstat,
            files: workspaceDiff.files,
            patch: workspaceDiff.diff,
          });
          const commitMessage = aiMessage ?? COMMIT_FALLBACK_MESSAGE;

          const result = await mapNoChangesTo409(
            "No uncommitted changes to commit",
            () =>
              runLiveCommandAndWait(deps, {
                hostId: target.hostId,
                timeoutMs: COMMAND_TIMEOUT_MS,
                command: {
                  type: "workspace.commit",
                  environmentId: target.environmentId,
                  workspaceContext,
                  message: commitMessage,
                },
              }),
          );
          return context.json({
            ok: true,
            action: "commit",
            message: `Created commit ${result.commitSha}`,
            commitSha: result.commitSha,
            commitSubject: result.commitSubject,
          });
        }
        case "squash_merge": {
          const target = requireWorkspaceCommandTarget(environment);
          const { workspaceContext } = target;
          const targetBranch = payload.options.mergeBaseBranch;

          const statusResult = await callHostRetryableOnlineRpc(deps, {
            hostId: target.hostId,
            timeoutMs: COMMAND_TIMEOUT_MS,
            command: {
              type: "workspace.status",
              environmentId: target.environmentId,
              workspaceContext,
            },
          });
          const workspaceStatus = requireAvailableWorkspaceStatus(statusResult);

          const currentBranch = workspaceStatus.branch.currentBranch;
          if (!currentBranch) {
            throw new ApiError(
              409,
              "invalid_request",
              "Cannot squash merge from a detached workspace",
            );
          }

          const targetBranchResult = await callHostRetryableOnlineRpc(deps, {
            hostId: environment.hostId,
            timeoutMs: COMMAND_TIMEOUT_MS,
            command: {
              type: "host.list_branches",
              path: environment.path,
              selectedBranch: targetBranch,
              limit: 1,
            },
          });
          assertSquashMergeTargetIsLocal({
            selectedBranch: targetBranchResult.selectedBranch,
            targetBranch,
          });

          if (workspaceStatus.workingTree.hasUncommittedChanges) {
            await runLiveCommandAndWait(deps, {
              hostId: target.hostId,
              timeoutMs: COMMAND_TIMEOUT_MS,
              command: {
                type: "workspace.commit",
                environmentId: target.environmentId,
                workspaceContext,
                message: PRE_MERGE_COMMIT_MESSAGE,
              },
            });
          }

          const diffResult = await callHostRetryableOnlineRpc(deps, {
            hostId: target.hostId,
            timeoutMs: COMMAND_TIMEOUT_MS,
            command: {
              type: "workspace.diff",
              environmentId: target.environmentId,
              workspaceContext,
              target: {
                type: "branch_committed",
                mergeBaseBranch: targetBranch,
              },
              maxDiffBytes: AI_MAX_DIFF_BYTES,
              maxFileListBytes: AI_MAX_FILE_LIST_BYTES,
            },
          });
          const workspaceDiff = requireAvailableWorkspaceDiff(diffResult);

          const aiMessage = await generateCommitMessage(deps, {
            diffDescription: `squash merge of ${currentBranch} into ${targetBranch}`,
            shortstat: workspaceDiff.shortstat,
            files: workspaceDiff.files,
            patch: workspaceDiff.diff,
          });
          const commitMessage = aiMessage ?? SQUASH_MERGE_FALLBACK_MESSAGE;

          const result = await mapNoChangesTo409(
            `No changes to merge into ${targetBranch}`,
            () =>
              runLiveCommandAndWait(deps, {
                hostId: target.hostId,
                timeoutMs: COMMAND_TIMEOUT_MS,
                command: {
                  type: "workspace.squash_merge",
                  environmentId: target.environmentId,
                  workspaceContext,
                  targetBranch,
                  commitMessage,
                },
              }),
          );
          return context.json({
            ok: true,
            action: "squash_merge",
            merged: result.merged,
            message: "Squash merge completed",
            commitSha: result.commitSha,
            commitSubject: result.commitSubject,
          });
        }
        default: {
          const _exhaustive: never = payload;
          throw new Error(`Unhandled environment action: ${_exhaustive}`);
        }
      }
    },
  );
}
