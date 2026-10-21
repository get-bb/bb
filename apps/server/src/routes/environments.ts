import { gitRpcContract } from "bb-plugin-bb--git/contract";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { prepareHostSessionForWork } from "../services/hosts/online-rpc.js";
import { cleanupEnvironment } from "../services/environments/environment-engine.js";
import { parsePaginationQuery } from "../services/lib/validation.js";
import {
  countLiveThreadsInEnvironment,
  listEnvironments,
  updateEnvironmentMetadata,
} from "@bb/db";
import {
  environmentStatusValues,
  type EnvironmentStatus,
  type ThreadPullRequest,
} from "@bb/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
  type PullRequestMergeMethod,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import { requestEnvironmentRemoval } from "../services/environments/environment-engine.js";
import {
  toEnvironmentResponse,
  toEnvironmentResponses,
} from "../services/environments/environment-response.js";
import {
  requireEnvironment,
  requireReadyEnvironment,
} from "../services/lib/entity-lookup.js";
import { runLiveCommandAndWait } from "../services/hosts/live-command-wait.js";
import {
  callHostRetryableOnlineRpc,
  callHostRetryableOnlineRpcForWork,
} from "../services/hosts/online-rpc.js";
import { generateCommitMessage } from "../services/ai/commit-message.js";
import { archiveEnvironmentThreads } from "../services/threads/thread-archive.js";
import { parseFileListLimit } from "./file-list-query.js";
import { parsePathKindInclusion } from "./path-list-inclusion.js";
import {
  DEFAULT_PATH_LIST_EXCLUDE_NAMES,
  WORKSPACE_PATH_LIST_INCLUDE_HIDDEN,
} from "./path-list-policy.js";
import { requireWorkspaceCommandTarget } from "../services/environments/workspace-command-target.js";
import { createEnvironmentPullRequestWatch } from "../services/environments/pull-request-watch.js";
import { assembleThreadPullRequest } from "../services/environments/pull-request.js";

const LISTED_ENVIRONMENT_STATUSES: readonly EnvironmentStatus[] =
  environmentStatusValues.filter((status) => status !== "destroyed");

const COMMIT_FALLBACK_MESSAGE = "bb: automated commit";

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

async function mapPullRequestActionFailureTo409<TResult>(
  run: () => Promise<TResult>,
): Promise<TResult> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.body.code === "git_host_command_failed" ||
        error.body.code === "git_host_cli_unavailable" ||
        error.body.code === "invalid_request")
    ) {
      throw new ApiError(409, "pull_request_action_failed", error.body.message);
    }
    throw error;
  }
}

async function getPullRequestForWorkspaceTarget(
  deps: AppDeps,
  target: ReturnType<typeof requireWorkspaceCommandTarget>,
): Promise<ThreadPullRequest | null> {
  const result = await callHostRetryableOnlineRpcForWork(deps, {
    hostId: target.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "workspace.pull_request",
      environmentId: target.environmentId,
      workspaceContext: target.workspaceContext,
    },
  });
  return result.outcome === "available"
    ? assembleThreadPullRequest(result.pullRequest)
    : null;
}

function requirePullRequest(
  pullRequest: ThreadPullRequest | null,
): ThreadPullRequest {
  if (!pullRequest) {
    throw new ApiError(
      409,
      "pull_request_unavailable",
      "No pull request found",
    );
  }
  return pullRequest;
}

function assertCanMarkPullRequestReady(pullRequest: ThreadPullRequest): void {
  if (pullRequest.state !== "draft") {
    throw new ApiError(409, "invalid_request", "Pull request is not a draft");
  }
}

function assertCanConvertPullRequestToDraft(
  pullRequest: ThreadPullRequest,
): void {
  if (pullRequest.state !== "open") {
    throw new ApiError(409, "invalid_request", "Pull request is not open");
  }
}

function assertCanMergePullRequest(pullRequest: ThreadPullRequest): void {
  if (
    pullRequest.state !== "open" ||
    pullRequest.mergeability.state !== "mergeable"
  ) {
    throw new ApiError(
      409,
      "pull_request_not_mergeable",
      "Pull request is not currently mergeable",
    );
  }
}

async function runPullRequestAction(
  deps: AppDeps,
  environment: ReturnType<typeof requireReadyEnvironment>,
  action:
    | { operation: "ready" }
    | { operation: "draft" }
    | { operation: "merge"; method: PullRequestMergeMethod },
  assertState: (pullRequest: ThreadPullRequest) => void,
): Promise<void> {
  if (!environment.isGitRepo) {
    throw new ApiError(
      409,
      "invalid_request",
      "Pull request actions require a git environment",
    );
  }
  const target = requireWorkspaceCommandTarget(environment);
  const pullRequest = await getPullRequestForWorkspaceTarget(deps, target);
  assertState(requirePullRequest(pullRequest));

  await mapPullRequestActionFailureTo409(() =>
    runLiveCommandAndWait(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.pull_request_action",
        ...action,
        environmentId: target.environmentId,
        workspaceContext: target.workspaceContext,
      },
    }),
  );
}

export function registerEnvironmentRoutes(
  app: Hono,
  deps: AppDeps,
  plugins: PluginService,
): void {
  const { del, get, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.environments;
  const pullRequests = createEnvironmentPullRequestWatch(deps);
  post(routes.cleanup, (context) => {
    const environment = requireEnvironment(deps.db, context.req.param("id"));
    if (
      countLiveThreadsInEnvironment(deps.db, {
        environmentId: environment.id,
      }) > 0
    )
      throw new ApiError(
        409,
        "invalid_request",
        "Environment still has live threads",
      );
    if (!cleanupEnvironment(deps, environment.id))
      throw new ApiError(
        409,
        "invalid_request",
        "Environment is not provider-managed",
      );
    return context.json({ ok: true } as const);
  });

  get(routes.list, async (context, query) => {
    const { limit, offset } = parsePaginationQuery({
      limit: query?.limit,
      offset: query?.offset,
    });
    return context.json(
      toEnvironmentResponses(
        deps.db,
        listEnvironments(deps.db, {
          ...(query?.projectId ? { projectId: query.projectId } : {}),
          ...(query?.hostId ? { hostId: query.hostId } : {}),
          ...(query?.environmentProviderId
            ? { environmentProviderId: query.environmentProviderId }
            : {}),
          ...(query?.instanceKey ? { instanceKey: query.instanceKey } : {}),
          ...(query?.path === undefined ? {} : { path: query.path }),
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
          statuses: query?.status
            ? [query.status]
            : LISTED_ENVIRONMENT_STATUSES,
        }),
      ),
    );
  });

  del(routes.delete, (context) => {
    const environment = requireEnvironment(deps.db, context.req.param("id"));
    if (
      countLiveThreadsInEnvironment(deps.db, {
        environmentId: environment.id,
      }) > 0
    ) {
      throw new ApiError(
        409,
        "invalid_request",
        "Environment still has live threads",
      );
    }
    if (environment.status !== "destroyed") {
      if (!requestEnvironmentRemoval(deps, environment.id)) {
        throw new ApiError(
          409,
          "invalid_request",
          `Environment cannot be deleted while ${environment.status}`,
        );
      }
      deps.terminalSessions.closeDestroyedEnvironmentTerminals({
        environmentId: environment.id,
      });
    }
    return context.json({ ok: true } as const);
  });

  get(routes.get, (context) =>
    context.json(
      toEnvironmentResponse(
        deps.db,
        requireEnvironment(deps.db, context.req.param("id")),
      ),
    ),
  );

  patch(routes.update, (context, payload) => {
    const environment = requireEnvironment(deps.db, context.req.param("id"));
    const updated = updateEnvironmentMetadata(
      deps.db,
      deps.hub,
      environment.id,
      payload,
    );
    if (!updated) {
      throw new ApiError(404, "environment_not_found", "Environment not found");
    }
    return context.json(toEnvironmentResponse(deps.db, updated));
  });

  post(routes.archiveThreads, (context) => {
    const environment = requireEnvironment(deps.db, context.req.param("id"));
    const archivedThreadIds = archiveEnvironmentThreads(deps, { environment });
    return context.json({
      ok: true,
      archivedThreadIds,
    });
  });

  get(routes.pullRequest, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    return context.json(await pullRequests.read(environment));
  });

  get(routes.paths, async (context, query) => {
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
        signal: context.req.raw.signal,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.list_paths",
          path: environment.path,
          ...(query.query ? { query: query.query } : {}),
          limit,
          includeFiles: inclusion.includeFiles,
          includeDirectories: inclusion.includeDirectories,
          includeHidden: WORKSPACE_PATH_LIST_INCLUDE_HIDDEN,
          respectGitIgnore: true,
          excludeNames: [...DEFAULT_PATH_LIST_EXCLUDE_NAMES],
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
  });

  post(routes.actions, async (context, payload) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );

    try {
      switch (payload.action) {
        case "commit": {
          const target = requireWorkspaceCommandTarget(environment);
          const { workspaceContext } = target;

          await prepareHostSessionForWork(deps, { hostId: target.hostId });
          async function readGit(
            method: "status" | "diff",
            input: import("@bb/domain").JsonValue,
          ) {
            const lookup = plugins.getRpcHandler("bb--git", method);
            if (lookup.outcome !== "found")
              throw new ApiError(
                503,
                "git_unavailable",
                "Enable the Git plugin to commit changes",
              );
            const result = await plugins.invokeRpcHandler(
              "bb--git",
              method,
              lookup.value,
              input,
              { kind: "client" },
            );
            if (!result.ok)
              throw new ApiError(409, "git_read_failed", result.error.message);
            return result.result;
          }
          const [statusResult, diffResult] = await Promise.all([
            readGit("status", {
              environmentId: environment.id,
              mergeBaseBranch: null,
            }).then((result) => gitRpcContract.status.output.parse(result)),
            readGit("diff", {
              environmentId: environment.id,
              target: { type: "uncommitted" },
              purpose: "commit-message",
            }).then((result) => gitRpcContract.diff.output.parse(result)),
          ]);
          if (statusResult.outcome !== "available") {
            const failure =
              statusResult.outcome === "unavailable"
                ? statusResult.failure
                : {
                    code: "not_git_repo" as const,
                    workspacePath: target.workspaceContext.workspacePath,
                    message: statusResult.message,
                  };
            if ("error" in failure)
              throw new ApiError(
                failure.status,
                failure.error.code,
                failure.error.message,
                {
                  details: failure.error.details,
                  ...("retryable" in failure.error &&
                  typeof failure.error.retryable === "boolean"
                    ? { retryable: failure.error.retryable }
                    : {}),
                },
              );
            throw new ApiError(409, "workspace_unavailable", failure.message, {
              details: { kind: "workspace_unavailable", failure },
            });
          }
          if (diffResult.outcome !== "available") {
            const failure =
              diffResult.outcome === "unavailable"
                ? diffResult.failure
                : {
                    code: "not_git_repo" as const,
                    workspacePath: target.workspaceContext.workspacePath,
                    message: diffResult.message,
                  };
            if ("error" in failure)
              throw new ApiError(
                failure.status,
                failure.error.code,
                failure.error.message,
                {
                  details: failure.error.details,
                  ...("retryable" in failure.error &&
                  typeof failure.error.retryable === "boolean"
                    ? { retryable: failure.error.retryable }
                    : {}),
                },
              );
            throw new ApiError(409, "workspace_unavailable", failure.message, {
              details: { kind: "workspace_unavailable", failure },
            });
          }
          const workspaceStatus = statusResult.workspace;
          const workspaceDiff = diffResult.diff;
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
        case "pull_request_ready": {
          await runPullRequestAction(
            deps,
            environment,
            { operation: "ready" },
            assertCanMarkPullRequestReady,
          );
          return context.json({
            ok: true,
            action: "pull_request_ready",
            message: "Pull request marked ready",
          });
        }
        case "pull_request_draft": {
          await runPullRequestAction(
            deps,
            environment,
            { operation: "draft" },
            assertCanConvertPullRequestToDraft,
          );
          return context.json({
            ok: true,
            action: "pull_request_draft",
            message: "Pull request converted to draft",
          });
        }
        case "pull_request_merge": {
          await runPullRequestAction(
            deps,
            environment,
            { operation: "merge", method: payload.options.method },
            assertCanMergePullRequest,
          );
          return context.json({
            ok: true,
            action: "pull_request_merge",
            method: payload.options.method,
            message: "Pull request merge started",
          });
        }
        default: {
          const _exhaustive: never = payload;
          throw new Error(`Unhandled environment action: ${_exhaustive}`);
        }
      }
    } finally {
      deps.workspaceReadCaches.invalidateEnvironment(environment.id);
    }
  });
}
