import {
  closeAutomationRun,
  createAutomation,
  createAutomationId,
  createManualRun,
  deleteAutomation,
  getAutomationForProject,
  isAutomationSpawnedThread,
  listAutomationRuns,
  listAutomationsForProject,
  listAutomationsWithProject,
  setAutomationEnabled,
  updateAutomation,
  type AutomationRow,
} from "@bb/db";
import {
  automationsOverviewResponseSchema,
  publicApiRoutes,
  typedRoutes,
  type AutomationExecution,
  type AutomationTrigger,
  type PublicApiSchema,
  type ResolvedCreateAutomationRequest,
  type UpdateAutomationRequest,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import { requirePublicProject } from "../services/lib/entity-lookup.js";
import {
  parseAutomationDefinition,
  serializeAutomationEnvironment,
  serializeAutomationExecution,
  serializeAutomationTrigger,
  toAutomationResponse,
  toAutomationRunResponse,
} from "../services/scheduling/automation-config.js";
import {
  deleteAutomationScriptDir,
  writeInlineAutomationScript,
} from "../services/scheduling/automation-scripts.js";
import { executeAgentRun, executeScriptRun } from "../services/scheduling/automation-run.js";
import {
  computeNextScheduledTime,
  ScheduleValidationError,
  validateScheduleDefinition,
} from "../services/scheduling/schedule-helpers.js";

const AUTOMATION_RUN_LIST_DEFAULT_LIMIT = 50;
const AUTOMATION_RUN_LIST_MAX_LIMIT = 100;

function requireProjectAutomation(
  deps: Pick<AppDeps, "db">,
  args: { projectId: string; automationId: string },
): AutomationRow {
  const automation = getAutomationForProject(deps.db, args);
  if (!automation) {
    throw new ApiError(404, "automation_not_found", "Automation not found");
  }
  return automation;
}

function validateCron(trigger: AutomationTrigger): void {
  try {
    validateScheduleDefinition({
      cron: trigger.cron,
      timezone: trigger.timezone,
    });
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      throw new ApiError(400, "invalid_request", error.message);
    }
    throw error;
  }
}

function computeNextRunAt(trigger: AutomationTrigger, now: number): number {
  return computeNextScheduledTime({
    cron: trigger.cron,
    now,
    timezone: trigger.timezone,
  });
}

/**
 * Reject create-automation calls whose declared creating thread is itself
 * automation-spawned. Best-effort origin gate (the public API has no caller
 * identity, so the gate only fires when `createdByThreadId` is supplied), but
 * server-trusted: it keys on persisted `automation_runs` state rather than a
 * spoofable thread title or client-declared flag.
 */
function assertNotRecursiveCreation(
  deps: Pick<AppDeps, "db">,
  createdByThreadId: string | undefined,
): void {
  if (createdByThreadId === undefined) {
    return;
  }
  if (isAutomationSpawnedThread(deps.db, createdByThreadId)) {
    throw new ApiError(
      400,
      "invalid_request",
      "Automation-spawned threads cannot create automations",
    );
  }
}

/**
 * Operator gate: script-mode automations execute arbitrary host commands, so
 * creating/running them is gated by `config.automationsAllowScriptRuns`
 * (DEFAULT ENABLED). Throws 403 when disabled.
 */
function assertScriptRunsAllowed(
  deps: Pick<AppDeps, "config">,
  execution: AutomationExecution,
): void {
  if (execution.mode === "script" && !deps.config.automationsAllowScriptRuns) {
    throw new ApiError(
      403,
      "invalid_request",
      "Script automations are disabled on this server",
    );
  }
}

/**
 * Resolve the execution to store: script-mode inline content is persisted on disk
 * and the stored execution carries `scriptFile` (never inline content).
 */
async function resolveStoredExecution(
  deps: Pick<AppDeps, "config">,
  args: { automationId: string; execution: AutomationExecution },
): Promise<AutomationExecution> {
  if (args.execution.mode !== "script") {
    return args.execution;
  }
  if (args.execution.script !== undefined) {
    const scriptFile = await writeInlineAutomationScript({
      dataDir: deps.config.dataDir,
      automationId: args.automationId,
      content: args.execution.script,
      scriptFile: args.execution.scriptFile,
    });
    const { script: _script, ...rest } = args.execution;
    return { ...rest, scriptFile };
  }
  return args.execution;
}

export function registerAutomationRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.automations;

  get(routes.overview, (context) => {
    const rows = listAutomationsWithProject(deps.db);
    const automations = rows.flatMap((row) => {
      try {
        return [
          {
            automation: toAutomationResponse(row.automation),
            project: { id: row.projectId, name: row.projectName },
          },
        ];
      } catch (error) {
        deps.logger.warn(
          { automationId: row.automation.id, err: error },
          "Skipping malformed automation in overview",
        );
        return [];
      }
    });
    return context.json(
      automationsOverviewResponseSchema.parse({ automations }),
    );
  });

  get(routes.list, (context) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    const responses = listAutomationsForProject(deps.db, projectId).flatMap(
      (row) => {
        try {
          return [toAutomationResponse(row)];
        } catch (error) {
          deps.logger.warn(
            { automationId: row.id, projectId, err: error },
            "Skipping malformed automation in list",
          );
          return [];
        }
      },
    );
    return context.json(responses);
  });

  post(routes.create, async (context, payload: ResolvedCreateAutomationRequest) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    validateCron(payload.trigger);
    assertNotRecursiveCreation(deps, payload.createdByThreadId);
    assertScriptRunsAllowed(deps, payload.execution);

    const now = Date.now();
    const nextRunAt = payload.enabled
      ? computeNextRunAt(payload.trigger, now)
      : null;

    // Pre-generate the id so any inline script is written under it BEFORE the
    // row exists. This makes create atomic: the row is inserted exactly once,
    // already pointing at the stored scriptFile — no insert→write→update window
    // where the sweep could read an inline-script row or a write failure could
    // leave an enabled, scheduled, script-less automation behind.
    const automationId = createAutomationId();
    const storedExecution = await resolveStoredExecution(deps, {
      automationId,
      execution: payload.execution,
    });

    const created = createAutomation(deps.db, deps.hub, {
      id: automationId,
      projectId,
      name: payload.name,
      enabled: payload.enabled,
      triggerType: payload.trigger.triggerType,
      triggerConfig: serializeAutomationTrigger(payload.trigger),
      runMode: storedExecution.mode,
      execution: serializeAutomationExecution(storedExecution),
      environment: serializeAutomationEnvironment(payload.environment),
      autoArchive: payload.autoArchive,
      origin: payload.origin,
      createdByThreadId: payload.createdByThreadId ?? null,
      targetThreadId:
        storedExecution.mode === "agent"
          ? (storedExecution.targetThreadId ?? null)
          : null,
      nextRunAt,
    });

    return context.json(toAutomationResponse(created), 201);
  });

  get(routes.get, (context) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    const automation = requireProjectAutomation(deps, {
      projectId,
      automationId: context.req.param("automationId"),
    });
    return context.json(toAutomationResponse(automation));
  });

  patch(routes.update, async (context, payload: UpdateAutomationRequest) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    const current = requireProjectAutomation(deps, {
      projectId,
      automationId: context.req.param("automationId"),
    });

    if (payload.trigger !== undefined) {
      validateCron(payload.trigger);
    }

    const patch: Parameters<typeof updateAutomation>[2]["patch"] = {};
    if (payload.name !== undefined) {
      patch.name = payload.name;
    }
    if (payload.trigger !== undefined) {
      patch.triggerType = payload.trigger.triggerType;
      patch.triggerConfig = serializeAutomationTrigger(payload.trigger);
      // Recompute the next run only while enabled; pause/resume own the rest.
      patch.nextRunAt = current.enabled
        ? computeNextRunAt(payload.trigger, Date.now())
        : null;
    }
    if (payload.autoArchive !== undefined) {
      patch.autoArchive = payload.autoArchive;
    }
    if (payload.environment !== undefined) {
      patch.environment = serializeAutomationEnvironment(payload.environment);
    }
    if (payload.execution !== undefined) {
      assertScriptRunsAllowed(deps, payload.execution);
      const storedExecution = await resolveStoredExecution(deps, {
        automationId: current.id,
        execution: payload.execution,
      });
      patch.runMode = storedExecution.mode;
      patch.execution = serializeAutomationExecution(storedExecution);
      patch.targetThreadId =
        storedExecution.mode === "agent"
          ? (storedExecution.targetThreadId ?? null)
          : null;
    }

    const updated = updateAutomation(deps.db, deps.hub, {
      projectId,
      automationId: current.id,
      patch,
    });
    if (!updated) {
      throw new ApiError(404, "automation_not_found", "Automation not found");
    }
    return context.json(toAutomationResponse(updated));
  });

  post(routes.pause, (context) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    const current = requireProjectAutomation(deps, {
      projectId,
      automationId: context.req.param("automationId"),
    });
    const updated = setAutomationEnabled(deps.db, deps.hub, {
      projectId,
      automationId: current.id,
      enabled: false,
      nextRunAt: null,
    });
    if (!updated) {
      throw new ApiError(404, "automation_not_found", "Automation not found");
    }
    return context.json(toAutomationResponse(updated));
  });

  post(routes.resume, (context) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    const current = requireProjectAutomation(deps, {
      projectId,
      automationId: context.req.param("automationId"),
    });
    const { trigger } = parseAutomationDefinition(current);
    validateCron(trigger);
    const updated = setAutomationEnabled(deps.db, deps.hub, {
      projectId,
      automationId: current.id,
      enabled: true,
      nextRunAt: computeNextRunAt(trigger, Date.now()),
      lastError: null,
    });
    if (!updated) {
      throw new ApiError(404, "automation_not_found", "Automation not found");
    }
    return context.json(toAutomationResponse(updated));
  });

  del(routes.delete, async (context) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    const automation = requireProjectAutomation(deps, {
      projectId,
      automationId: context.req.param("automationId"),
    });
    deleteAutomation(deps.db, deps.hub, {
      projectId,
      automationId: automation.id,
    });
    await deleteAutomationScriptDir({
      dataDir: deps.config.dataDir,
      automationId: automation.id,
    });
    return context.json({ ok: true });
  });

  post(routes.run, (context, payload) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    const automation = requireProjectAutomation(deps, {
      projectId,
      automationId: context.req.param("automationId"),
    });
    const now = Date.now();
    const { run, deduped } = createManualRun(deps.db, {
      automationId: automation.id,
      runMode: automation.runMode,
      idempotencyKey: payload.idempotencyKey ?? null,
      now,
    });
    if (!deduped) {
      deps.hub.notifyProject(projectId, ["automation-runs-changed"]);
      // The manual run has no schedule to roll back, so any failure must SETTLE
      // the run row as failed — otherwise a synchronous throw in setup (parse,
      // gate, host resolution) or an async spawn/RPC failure would leave the run
      // stuck in `running` forever. (The scheduled path instead rolls the
      // schedule back via restoreAutomationAfterFailedRun.)
      const settleFailed = (error: unknown): void => {
        deps.logger.error(
          { automationId: automation.id, err: error },
          "Manual automation run failed to dispatch",
        );
        closeAutomationRun(deps.db, {
          runId: run.id,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          now: Date.now(),
        });
        deps.hub.notifyProject(projectId, [
          "automations-changed",
          "automation-runs-changed",
        ]);
      };
      // Dispatch out of band; the response returns the created (running) run.
      void (async () => {
        try {
          const definition = parseAutomationDefinition(automation);
          assertScriptRunsAllowed(deps, definition.execution);
          if (definition.execution.mode === "agent") {
            await executeAgentRun(deps, {
              automation,
              run,
              execution: definition.execution,
              environment: definition.environment,
              onFailure: settleFailed,
            });
          } else {
            await executeScriptRun(deps, {
              automation,
              run,
              execution: definition.execution,
              environment: definition.environment,
              onFailure: settleFailed,
              now,
            });
          }
        } catch (error) {
          settleFailed(error);
        }
      })();
    }
    return context.json({ run: toAutomationRunResponse(run) }, 202);
  });

  get(routes.runs, (context, query) => {
    const projectId = context.req.param("id");
    requirePublicProject(deps.db, projectId);
    const automation = requireProjectAutomation(deps, {
      projectId,
      automationId: context.req.param("automationId"),
    });
    const limit = query.limit
      ? Math.min(Number(query.limit), AUTOMATION_RUN_LIST_MAX_LIMIT)
      : AUTOMATION_RUN_LIST_DEFAULT_LIMIT;
    const cursor = parseRunCursor(query.cursor);
    const runs = listAutomationRuns(deps.db, {
      automationId: automation.id,
      limit: limit + 1,
      cursor,
    });
    const hasMore = runs.length > limit;
    const page = hasMore ? runs.slice(0, limit) : runs;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeRunCursor(last.startedAt, last.id) : null;
    return context.json({
      runs: page.map(toAutomationRunResponse),
      nextCursor,
    });
  });
}

function encodeRunCursor(startedAt: number, id: string): string {
  return Buffer.from(`${startedAt}:${id}`, "utf8").toString("base64url");
}

function parseRunCursor(
  cursor: string | undefined,
): { startedAt: number; id: string } | null {
  if (cursor === undefined) {
    return null;
  }
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator <= 0) {
    throw new ApiError(400, "invalid_request", "Invalid runs cursor");
  }
  const startedAt = Number(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (!Number.isFinite(startedAt) || id.length === 0) {
    throw new ApiError(400, "invalid_request", "Invalid runs cursor");
  }
  return { startedAt, id };
}
