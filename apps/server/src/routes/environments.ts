import {
  cleanupEnvironment,
  recoverEnvironmentCleanup,
  requestEnvironmentRemoval,
} from "../services/environments/environment-engine.js";
import { parsePaginationQuery } from "../services/lib/validation.js";
import {
  clearDiffViewedFiles,
  countLiveThreadsInEnvironment,
  listDiffViewedFiles,
  listEnvironments,
  markDiffViewedFile,
  updateEnvironmentMetadata,
  type DiffViewedFileScope,
} from "@bb/db";
import {
  environmentStatusValues,
  type EnvironmentStatus,
  type WorkspaceDiffTarget,
} from "@bb/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type EnvironmentDiffQuery,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import {
  readCommitInputs,
  refreshGitState,
  type GitPluginRpc,
} from "../services/environments/git-plugin-reads.js";
import { ApiError } from "../errors.js";
import {
  toEnvironmentResponse,
  toEnvironmentResponses,
} from "../services/environments/environment-response.js";
import {
  requireEnvironment,
  requireReadyEnvironment,
} from "../services/lib/entity-lookup.js";
import {
  ensureHostSessionReadyForWork,
} from "../services/hosts/host-lifecycle.js";
import { runLiveCommandAndWait } from "../services/hosts/live-command-wait.js";
import { callHostRetryableOnlineRpc } from "../services/hosts/online-rpc.js";
import { generateCommitMessage } from "../services/ai/commit-message.js";
import { archiveEnvironmentThreads } from "../services/threads/thread-archive.js";
import { parseFileListLimit } from "./file-list-query.js";
import { parsePathKindInclusion } from "./path-list-inclusion.js";
import {
  DEFAULT_PATH_LIST_EXCLUDE_NAMES,
  WORKSPACE_PATH_LIST_INCLUDE_HIDDEN,
} from "./path-list-policy.js";
import {
  requireWorkspaceCommandTarget,
} from "../services/environments/workspace-command-target.js";

const LISTED_ENVIRONMENT_STATUSES: readonly EnvironmentStatus[] =
  environmentStatusValues.filter((status) => status !== "destroyed");

const COMMIT_FALLBACK_MESSAGE = "bb: automated commit";

const AI_MAX_DIFF_BYTES = 32_000;
const AI_MAX_FILE_LIST_BYTES = 4_000;

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

function diffViewedTargetKey(target: WorkspaceDiffTarget): string {
  switch (target.type) {
    case "uncommitted":
      return "uncommitted";
    case "branch_committed":
    case "all":
      return `${target.type}:${target.mergeBaseBranch}`;
    case "commit":
      return `commit:${target.sha.toLowerCase()}`;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

function resolveDiffViewedScope(
  deps: AppDeps,
  environmentId: string,
  target: WorkspaceDiffTarget,
): DiffViewedFileScope {
  const environment = requireEnvironment(deps.db, environmentId);
  return {
    environmentId: environment.id,
    targetKey: diffViewedTargetKey(target),
  };
}

export function registerEnvironmentRoutes(
  app: Hono,
  deps: AppDeps,
  plugins: GitPluginRpc,
): void {
  const { del, get, patch, post, put } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.environments;
  post(routes.cleanup, async (context, query) => {
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
    if (query?.recover === "true") {
      await recoverEnvironmentCleanup(deps, environment.id);
      return context.json({ ok: true } as const);
    }
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

  get(routes.diffViewed, (context, query) => {
    const scope = resolveDiffViewedScope(
      deps,
      context.req.param("id"),
      toWorkspaceDiffTarget(query),
    );
    return context.json({ files: listDiffViewedFiles(deps.db, scope, null) });
  });

  post(routes.queryDiffViewed, (context, payload) => {
    const scope = resolveDiffViewedScope(
      deps,
      context.req.param("id"),
      toWorkspaceDiffTarget(payload),
    );
    return context.json({
      files: listDiffViewedFiles(deps.db, scope, payload.paths),
    });
  });

  put(routes.markDiffViewed, (context, payload) => {
    const scope = resolveDiffViewedScope(
      deps,
      context.req.param("id"),
      payload.target,
    );
    markDiffViewedFile(deps.db, {
      ...scope,
      path: payload.path,
      revision: payload.revision,
    });
    deps.hub.notifyEnvironment(scope.environmentId, ["diff-viewed-changed"]);
    return context.json({ ok: true as const });
  });

  del(routes.clearDiffViewed, (context, payload) => {
    const scope = resolveDiffViewedScope(
      deps,
      context.req.param("id"),
      payload.target,
    );
    clearDiffViewedFiles(deps.db, { ...scope, path: payload.path ?? null });
    deps.hub.notifyEnvironment(scope.environmentId, ["diff-viewed-changed"]);
    return context.json({ ok: true as const });
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

  post(routes.actions, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );

    const target = requireWorkspaceCommandTarget(environment);
    const { workspaceContext } = target;

    await ensureHostSessionReadyForWork(deps, { hostId: target.hostId });
    const { status: workspaceStatus, diff: workspaceDiff } =
      await readCommitInputs(plugins, {
        environmentId: environment.id,
        workspacePath: environment.path,
        maxDiffBytes: AI_MAX_DIFF_BYTES,
        maxFileListBytes: AI_MAX_FILE_LIST_BYTES,
      });
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
    await refreshGitState(plugins, target.environmentId);
    return context.json({
      ok: true,
      action: "commit",
      message: `Created commit ${result.commitSha}`,
      commitSha: result.commitSha,
      commitSubject: result.commitSubject,
    });
  });
}
