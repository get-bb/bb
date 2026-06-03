import {
  countProjectSources,
  createProject,
  getPersonalProject,
  createProjectSource,
  deleteProjectSource,
  getDefaultProjectSource,
  getProjectSourceByHost,
  getProjectSourceForProject,
  listPublicProjects,
  listProjectSourcesByProjectIds,
  listThreads,
  listThreadsWithPendingInteractionState,
  listThreadsWithPendingInteractionStateForProjects,
  reorderManagerThread,
  reorderProject,
  updateProject,
  updateProjectSource,
  type ReorderManagerThreadResult,
  type ReorderProjectResult,
} from "@bb/db";
import {
  createManagerThreadRequestSchema,
  createProjectRequestSchema,
  createProjectSourceRequestSchema,
  projectAttachmentContentQuerySchema,
  projectBranchesQuerySchema,
  projectDefaultExecutionOptionsQuerySchema,
  projectFilesQuerySchema,
  projectPathsQuerySchema,
  projectListIncludeOptionSchema,
  projectListQuerySchema,
  promptHistoryQuerySchema,
  reorderManagerThreadRequestSchema,
  reorderProjectRequestSchema,
  typedRoutes,
  updateProjectRequestSchema,
  updateProjectSourceRequestSchema,
  type ProjectListIncludeOption,
  type ProjectListQuery,
  type ProjectResponse,
  type ProjectWithThreadsResponse,
  type PublicApiSchema,
  type ThreadListResponse,
  type EnvironmentArgs,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { renderTemplate } from "@bb/templates";
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
import { PROMPT_HISTORY_ENTRY_LIMIT, type PromptInput } from "@bb/domain";
import { createThreadFromRequest } from "../services/threads/thread-create.js";
import { resolveProjectCreateDefaultExecutionPlan } from "../services/threads/thread-execution-plan.js";
import {
  toThreadListEntryResponses,
  toThreadResponseFromThread,
} from "../services/threads/thread-runtime-display.js";
import { callHostRetryableOnlineRpc } from "../services/hosts/online-rpc.js";
import { parseBoundedPositiveOptionalInteger } from "../services/lib/validation.js";
import {
  beginProjectDeletion,
  requestProjectDeletionAdvance,
} from "../services/projects/project-deletion.js";
import { listProjectPromptHistory } from "../services/prompt-history.js";
import { parsePathKindInclusion } from "./path-list-inclusion.js";
import {
  normalizeBranchQuery,
  parseBranchListLimit,
} from "./branch-list-query.js";
import { parseFileListLimit } from "./file-list-query.js";

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

function buildProjectThreadListResponse(
  deps: AppDeps,
  projectId: string,
): ThreadListResponse {
  return toThreadListEntryResponses(deps, {
    threads: listThreadsWithPendingInteractionState(deps.db, {
      archived: false,
      projectId,
    }),
  });
}

function assertManagerThreadOrderResult(
  result: ReorderManagerThreadResult,
): void {
  switch (result.kind) {
    case "reordered":
    case "unchanged":
      return;
    case "not_found":
      throw new ApiError(404, "thread_not_found", "Thread not found");
    case "stale_neighbor":
      throw new ApiError(
        409,
        "invalid_request",
        "Manager thread order changed",
      );
    case "invalid_neighbor_order":
      throw new ApiError(
        409,
        "invalid_request",
        "Manager thread order is invalid",
      );
  }
}

/**
 * True when the caller-supplied input has any content the manager should act
 * on: any non-text part (image, local file), or at least one text part with
 * non-whitespace content. Used by the manager-hire route to decide between
 * the quick-start preamble path and the welcome-fallback path — a
 * whitespace-only text input has the same semantic meaning as no input at
 * all, so it should fall back to the welcome rather than emit an empty
 * timeline message preceded by an agent-only preamble.
 */
function managerHireInputHasMeaningfulContent(
  input: readonly PromptInput[],
): boolean {
  return input.some((part) => {
    if (part.type === "text") {
      return part.text.trim().length > 0;
    }
    return true;
  });
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

function buildProjectsWithThreadsResponseFromRows(
  deps: AppDeps,
  projectRows: ProjectResponseRow[],
): ProjectWithThreadsResponse[] {
  const projects = buildProjectResponsesFromRows(deps, projectRows);
  const projectIds = projects.map((project) => project.id);
  const threadRows = listThreadsWithPendingInteractionStateForProjects(
    deps.db,
    {
      archived: false,
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

  return projects.map((project) => ({
    ...project,
    threads: threadsByProjectId.get(project.id) ?? [],
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
  )[0];
  if (!personalProjectResponse) {
    throw new ApiError(
      500,
      "internal_error",
      "Personal project response was not built",
    );
  }
  return {
    projects: buildProjectsWithThreadsResponse(deps),
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

/**
 * Resolve `(hostId, path)` from an existing project-bound environment.
 * Pure DB lookup — no provisioning, no daemon roundtrip. Use this when a
 * route narrows to a specific environment's workspace (e.g. a thread's
 * worktree) and needs to dispatch a `host.*` daemon command against the
 * environment's path.
 */
function resolveEnvironmentPath(
  deps: Pick<AppDeps, "db">,
  args: { projectId: string; environmentId: string },
): ResolvedHostPath {
  const environment = requireReadyEnvironment(deps.db, args.environmentId);
  if (environment.projectId !== args.projectId) {
    throw new ApiError(404, "environment_not_found", "Environment not found");
  }
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
 * - When `hostId` is null, returns the project's default local-path source.
 */
function resolveProjectSourcePath(
  deps: Pick<AppDeps, "db">,
  args: { projectId: string; hostId: string | null },
): ResolvedHostPath {
  const source = args.hostId
    ? getProjectSourceByHost(deps.db, args.projectId, args.hostId)
    : getDefaultProjectSource(deps.db, args.projectId);
  if (!source || source.type !== "local_path") {
    throw new ApiError(
      args.hostId ? 404 : 409,
      "invalid_request",
      args.hostId
        ? "Project has no local-path source for host"
        : "Project has no default source",
    );
  }
  return { hostId: source.hostId, path: source.path };
}

export function registerProjectRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/projects", projectListQuerySchema, (context, query) => {
    const includes = parseProjectListIncludes(query);
    if (includes.has("threads")) {
      return context.json(buildProjectsWithThreadsResponse(deps));
    }
    return context.json(buildProjectResponses(deps));
  });

  get("/sidebar-bootstrap", (context) =>
    context.json(buildSidebarBootstrapResponse(deps)),
  );

  post("/projects", createProjectRequestSchema, async (context, payload) => {
    const { source } = payload;
    if (source.type === "local_path") {
      requireNonDestroyedHostWithStatus(deps.db, source.hostId);
    }
    const { project } = createProject(deps.db, deps.hub, {
      name: payload.name,
      source,
    });
    return context.json(buildProjectResponses(deps, project.id)[0], 201);
  });

  get("/projects/:id", (context) =>
    context.json(buildProjectResponses(deps, context.req.param("id"))[0]),
  );

  get(
    "/projects/:id/default-execution-options",
    projectDefaultExecutionOptionsQuerySchema,
    (context, query) => {
      const projectId = context.req.param("id");
      requirePublicProject(deps.db, projectId);
      const plan = resolveProjectCreateDefaultExecutionPlan(deps, {
        projectId,
        threadType: query.threadType,
      });
      return context.json(plan.defaultView);
    },
  );

  get(
    "/projects/:id/prompt-history",
    promptHistoryQuerySchema,
    (context, query) => {
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
    },
  );

  patch(
    "/projects/:id",
    updateProjectRequestSchema,
    async (context, payload) => {
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
    },
  );

  patch(
    "/projects/:id/order",
    reorderProjectRequestSchema,
    async (context, payload) => {
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
    },
  );

  del("/projects/:id", async (context) => {
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

  post(
    "/projects/:id/sources",
    createProjectSourceRequestSchema,
    async (context, payload) => {
      requirePublicStandardProject(deps.db, context.req.param("id"));
      if (payload.type === "local_path") {
        requireNonDestroyedHostWithStatus(deps.db, payload.hostId);
      }
      const source = createProjectSource(deps.db, deps.hub, {
        projectId: context.req.param("id"),
        ...payload,
      });
      return context.json(source, 201);
    },
  );

  patch(
    "/projects/:id/sources/:sourceId",
    updateProjectSourceRequestSchema,
    async (context, payload) => {
      requirePublicStandardProject(deps.db, context.req.param("id"));
      const existing = requireProjectSource(deps, {
        projectId: context.req.param("id"),
        sourceId: context.req.param("sourceId"),
      });
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
    },
  );

  del("/projects/:id/sources/:sourceId", (context) => {
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

  get(
    "/projects/:id/files",
    projectFilesQuerySchema,
    async (context, query) => {
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
    },
  );

  get(
    "/projects/:id/paths",
    projectPathsQuerySchema,
    async (context, query) => {
      const projectId = context.req.param("id");
      requirePublicStandardProject(deps.db, projectId);

      const limit = parseFileListLimit(query.limit);

      const target =
        query.environmentId !== null
          ? resolveEnvironmentPath(deps, {
              projectId,
              environmentId: query.environmentId,
            })
          : resolveProjectSourcePath(deps, { projectId, hostId: null });
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
    },
  );

  get(
    "/projects/:id/branches",
    projectBranchesQuerySchema,
    async (context, query) => {
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
      return context.json(result);
    },
  );

  post("/projects/:id/attachments", async (context) => {
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

  get(
    "/projects/:id/attachments/content",
    projectAttachmentContentQuerySchema,
    async (context, query) => {
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
    },
  );

  post(
    "/projects/:id/managers",
    createManagerThreadRequestSchema,
    async (context, payload) => {
      const projectId = context.req.param("id");
      const project = requireProject(deps.db, projectId);

      const { hostId } = payload.environment;
      requireNonDestroyedHostWithStatus(deps.db, hostId);
      let environment: EnvironmentArgs;
      if (project.kind === "personal") {
        environment = {
          type: "host",
          hostId,
          workspace: { type: "personal" },
        };
      } else {
        requirePublicProject(deps.db, projectId);
        const source = getProjectSourceByHost(deps.db, projectId, hostId);
        if (!source) {
          throw new ApiError(
            409,
            "invalid_request",
            "No project source found for the selected host",
          );
        }
        if (source.type !== "local_path") {
          throw new ApiError(
            409,
            "invalid_request",
            "Project source for host has no local path",
          );
        }
        environment = {
          type: "host",
          hostId,
          workspace: { type: "unmanaged", path: source.path },
        };
      }

      let title: string;
      if (payload.name) {
        title = payload.name;
      } else {
        const existingManagers = listThreads(deps.db, {
          projectId,
          type: "manager",
        });
        title =
          existingManagers.length === 0
            ? "Manager"
            : `Manager ${existingManagers.length + 1}`;
      }

      // When the user provided instructions at hire time, prepend an
      // agent-only quick-start preamble so the manager knows to skip the
      // welcome ceremony (no scope / landing-mode / identity questions)
      // and act on the user's message directly. The preamble is hidden
      // from the timeline; the user's input renders as the first turn.
      // Without instructions — or with input that only contains
      // whitespace-only text — we fall back to the welcome template so
      // the manager still bootstraps preferences and asks the ceremony
      // questions on its own, and so the timeline doesn't show an empty
      // user message preceded by an invisible preamble.
      const quickStartUserInput =
        payload.input && managerHireInputHasMeaningfulContent(payload.input)
          ? payload.input
          : null;
      const firstMessage = quickStartUserInput
        ? [
            {
              type: "text" as const,
              text: renderTemplate("systemMessageManagerQuickStart", {}),
              visibility: "agent-only" as const,
            },
            ...quickStartUserInput,
          ]
        : [
            {
              type: "text" as const,
              text: renderTemplate("systemMessageManagerWelcome", {}),
            },
          ];

      const thread = await createThreadFromRequest(deps, {
        automationId: null,
        origin: payload.origin,
        projectId,
        providerId: payload.providerId,
        type: "manager",
        title,
        input: firstMessage,
        ...(payload.model ? { model: payload.model } : {}),
        ...(payload.serviceTier ? { serviceTier: payload.serviceTier } : {}),
        ...(payload.reasoningLevel
          ? { reasoningLevel: payload.reasoningLevel }
          : {}),
        ...(payload.executionInputSources
          ? { executionInputSources: payload.executionInputSources }
          : {}),
        environment,
      });
      return context.json(toThreadResponseFromThread(deps, { thread }), 201);
    },
  );

  patch(
    "/projects/:id/managers/:threadId/order",
    reorderManagerThreadRequestSchema,
    async (context, payload) => {
      const projectId = context.req.param("id");
      requirePublicStandardProject(deps.db, projectId);
      assertManagerThreadOrderResult(
        reorderManagerThread({
          db: deps.db,
          notifier: deps.hub,
          projectId,
          threadId: context.req.param("threadId"),
          previousThreadId: payload.previousThreadId,
          nextThreadId: payload.nextThreadId,
        }),
      );
      return context.json(buildProjectThreadListResponse(deps, projectId));
    },
  );
}
