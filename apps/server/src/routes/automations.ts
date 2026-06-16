import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  listAutomationsWithProjects,
  listThreadSchedulesWithThreadAndProject,
  updateAutomation,
  type AutomationWithProjectRow,
  type ThreadScheduleWithThreadAndProjectRow,
} from "@bb/db";
import type { Project } from "@bb/domain";
import {
  automationsOverviewResponseSchema,
  publicApiRoutes,
  type AutomationAction,
  type AutomationsOverviewAutomation,
  type AutomationsOverviewThreadSchedule,
  type AutomationScheduleTrigger,
  typedRoutes,
  type PublicApiSchema,
  type ResolvedCreateAutomationRequest,
  type UpdateAutomationConfigRequest,
  type UpdateAutomationEnabledRequest,
  type UpdateAutomationRequest,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import { runtimeErrorLogFields } from "../services/lib/error-log-fields.js";
import {
  buildStableThreadRequestProjectData,
  buildStableThreadRequestProjectDataMap,
  parseAutomationDefinition,
  parseAutomationAction,
  parseAutomationTriggerConfig,
  type ParsedAutomationDefinition,
  safeParseAutomationDefinition,
  serializeAutomationAction,
  serializeAutomationTrigger,
  toAutomationResponse,
  toAutomationResponseWithProjectData,
  validateStoredAutomationDefinition,
} from "../services/scheduling/automation-config.js";
import { toThreadScheduleResponse } from "../services/scheduling/thread-schedule-response.js";
import {
  ScheduleValidationError,
  computeNextScheduledTime,
  validateScheduleDefinition,
} from "../services/scheduling/schedule-helpers.js";
import { requirePublicProject } from "../services/lib/entity-lookup.js";
import { resolveStableThreadRequestEnvironment } from "../services/threads/thread-request-eligibility.js";

interface BuildAutomationConfigUpdateInputArgs {
  action: AutomationAction | undefined;
  current: NonNullable<ReturnType<typeof getAutomation>>;
  payload: UpdateAutomationConfigRequest;
}

interface BuildAutomationEnabledUpdateInputArgs {
  current: NonNullable<ReturnType<typeof getAutomation>>;
  payload: UpdateAutomationEnabledRequest;
}

interface CreateAutomationValues {
  action: AutomationAction;
  autoArchive: boolean;
  enabled: boolean;
  name: string;
  trigger: AutomationScheduleTrigger;
}

interface ValidateAutomationActionProjectScopeArgs {
  action: AutomationAction;
  project: Project;
}

interface ResolveAutomationActionForProjectArgs {
  action: AutomationAction;
  project: Project;
}

type AutomationRouteDeps = Pick<AppDeps, "config" | "db">;

interface BuildAutomationsOverviewArgs {
  deps: AppDeps;
  rows: readonly AutomationWithProjectRow[];
}

interface BuildThreadSchedulesOverviewArgs {
  rows: ThreadScheduleWithThreadAndProjectRow[];
}

interface ParsedAutomationOverviewRow {
  automation: AutomationWithProjectRow["automation"];
  parsedDefinition: ParsedAutomationDefinition;
  project: AutomationWithProjectRow["project"];
}

interface ParseAutomationOverviewRowsArgs {
  deps: AppDeps;
  rows: readonly AutomationWithProjectRow[];
}

interface AutomationOverviewValidationIds {
  environmentIds: string[];
  hostIds: string[];
  projectIds: string[];
}

interface CollectAutomationOverviewValidationIdsArgs {
  rows: readonly ParsedAutomationOverviewRow[];
}

function requireProjectAutomation(
  deps: Pick<AppDeps, "db">,
  args: {
    automationId: string;
    projectId: string;
  },
) {
  const automation = getAutomation(deps.db, args.automationId);
  if (!automation || automation.projectId !== args.projectId) {
    throw new ApiError(404, "invalid_request", "Automation not found");
  }
  return automation;
}

function resolveNextRunAtForCreate(payload: CreateAutomationValues) {
  validateScheduleDefinition(payload.trigger);
  if (!payload.enabled) {
    return null;
  }
  return computeScheduledNextRunAt(payload.trigger);
}

function computeScheduledNextRunAt(trigger: AutomationScheduleTrigger) {
  return computeNextScheduledTime({
    cron: trigger.cron,
    now: Date.now(),
    timezone: trigger.timezone,
  });
}

function resolveCreateAutomationValues(
  payload: ResolvedCreateAutomationRequest,
): CreateAutomationValues {
  return {
    name: payload.name,
    enabled: payload.enabled,
    trigger: payload.trigger,
    action: payload.action,
    autoArchive: payload.autoArchive,
  };
}

function buildAutomationConfigUpdateInput(
  args: BuildAutomationConfigUpdateInputArgs,
) {
  const nextTrigger =
    args.payload.trigger ??
    parseAutomationTriggerConfig(args.current.triggerConfig);
  if (args.payload.trigger !== undefined) {
    validateScheduleDefinition(args.payload.trigger);
  }
  const shouldRecomputeNextRunAt =
    args.current.enabled &&
    (args.payload.trigger !== undefined || args.current.nextRunAt === null);
  const nextRunAt = shouldRecomputeNextRunAt
    ? computeScheduledNextRunAt(nextTrigger)
    : undefined;

  return {
    ...(args.payload.name !== undefined ? { name: args.payload.name } : {}),
    ...(args.payload.trigger !== undefined
      ? {
          triggerType: args.payload.trigger.triggerType,
          triggerConfig: serializeAutomationTrigger(args.payload.trigger),
        }
      : {}),
    ...(args.payload.action !== undefined
      ? { action: serializeAutomationAction(requireUpdatedAction(args.action)) }
      : {}),
    ...(args.payload.autoArchive !== undefined
      ? { autoArchive: args.payload.autoArchive }
      : {}),
    nextRunAt,
  };
}

function requireUpdatedAction(
  action: AutomationAction | undefined,
): AutomationAction {
  if (!action) {
    throw new Error("Automation action update was not resolved");
  }
  return action;
}

function buildAutomationEnabledUpdateInput(
  deps: AutomationRouteDeps,
  args: BuildAutomationEnabledUpdateInputArgs,
) {
  if (!args.payload.enabled) {
    return {
      enabled: false,
      nextRunAt: null,
    };
  }

  const { parsedDefinition, validation } = validateStoredAutomationDefinition(
    deps,
    args.current,
  );
  if (!validation.isValid || parsedDefinition === null) {
    return {
      enabled: true,
      nextRunAt: null,
    };
  }

  return {
    enabled: true,
    nextRunAt:
      args.current.enabled && args.current.nextRunAt !== null
        ? undefined
        : computeScheduledNextRunAt(parsedDefinition.trigger),
  };
}

function validateAutomationActionProjectScope(
  deps: AutomationRouteDeps,
  args: ValidateAutomationActionProjectScopeArgs,
): void {
  resolveStableThreadRequestEnvironment(deps, {
    environment: args.action.threadRequest.environment,
    projectId: args.project.id,
  });
}

function resolveAutomationActionForProject(
  deps: AutomationRouteDeps,
  args: ResolveAutomationActionForProjectArgs,
): AutomationAction {
  validateAutomationActionProjectScope(deps, args);

  switch (args.action.actionType) {
    case "scheduled-thread": {
      const environment = args.action.threadRequest.environment;
      if (
        environment.type !== "host" ||
        environment.workspace.type !== "personal"
      ) {
        return args.action;
      }
      const resolvedEnvironment = resolveStableThreadRequestEnvironment(deps, {
        environment,
        projectId: args.project.id,
      });
      if (
        resolvedEnvironment.type !== "personal" ||
        resolvedEnvironment.hostId === null
      ) {
        throw new Error("Validated personal automation is missing hostId");
      }
      return {
        ...args.action,
        threadRequest: {
          ...args.action.threadRequest,
          environment: {
            ...environment,
            hostId: resolvedEnvironment.hostId,
          },
        },
      };
    }
  }
  return args.action;
}

function isAutomationEnabledUpdate(
  payload: UpdateAutomationRequest,
): payload is UpdateAutomationEnabledRequest {
  return "enabled" in payload;
}

function parseAutomationOverviewRows({
  deps,
  rows,
}: ParseAutomationOverviewRowsArgs): ParsedAutomationOverviewRow[] {
  return rows.flatMap(({ automation, project }) => {
    try {
      return [
        {
          automation,
          parsedDefinition: parseAutomationDefinition(automation),
          project,
        },
      ];
    } catch (error) {
      deps.logger.warn(
        {
          automationId: automation.id,
          projectId: automation.projectId,
          ...runtimeErrorLogFields(deps.config, error),
        },
        "Skipping malformed automation row in overview response",
      );
      return [];
    }
  });
}

function collectAutomationOverviewValidationIds({
  rows,
}: CollectAutomationOverviewValidationIdsArgs): AutomationOverviewValidationIds {
  const environmentIds = new Set<string>();
  const hostIds = new Set<string>();
  const projectIds = new Set<string>();

  for (const { automation, parsedDefinition } of rows) {
    projectIds.add(automation.projectId);
    const environment = parsedDefinition.action.threadRequest.environment;
    switch (environment.type) {
      case "host":
        if (environment.hostId !== undefined) {
          hostIds.add(environment.hostId);
        }
        break;
      case "reuse":
        environmentIds.add(environment.environmentId);
        break;
      default: {
        const exhaustiveCheck: never = environment;
        throw new Error(
          `Unsupported automation thread environment: ${exhaustiveCheck}`,
        );
      }
    }
  }

  return {
    environmentIds: [...environmentIds],
    hostIds: [...hostIds],
    projectIds: [...projectIds],
  };
}

function buildAutomationsOverviewItems({
  deps,
  rows,
}: BuildAutomationsOverviewArgs): AutomationsOverviewAutomation[] {
  const parsedRows = parseAutomationOverviewRows({ deps, rows });
  const validationIds = collectAutomationOverviewValidationIds({
    rows: parsedRows,
  });
  const projectDataByProjectId = buildStableThreadRequestProjectDataMap(
    deps,
    validationIds,
  );

  return parsedRows.flatMap(({ automation, parsedDefinition, project }) => {
    try {
      const projectData = projectDataByProjectId.get(automation.projectId);
      if (!projectData) {
        throw new Error("Automation overview project data was not loaded");
      }
      return [
        {
          automation: toAutomationResponseWithProjectData(
            automation,
            parsedDefinition,
            projectData,
          ),
          project,
        },
      ];
    } catch (error) {
      deps.logger.warn(
        {
          automationId: automation.id,
          projectId: automation.projectId,
          ...runtimeErrorLogFields(deps.config, error),
        },
        "Skipping malformed automation row in overview response",
      );
      return [];
    }
  });
}

function buildThreadSchedulesOverviewItems({
  rows,
}: BuildThreadSchedulesOverviewArgs): AutomationsOverviewThreadSchedule[] {
  return rows.map(({ project, schedule, thread }) => ({
    project,
    schedule: toThreadScheduleResponse(schedule),
    thread,
  }));
}

export function registerAutomationRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.projects;
  const automationRoutes = publicApiRoutes.automations;

  get(automationRoutes.list, (context) => {
    const response = automationsOverviewResponseSchema.parse({
      automations: buildAutomationsOverviewItems({
        deps,
        rows: listAutomationsWithProjects(deps.db),
      }),
      threadSchedules: buildThreadSchedulesOverviewItems({
        rows: listThreadSchedulesWithThreadAndProject(deps.db),
      }),
    });
    return context.json(response);
  });

  get(routes.listAutomations, (context) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    const automations = listAutomations(deps.db, projectId);
    const parsedAutomations = automations.map((automation) => ({
      automation,
      ...safeParseAutomationDefinition(automation),
    }));
    const hostIds = new Set<string>();
    const environmentIds = new Set<string>();

    for (const parsed of parsedAutomations) {
      const action = parsed.parsedDefinition?.action;
      if (!action) {
        continue;
      }

      switch (action.threadRequest.environment.type) {
        case "host":
          if (action.threadRequest.environment.hostId !== undefined) {
            hostIds.add(action.threadRequest.environment.hostId);
          }
          break;
        case "reuse":
          environmentIds.add(action.threadRequest.environment.environmentId);
          break;
        default: {
          const exhaustiveCheck: never = action.threadRequest.environment;
          throw new Error(
            `Unsupported automation thread environment: ${exhaustiveCheck}`,
          );
        }
      }
    }

    const projectData = buildStableThreadRequestProjectData(deps, {
      projectId,
      hostIds: [...hostIds],
      environmentIds: [...environmentIds],
    });
    const responses = parsedAutomations.flatMap(
      ({ automation, parsedDefinition }) => {
        try {
          if (parsedDefinition === null) {
            deps.logger.warn(
              {
                automationId: automation.id,
                projectId,
              },
              "Skipping malformed automation row in list response",
            );
            return [];
          }
          return [
            toAutomationResponseWithProjectData(
              automation,
              parsedDefinition,
              projectData,
            ),
          ];
        } catch (error) {
          deps.logger.warn(
            {
              automationId: automation.id,
              projectId,
              ...runtimeErrorLogFields(deps.config, error),
            },
            "Skipping malformed automation row in list response",
          );
          return [];
        }
      },
    );
    return context.json(responses);
  });

  post(routes.createAutomation, (context, payload) => {
    const projectId = context.req.param("id");
    const project = requirePublicProject(deps.db, projectId);

    try {
      const values = resolveCreateAutomationValues(payload);
      const action = resolveAutomationActionForProject(deps, {
        action: values.action,
        project,
      });
      const automation = createAutomation(deps.db, deps.hub, {
        projectId,
        name: values.name,
        enabled: values.enabled,
        triggerType: values.trigger.triggerType,
        triggerConfig: serializeAutomationTrigger(values.trigger),
        action: serializeAutomationAction(action),
        autoArchive: values.autoArchive,
        nextRunAt: resolveNextRunAtForCreate(values),
      });
      return context.json(toAutomationResponse(deps, automation), 201);
    } catch (error) {
      if (error instanceof ScheduleValidationError) {
        throw new ApiError(400, "invalid_request", error.message);
      }
      throw error;
    }
  });

  patch(routes.updateAutomation, (context, payload) => {
    const projectId = context.req.param("id");
    const project = requirePublicProject(deps.db, projectId);
    const current = requireProjectAutomation(deps, {
      projectId,
      automationId: context.req.param("automationId"),
    });

    try {
      const updateInput = isAutomationEnabledUpdate(payload)
        ? buildAutomationEnabledUpdateInput(deps, {
            current,
            payload,
          })
        : (() => {
            const nextAction =
              payload.action ?? parseAutomationAction(current.action);
            const action = resolveAutomationActionForProject(deps, {
              action: nextAction,
              project,
            });
            return buildAutomationConfigUpdateInput({
              action: payload.action !== undefined ? action : undefined,
              current,
              payload,
            });
          })();
      const updated = updateAutomation(
        deps.db,
        deps.hub,
        current.id,
        updateInput,
      );
      if (!updated) {
        throw new ApiError(404, "invalid_request", "Automation not found");
      }
      return context.json(toAutomationResponse(deps, updated));
    } catch (error) {
      if (error instanceof ScheduleValidationError) {
        throw new ApiError(400, "invalid_request", error.message);
      }
      throw error;
    }
  });

  del(routes.deleteAutomation, (context) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    requireProjectAutomation(deps, {
      projectId,
      automationId: context.req.param("automationId"),
    });
    deleteAutomation(deps.db, deps.hub, context.req.param("automationId"));
    return context.json({ ok: true });
  });
}
