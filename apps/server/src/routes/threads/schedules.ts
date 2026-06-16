import {
  createThreadSchedule,
  deleteThreadSchedule,
  getThreadSchedule,
  isSqliteUniqueConstraintOnColumns,
  listThreadSchedulesByThread,
  updateThreadSchedule,
  type ThreadScheduleRow,
  type UpdateThreadScheduleInput,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
  type ResolvedCreateThreadScheduleRequest,
  type UpdateThreadScheduleConfigRequest,
  type UpdateThreadScheduleEnabledRequest,
  type UpdateThreadScheduleRequest,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import {
  computeNextScheduledTime,
  ScheduleValidationError,
  validateScheduleDefinition,
} from "../../services/scheduling/schedule-helpers.js";
import { toThreadScheduleResponse } from "../../services/scheduling/thread-schedule-response.js";

interface RequireThreadScheduleArgs {
  scheduleId: string;
  threadId: string;
}

interface ScheduleTimingValues {
  cron: string;
  timezone: string;
}

interface CreateThreadScheduleValues {
  cron: string;
  enabled: boolean;
  name: string;
  prompt: string;
  timezone: string;
}

interface BuildThreadScheduleConfigUpdateInputArgs {
  current: ThreadScheduleRow;
  payload: UpdateThreadScheduleConfigRequest;
}

interface BuildThreadScheduleEnabledUpdateInputArgs {
  current: ThreadScheduleRow;
  payload: UpdateThreadScheduleEnabledRequest;
}

function computeNextFireAt(values: ScheduleTimingValues): number {
  return computeNextScheduledTime({
    cron: values.cron,
    now: Date.now(),
    timezone: values.timezone,
  });
}

function resolveCreateThreadScheduleValues(
  payload: ResolvedCreateThreadScheduleRequest,
): CreateThreadScheduleValues {
  return {
    name: payload.name,
    enabled: payload.enabled,
    cron: payload.cron,
    timezone: payload.timezone,
    prompt: payload.prompt,
  };
}

function requireThreadSchedule(
  deps: Pick<AppDeps, "db">,
  args: RequireThreadScheduleArgs,
): ThreadScheduleRow {
  const schedule = getThreadSchedule(deps.db, args.scheduleId);
  if (!schedule || schedule.threadId !== args.threadId) {
    throw new ApiError(404, "invalid_request", "Thread schedule not found");
  }
  return schedule;
}

function buildThreadScheduleConfigUpdateInput(
  args: BuildThreadScheduleConfigUpdateInputArgs,
): UpdateThreadScheduleInput {
  const nextTiming = {
    cron: args.payload.cron ?? args.current.cron,
    timezone: args.payload.timezone ?? args.current.timezone,
  };
  if (args.payload.cron !== undefined || args.payload.timezone !== undefined) {
    validateScheduleDefinition(nextTiming);
  }
  const shouldRecomputeNextFireAt =
    args.current.enabled &&
    (args.payload.cron !== undefined || args.payload.timezone !== undefined);

  return {
    ...(args.payload.name !== undefined ? { name: args.payload.name } : {}),
    ...(args.payload.cron !== undefined ? { cron: args.payload.cron } : {}),
    ...(args.payload.timezone !== undefined
      ? { timezone: args.payload.timezone }
      : {}),
    ...(args.payload.prompt !== undefined
      ? { prompt: args.payload.prompt }
      : {}),
    ...(shouldRecomputeNextFireAt
      ? { nextFireAt: computeNextFireAt(nextTiming) }
      : {}),
  };
}

function buildThreadScheduleEnabledUpdateInput(
  args: BuildThreadScheduleEnabledUpdateInputArgs,
): UpdateThreadScheduleInput {
  if (!args.payload.enabled) {
    return { enabled: false };
  }

  return {
    enabled: true,
    nextFireAt: computeNextFireAt(args.current),
  };
}

function isThreadScheduleEnabledUpdate(
  payload: UpdateThreadScheduleRequest,
): payload is UpdateThreadScheduleEnabledRequest {
  return "enabled" in payload;
}

function isThreadScheduleNameConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return isSqliteUniqueConstraintOnColumns(error, {
    columnNames: ["thread_id", "name"],
    indexName: "thread_schedules_thread_name_idx",
    tableName: "thread_schedules",
  });
}

function translateThreadScheduleWriteError(error: unknown): never {
  if (error instanceof ScheduleValidationError) {
    throw new ApiError(400, "invalid_request", error.message);
  }
  if (isThreadScheduleNameConstraintError(error)) {
    throw new ApiError(
      409,
      "invalid_request",
      "A schedule with this name already exists for the thread",
    );
  }
  throw error;
}

// Archiving a thread disables its schedules; this keeps an archived thread from
// ever holding an enabled schedule via the create/enable write paths.
const ARCHIVED_THREAD_SCHEDULE_ENABLE_MESSAGE =
  "Cannot enable a schedule on an archived thread. Unarchive the thread first.";

export function registerThreadScheduleRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  get(routes.listSchedules, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      listThreadSchedulesByThread(deps.db, thread.id).map(
        toThreadScheduleResponse,
      ),
    );
  });

  post(routes.createSchedule, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const values = resolveCreateThreadScheduleValues(payload);
    if (values.enabled && thread.archivedAt !== null) {
      throw new ApiError(
        409,
        "invalid_request",
        ARCHIVED_THREAD_SCHEDULE_ENABLE_MESSAGE,
      );
    }
    try {
      validateScheduleDefinition(values);
      const schedule = createThreadSchedule(deps.db, deps.hub, {
        projectId: thread.projectId,
        threadId: thread.id,
        name: values.name,
        enabled: values.enabled,
        cron: values.cron,
        timezone: values.timezone,
        prompt: values.prompt,
        nextFireAt: computeNextFireAt(values),
      });
      return context.json(toThreadScheduleResponse(schedule), 201);
    } catch (error) {
      translateThreadScheduleWriteError(error);
    }
  });

  patch(routes.updateSchedule, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const current = requireThreadSchedule(deps, {
      threadId: thread.id,
      scheduleId: context.req.param("scheduleId"),
    });
    if (
      isThreadScheduleEnabledUpdate(payload) &&
      payload.enabled &&
      thread.archivedAt !== null
    ) {
      throw new ApiError(
        409,
        "invalid_request",
        ARCHIVED_THREAD_SCHEDULE_ENABLE_MESSAGE,
      );
    }

    try {
      if (
        isThreadScheduleEnabledUpdate(payload) &&
        payload.enabled === current.enabled
      ) {
        return context.json(toThreadScheduleResponse(current));
      }
      const updateInput = isThreadScheduleEnabledUpdate(payload)
        ? buildThreadScheduleEnabledUpdateInput({ current, payload })
        : buildThreadScheduleConfigUpdateInput({ current, payload });
      const updated = updateThreadSchedule(
        deps.db,
        deps.hub,
        current.id,
        updateInput,
      );
      if (!updated) {
        throw new ApiError(404, "invalid_request", "Thread schedule not found");
      }
      return context.json(toThreadScheduleResponse(updated));
    } catch (error) {
      translateThreadScheduleWriteError(error);
    }
  });

  del(routes.deleteSchedule, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const schedule = requireThreadSchedule(deps, {
      threadId: thread.id,
      scheduleId: context.req.param("scheduleId"),
    });
    deleteThreadSchedule(deps.db, deps.hub, schedule.id);
    return context.json({ ok: true });
  });
}
