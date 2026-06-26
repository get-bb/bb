import path from "node:path";
import {
  countProjectSources,
  createProject,
  getPersonalProject,
  createProjectSource,
  deleteProjectSource,
  getProjectSourceByHost,
  getProjectSourceForProject,
  listProjectExecutionDefaultsByProjectIds,
  listPublicProjects,
  listProjectSourcesByProjectIds,
  listThreadFolders,
  listThreadsWithPendingInteractionStateForProjects,
  reorderProject,
  updateProject,
  updateProjectSource,
  type ReorderProjectResult,
} from "@bb/db";
import {
  projectListIncludeOptionSchema,
  publicApiRoutes,
  typedRoutes,
  type ProjectListIncludeOption,
  type ProjectListQuery,
  type ProjectResponse,
  type ProjectWithThreadsResponse,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import {
  readAttachment,
  storeAttachment,
} from "../services/projects/attachments.js";
import {
  requireNonDestroyedHostWithStatus,
  requireProject,
  requirePublicProject,
  requirePublicStandardProject,
  requireReadyEnvironment,
} from "../services/lib/entity-lookup.js";
import { PROMPT_HISTORY_ENTRY_LIMIT } from "@bb/domain";
import { resolveCreateThreadExecutionDefaults } from "../services/threads/thread-default-policy.js";
import { resolveProjectCreateDefaultExecutionPlan } from "../services/threads/thread-execution-plan.js";
import { toThreadListEntryResponses } from "../services/threads/thread-runtime-display.js";
import { callHostRetryableOnlineRpc } from "../services/hosts/online-rpc.js";
import {
  createDaemonFileContentResponse,
  remapDaemonFileRouteError,
} from "../services/hosts/daemon-file-response.js";
import {
  parseBoundedPositiveOptionalInteger,
  parseOptionalInteger,
} from "../services/lib/validation.js";
import {
  buildCommandListResponse,
  providerHasCommandSurface,
  resolveCommandWorkspace,
  PROVIDER_COMMAND_DEFAULT_LIMIT,
  PROVIDER_COMMAND_LIMIT_MAX,
} from "../services/threads/provider-command-typeahead.js";
import {
  beginProjectDeletion,
  requestProjectDeletionAdvance,
} from "../services/projects/project-deletion.js";
import { resolveDefaultWorktreeBaseBranch } from "../services/projects/worktree-base-branch.js";
import { listProjectPromptHistory } from "../services/prompt-history.js";
import { parsePathKindInclusion } from "./path-list-inclusion.js";
import {
  normalizeBranchQuery,
  parseBranchListLimit,
} from "./branch-list-query.js";
import { parseFileListLimit } from "./file-list-query.js";
import { parseSafeRelativeRoutePath } from "./relative-route-path.js";
import {
  assertPrimaryHostId,
  requirePrimaryHostId,
} from "../services/hosts/primary-host.js";

type ProjectResponseProjectFields = Omit<ProjectResponse, "sources">;
type ProjectResponseRow = ProjectResponseProjectFields;

function toProjectResponseProjectFields(
  project: ProjectResponseRow,
): ProjectResponseProjectFields {
  return {
    id: project.id,
    kind: project.kind,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function buildProjectResponsesFromRows(
  deps: AppDeps,
  projects: ProjectResponseRow[],
): ProjectResponse[] {
  if (projects.length === 0) {
    return [];
  }
  const sourcesByProjectId = new Map<string, ProjectResponse["sources"]>();
  for (const source of listProjectSourcesByProjectIds(
    deps.db,
    projects.map((project) => project.id),
  )) {
    const projectSources = sourcesByProjectId.get(source.projectId);
    if (projectSources) {
      projectSources.push(source);
      continue;
    }
    sourcesByProjectId.set(source.projectId, [source]);
  }

  return projects.map((project) => ({
    ...toProjectResponseProjectFields(project),
    sources: sourcesByProjectId.get(project.id) ?? [],
  }));
}

function buildProjectResponses(
  deps: AppDeps,
  projectId?: string,
): ProjectResponse[] {
  const projects = projectId
    ? [requirePublicStandardProject(deps.db, projectId)]
    : listPublicProjects(deps.db);
  return buildProjectResponsesFromRows(deps, projects);
}

function toProjectOrderResponse(
  deps: AppDeps,
  result: ReorderProjectResult,
): ProjectResponse[] {
  switch (result.kind) {
    case "reordered":
    case "unchanged":
      return buildProjectResponsesFromRows(deps, result.projects);
    case "not_found":
      throw new ApiError(404, "project_not_found", "Project not found");
    case "stale_neighbor":
      throw new ApiError(409, "invalid_request", "Project order changed");
    case "invalid_neighbor_order":
      throw new ApiError(409, "invalid_request", "Project order is invalid");
  }
}

function parseProjectListIncludes(
  query: ProjectListQuery,
): Set<ProjectListIncludeOption> {
  const includes = new Set<ProjectListIncludeOption>();
  if (!query.include) {
    return includes;
  }
  for (const value of query.include.split(",")) {
    includes.add(projectListIncludeOptionSchema.parse(value));
  }
  return includes;
}

function buildProjectsWithThreadsResponse(
  deps: AppDeps,
): ProjectWithThreadsResponse[] {
  return buildProjectsWithThreadsResponseFromRows(
    deps,
    listPublicProjects(deps.db),
  );
}

interface BuildProjectsWithThreadsResponseOptions {
  includeSideChats?: boolean;
}

function buildProjectsWithThreadsResponseFromRows(
  deps: AppDeps,
  projectRows: ProjectResponseRow[],
  options: BuildProjectsWithThreadsResponseOptions = {},
): ProjectWithThreadsResponse[] {
  const projects = buildProjectResponsesFromRows(deps, projectRows);
  const projectIds = projects.map((project) => project.id);
  const threadRows = listThreadsWithPendingInteractionStateForProjects(
    deps.db,
    {
      archived: false,
      ...(options.includeSideChats === false
        ? { excludeOriginKind: "side-chat" as const }
        : {}),
      projectIds,
    },
  );
  const threadResponses = toThreadListEntryResponses(deps, {
    threads: threadRows,
  });
  const threadsByProjectId = new Map<
    string,
    ProjectWithThreadsResponse["threads"]
  >();
  for (const thread of threadResponses) {
    const projectThreads = threadsByProjectId.get(thread.projectId);
    if (projectThreads) {
      projectThreads.push(thread);
      continue;
    }
    threadsByProjectId.set(thread.projectId, [thread]);
  }
  const defaultsByProjectId = listProjectExecutionDefaultsByProjectIds(
    deps.db,
    { projectIds },
  );

  return projects.map((project) => ({
    ...project,
    threads: threadsByProjectId.get(project.id) ?? [],
    defaultExecutionOptions: resolveCreateThreadExecutionDefaults({
      storedDefaults: defaultsByProjectId.get(project.id) ?? null,
    }).executionDefaults,
  }));
}

function buildSidebarBootstrapResponse(deps: AppDeps) {
  const personalProject = getPersonalProject(deps.db);
  if (!personalProject) {
    throw new ApiError(
      500,
      "internal_error",
      "Personal project is not initialized",
    );
  }
  const personalProjectResponse = buildProjectsWithThreadsResponseFromRows(
    deps,
    [personalProject],
    { includeSideChats: false },
  )[0];
  if (!personalProjectResponse) {
    throw new ApiError(
      500,
      "internal_error",
      "Personal project response was not built",
    );
  }
  return {
    folders: listThreadFolders(deps.db),
    projects: buildProjectsWithThreadsResponseFromRows(
      deps,
      listPublicProjects(deps.db),
      { includeSideChats: false },
    ),
    personalProject: personalProjectResponse,
  };
}

interface RequireProjectSourceArgs {
  projectId: string;
  sourceId: string;
}

function requireProjectSource(
  deps: Pick<AppDeps, "db">,
  args: RequireProjectSourceArgs,
) {
  const source = getProjectSourceForProject(deps.db, args);
  if (!source) {
    throw new ApiError(404, "invalid_request", "Project source not found");
  }
  return source;
}

interface ResolvedHostPath {
  hostId: string;
  path: string;
}

interface ResolveEnvironmentPathArgs {
  environmentId: string;
  projectId: string;
}

interface ResolveProjectSourcePathArgs {
  hostId: string | null;
  projectId: string;
}

/**
 * Resolve `(hostId, path)` from an existing project-bound environment.
 * Pure DB lookup — no provisioning, no daemon roundtrip. Use this when a
 * route narrows to a specific environment's workspace (e.g. a thread's
 * worktree) and needs to dispatch a `host.*` daemon command against the
 * environment's path.
 */
function resolveEnvironmentPath(
  deps: Pick<AppDeps, "config" | "db" | "hub">,
  args: ResolveEnvironmentPathArgs,
): ResolvedHostPath {
  const environment = requireReadyEnvironment(deps.db, args.environmentId);
  if (environment.projectId !== args.projectId) {
    throw new ApiError(404, "environment_not_found", "Environment not found");
  }
  assertPrimaryHostId(deps, { hostId: environment.hostId });
  return { hostId: environment.hostId, path: environment.path };
}

/**
 * Resolve `(hostId, path)` from a project's local-path source. Pure DB
 * lookup — never creates an environment row, never queues a provision
 * command. Use for read-only listings issued before any thread environment
 * exists (e.g. file mentions and branch listing in the new-thread prompt
 * box).
 *
 * - When `hostId` is provided, returns the project's local-path source on
 *   that host (404 if the project has no local-path source for that host).
 * - When `hostId` is null, returns the project's local-path source on the
 *   primary local host.
 */
function resolveProjectSourcePath(
  deps: Pick<AppDeps, "config" | "db" | "hub">,
  args: ResolveProjectSourcePathArgs,
): ResolvedHostPath {
  const hostId = args.hostId ?? requirePrimaryHostId(deps);
  assertPrimaryHostId(deps, { hostId });
  const source = getProjectSourceByHost(deps.db, args.projectId, hostId);
  if (!source || source.type !== "local_path") {
    throw new ApiError(
      args.hostId ? 404 : 409,
      "invalid_request",
      args.hostId
        ? "Project has no local-path source for host"
        : "Project has no local-path source for the local host",
    );
  }
  return { hostId: source.hostId, path: source.path };
}

export function registerProjectRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.projects;

  get(routes.list, (context, query) => {
    const includes = parseProjectListIncludes(query);
    if (includes.has("threads")) {
      return context.json(buildProjectsWithThreadsResponse(deps));
    }
    return context.json(buildProjectResponses(deps));
  });

  get(routes.sidebarBootstrap, (context) =>
    context.json(buildSidebarBootstrapResponse(deps)),
  );

  post(routes.create, async (context, payload) => {
    const { source } = payload;
    if (source.type === "local_path") {
      requireNonDestroyedHostWithStatus(deps, source.hostId);
      assertPrimaryHostId(deps, { hostId: source.hostId });
    }
    const { project } = createProject(deps.db, deps.hub, {
      name: payload.name,
      source,
    });
    return context.json(buildProjectResponses(deps, project.id)[0], 201);
  });

  get(routes.get, (context) =>
    context.json(buildProjectResponses(deps, context.req.param("id"))[0]),
  );

  get(routes.defaultExecutionOptions, (context, query) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    const plan = resolveProjectCreateDefaultExecutionPlan(deps, {
      projectId,
    });
    return context.json(plan.defaultView);
  });

  get(routes.promptHistory, (context, query) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    const limit = parseBoundedPositiveOptionalInteger({
      defaultValue: PROMPT_HISTORY_ENTRY_LIMIT,
      max: PROMPT_HISTORY_ENTRY_LIMIT,
      name: "limit",
      value: query.limit,
    });

    return context.json(
      listProjectPromptHistory(deps, {
        projectId,
        limit,
      }),
    );
  });

  patch(routes.update, async (context, payload) => {
    requirePublicStandardProject(deps.db, context.req.param("id"));
    const project = updateProject(
      deps.db,
      deps.hub,
      context.req.param("id"),
      payload,
    );
    if (!project) {
      throw new ApiError(404, "project_not_found", "Project not found");
    }
    return context.json(buildProjectResponses(deps, project.id)[0]);
  });

  patch(routes.reorder, async (context, payload) => {
    const projectId = context.req.param("id");
    requirePublicStandardProject(deps.db, projectId);
    return context.json(
      toProjectOrderResponse(
        deps,
        reorderProject({
          db: deps.db,
          notifier: deps.hub,
          projectId,
          previousProjectId: payload.previousProjectId,
          nextProjectId: payload.nextProjectId,
        }),
      ),
    );
  });

  del(routes.delete, async (context) => {
    const id = context.req.param("id");
    const project = requireProject(deps.db, id);
    if (project.kind === "personal") {
      throw new ApiError(
        409,
        "invalid_request",
        "The personal project cannot be deleted",
      );
    }
    beginProjectDeletion(deps, { projectId: id });
    requestProjectDeletionAdvance(deps, { projectId: id });
    return context.json({ ok: true });
  });

  post(routes.createSource, async (context, payload) => {
    requirePublicStandardProject(deps.db, context.req.param("id"));
    if (payload.type === "local_path") {
      requireNonDestroyedHostWithStatus(deps, payload.hostId);
      assertPrimaryHostId(deps, { hostId: payload.hostId });
    }
    const source = createProjectSource(deps.db, deps.hub, {
      projectId: context.req.param("id"),
      ...payload,
    });
    return context.json(source, 201);
  });

  patch(routes.updateSource, async (context, payload) => {
    requirePublicStandardProject(deps.db, context.req.param("id"));
    const existing = requireProjectSource(deps, {
      projectId: context.req.param("id"),
      sourceId: context.req.param("sourceId"),
    });
    if (existing.type === "local_path") {
      assertPrimaryHostId(deps, { hostId: existing.hostId });
    }
    if (payload.type !== existing.type) {
      throw new ApiError(
        400,
        "invalid_request",
        `Source type mismatch: source is ${existing.type} but request specifies ${payload.type}`,
      );
    }
    const source = updateProjectSource(
      deps.db,
      deps.hub,
      context.req.param("sourceId"),
      {
        ...(payload.path ? { path: payload.path } : {}),
        ...(payload.isDefault ? { isDefault: payload.isDefault } : {}),
      },
    );
    if (!source) {
      throw new ApiError(404, "invalid_request", "Project source not found");
    }
    return context.json(source);
  });

  del(routes.deleteSource, (context) => {
    const projectId = context.req.param("id");
    requirePublicStandardProject(deps.db, projectId);
    requireProjectSource(deps, {
      projectId,
      sourceId: context.req.param("sourceId"),
    });
    const sourceCount = countProjectSources(deps.db, { projectId });
    if (sourceCount <= 1) {
      throw new ApiError(
        409,
        "invalid_request",
        "Cannot delete the last source of a project",
      );
    }
    const deleted = deleteProjectSource(
      deps.db,
      deps.hub,
      context.req.param("sourceId"),
    );
    if (!deleted) {
      throw new ApiError(404, "invalid_request", "Project source not found");
    }
    return context.json({ ok: true });
  });

  get(routes.files, async (context, query) => {
    const projectId = context.req.param("id");
    requirePublicStandardProject(deps.db, projectId);

    const limit = parseFileListLimit(query.limit);

    // Both branches dispatch host.list_files against the resolved path —
    // env-scoped requests narrow to a specific environment's workspace
    // (e.g. a thread's worktree), pre-env requests fall back to the
    // project's default source.
    const target =
      query.environmentId !== null
        ? resolveEnvironmentPath(deps, {
            projectId,
            environmentId: query.environmentId,
          })
        : resolveProjectSourcePath(deps, { projectId, hostId: null });
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.list_files",
        path: target.path,
        ...(query.query ? { query: query.query } : {}),
        limit,
      },
    });
    return context.json({ files: result.files, truncated: result.truncated });
  });

  get(routes.fileContent, async (context, query) => {
    const projectId = context.req.param("id");
    requirePublicStandardProject(deps.db, projectId);
    const target = resolveProjectSourcePath(deps, { projectId, hostId: null });
    const filePath = parseSafeRelativeRoutePath(query.path);

    try {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId: target.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.read_file",
          path: path.join(target.path, filePath.relativePath),
          rootPath: target.path,
        },
      });
      return createDaemonFileContentResponse(result);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  });

  get(routes.paths, async (context, query) => {
    const projectId = context.req.param("id");
    requirePublicStandardProject(deps.db, projectId);

    const limit = parseFileListLimit(query.limit);

    // Project-source listing only: used by the new-thread compose box before
    // any environment exists. Once a thread has an environment, workspace
    // path search goes through `GET /environments/:id/paths` instead.
    const target = resolveProjectSourcePath(deps, {
      projectId,
      hostId: null,
    });
    const inclusion = parsePathKindInclusion({
      includeFiles: query.includeFiles,
      includeDirectories: query.includeDirectories,
    });
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.list_paths",
        path: target.path,
        ...(query.query ? { query: query.query } : {}),
        limit,
        includeFiles: inclusion.includeFiles,
        includeDirectories: inclusion.includeDirectories,
      },
    });
    return context.json({ paths: result.paths, truncated: result.truncated });
  });

  get(routes.commands, async (context, query) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);

    // Providers without a command surface (pi, anything unknown) have no
    // typeahead entries, so skip the daemon roundtrip entirely.
    if (!providerHasCommandSurface(query.provider)) {
      return context.json({ commands: [], truncated: false });
    }

    const limit = parseBoundedPositiveOptionalInteger({
      defaultValue: PROVIDER_COMMAND_DEFAULT_LIMIT,
      max: PROVIDER_COMMAND_LIMIT_MAX,
      name: "limit",
      value: query.limit,
    });
    const offset = parseOptionalInteger(query.offset, "offset") ?? 0;
    const workspace = resolveCommandWorkspace(deps, {
      environmentId: query.environmentId,
      projectId,
    });
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: workspace.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.list_commands",
        providerId: query.provider,
        cwd: workspace.cwd,
        builtinSkillsRootPath: deps.config.builtinSkillsRootPath,
        ...(deps.config.inheritedSkillsRootPaths.length > 0
          ? { additionalSkillsRootPaths: deps.config.inheritedSkillsRootPaths }
          : {}),
      },
    });
    return context.json(
      buildCommandListResponse({
        commands: result.commands,
        limit,
        offset,
        query: query.query,
      }),
    );
  });

  get(routes.branches, async (context, query) => {
    const projectId = context.req.param("id");
    requirePublicStandardProject(deps.db, projectId);

    const source = resolveProjectSourcePath(deps, {
      projectId,
      hostId: query.hostId,
    });
    const branchQuery = normalizeBranchQuery(query.query);
    const selectedBranch = normalizeBranchQuery(query.selectedBranch);
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: source.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.list_branches",
        path: source.path,
        ...(branchQuery ? { query: branchQuery } : {}),
        ...(selectedBranch ? { selectedBranch } : {}),
        limit: parseBranchListLimit(query.limit),
      },
    });
    return context.json({
      ...result,
      defaultWorktreeBaseBranch: resolveDefaultWorktreeBaseBranch(result),
    });
  });

  post(routes.uploadAttachment, async (context) => {
    requirePublicProject(deps.db, context.req.param("id"));
    const formData = await context.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "invalid_request", "Attachment file is required");
    }
    return context.json(
      await storeAttachment(deps.config.dataDir, context.req.param("id"), file),
      201,
    );
  });

  get(routes.attachmentContent, async (context, query) => {
    requirePublicProject(deps.db, context.req.param("id"));
    const attachment = await readAttachment(
      deps.config.dataDir,
      context.req.param("id"),
      query.path,
    );
    return new Response(new Uint8Array(attachment.content), {
      status: 200,
      headers: {
        "content-type": attachment.mimeType ?? "application/octet-stream",
      } as HeadersInit,
    });
  });
}
