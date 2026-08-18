import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  createAutomation,
  createManualRun,
  deleteAutomation,
  getAutomationForProject,
  isAutomationSpawnedThread,
  listAllAutomations,
  listAutomationRuns,
  listAutomationsForProject,
  parseAutomationExecution,
  parseAutomationTrigger,
  setAutomationEnabled,
  toAutomationResponse,
  toAutomationRunResponse,
  updateAutomation,
  closeAutomationRun,
  type AutomationRow,
  type Db,
} from "./data.js";
import { createAutomationId } from "./ids.js";
import {
  providerRoutingForEnvironment,
  resolvePermissionMode,
} from "./provider-permissions.js";
import { publishAutomationChange } from "./realtime.js";
import {
  AUTOMATION_RUNS_LIMIT_MAX,
  automationRunListResponseSchema,
  automationsOverviewResponseSchema,
  type AgentExecutionUpdate,
  type AutomationExecution,
  type AutomationExecutionOptionsResponse,
  type AutomationPermissionOptionsResponse,
  type AutomationRunListResponse,
  type AutomationRunRpcResponse,
  type AutomationResponse,
  type AutomationsOverviewResponse,
  type ResolvedCreateAutomationInput,
  type ResolvedAutomationRunsInput,
  type RunAutomationInput,
  type UpdateAutomationInput,
} from "./rpc-types.js";
import {
  computeInitialNextRunAt,
  computeNextScheduledTime,
  validateOnceDefinition,
  validateScheduleDefinition,
} from "./schedule-helpers.js";
import {
  automationScriptDir,
  deleteAutomationScriptDir,
  deleteAutomationScriptFile,
  readAutomationScript,
  writeInlineAutomationScript,
} from "./script-files.js";
import { executeAgentRun, executeScriptRun } from "./run.js";

type ServiceApi = Pick<BbPluginApi, "realtime" | "log"> & {
  sdk: {
    projects: Pick<BbPluginApi["sdk"]["projects"], "get" | "list">;
    providers: Pick<BbPluginApi["sdk"]["providers"], "list"> &
      Partial<Pick<BbPluginApi["sdk"]["providers"], "models">>;
    threads: Pick<BbPluginApi["sdk"]["threads"], "get" | "send" | "spawn">;
  };
};

export interface AutomationService {
  overview(): Promise<AutomationsOverviewResponse>;
  list(input: { projectId: string }): AutomationResponse[];
  get(input: {
    projectId: string;
    automationId: string;
  }): Promise<AutomationResponse>;
  executionOptions(input: {
    projectId: string;
    automationId: string;
  }): Promise<AutomationExecutionOptionsResponse>;
  permissionOptions(input: {
    projectId: string;
    automationId: string;
  }): Promise<AutomationPermissionOptionsResponse>;
  create(input: ResolvedCreateAutomationInput): Promise<AutomationResponse>;
  update(input: UpdateAutomationInput): Promise<AutomationResponse>;
  delete(input: {
    projectId: string;
    automationId: string;
  }): Promise<{ ok: true }>;
  pause(input: { projectId: string; automationId: string }): AutomationResponse;
  resume(input: {
    projectId: string;
    automationId: string;
  }): AutomationResponse;
  run(input: RunAutomationInput): Promise<AutomationRunRpcResponse>;
  runs(input: ResolvedAutomationRunsInput): AutomationRunListResponse;
}

function requireProjectAutomation(
  db: Db,
  args: { projectId: string; automationId: string },
): AutomationRow {
  const automation = getAutomationForProject(db, args);
  if (!automation) throw new Error("Automation not found");
  return automation;
}

function validateTrigger(
  trigger: ResolvedCreateAutomationInput["trigger"],
  now = Date.now(),
): void {
  if (trigger.triggerType === "schedule") {
    validateScheduleDefinition({
      cron: trigger.cron,
      timezone: trigger.timezone,
    });
  } else {
    validateOnceDefinition({ runAt: trigger.runAt, now });
  }
}

function computeNextRunAt(
  trigger: ResolvedCreateAutomationInput["trigger"],
  now: number,
): number {
  if (trigger.triggerType === "once") {
    validateTrigger(trigger, now);
    return trigger.runAt;
  }
  return computeNextScheduledTime({
    cron: trigger.cron,
    timezone: trigger.timezone,
    now,
  });
}

function assertNotRecursiveCreation(
  db: Db,
  createdByThreadId: string | undefined,
): void {
  if (createdByThreadId === undefined) return;
  if (isAutomationSpawnedThread(db, createdByThreadId)) {
    throw new Error("Automation-spawned threads cannot create automations");
  }
}

type ResolvedStoredExecution = {
  execution: AutomationExecution;
  writtenScriptFile?: string;
};

async function resolveStoredExecution(args: {
  pluginDataDir: string;
  automationId: string;
  execution: AutomationExecution;
}): Promise<ResolvedStoredExecution> {
  if (args.execution.mode !== "script") {
    return { execution: args.execution };
  }
  if (args.execution.script !== undefined) {
    const scriptFile = await writeInlineAutomationScript({
      dataDir: args.pluginDataDir,
      automationId: args.automationId,
      content: args.execution.script,
      scriptFile: args.execution.scriptFile,
    });
    const { script: _script, ...rest } = args.execution;
    return {
      execution: { ...rest, scriptFile },
      writtenScriptFile: scriptFile,
    };
  }
  return { execution: args.execution };
}

async function discardUncommittedScript(args: {
  bb: Pick<ServiceApi, "log">;
  pluginDataDir: string;
  automationId: string;
  scriptFile: string | undefined;
}): Promise<void> {
  if (args.scriptFile === undefined) return;
  try {
    await deleteAutomationScriptFile({
      dataDir: args.pluginDataDir,
      automationId: args.automationId,
      scriptFile: args.scriptFile,
    });
  } catch (error) {
    args.bb.log.warn(
      `Failed to discard uncommitted script for automation ${args.automationId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Adds `storedScriptPath` (the absolute path of the private copy that runs
 * execute) to script automations that have a stored script file.
 */
function withStoredScriptPath(
  pluginDataDir: string,
  automation: AutomationResponse,
): AutomationResponse {
  if (
    automation.execution.mode !== "script" ||
    automation.execution.scriptFile === undefined
  ) {
    return automation;
  }
  return {
    ...automation,
    execution: {
      ...automation.execution,
      storedScriptPath: join(
        automationScriptDir(pluginDataDir, automation.id),
        automation.execution.scriptFile,
      ),
    },
  };
}

function toStoredAutomationResponse(
  pluginDataDir: string,
  row: AutomationRow,
): AutomationResponse {
  return withStoredScriptPath(pluginDataDir, toAutomationResponse(row));
}

async function toEditableAutomationResponse(args: {
  pluginDataDir: string;
  row: AutomationRow;
}): Promise<AutomationResponse> {
  const automation = toStoredAutomationResponse(args.pluginDataDir, args.row);
  if (
    automation.execution.mode !== "script" ||
    automation.execution.scriptFile === undefined
  ) {
    return automation;
  }
  const { scriptFile, ...execution } = automation.execution;
  return {
    ...automation,
    execution: {
      ...execution,
      script: await readAutomationScript({
        dataDir: args.pluginDataDir,
        automationId: automation.id,
        scriptFile,
      }),
    },
  };
}

async function cleanupSupersededScript(args: {
  bb: Pick<ServiceApi, "log">;
  pluginDataDir: string;
  automationId: string;
  previous: AutomationExecution;
  next: AutomationExecution;
}): Promise<void> {
  if (args.previous.mode !== "script") return;
  try {
    if (args.next.mode !== "script") {
      await deleteAutomationScriptDir({
        dataDir: args.pluginDataDir,
        automationId: args.automationId,
      });
      return;
    }
    if (
      args.previous.scriptFile !== undefined &&
      args.next.scriptFile !== undefined &&
      args.previous.scriptFile !== args.next.scriptFile
    ) {
      await deleteAutomationScriptFile({
        dataDir: args.pluginDataDir,
        automationId: args.automationId,
        scriptFile: args.previous.scriptFile,
      });
    }
  } catch (error) {
    args.bb.log.warn(
      `Failed to remove superseded script for automation ${args.automationId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function encodeRunCursor(startedAt: number, id: string): string {
  return Buffer.from(`${startedAt}:${id}`, "utf8").toString("base64url");
}

function applyAgentExecutionUpdate(
  execution: AutomationExecution,
  update: AgentExecutionUpdate,
): Extract<AutomationExecution, { mode: "agent" }> {
  if (execution.mode !== "agent") {
    throw new Error(
      "Agent execution options can only update agent automations",
    );
  }

  const next = {
    ...execution,
    ...(update.prompt !== undefined ? { prompt: update.prompt } : {}),
    ...(update.model !== undefined ? { model: update.model } : {}),
    ...(update.permissionMode !== undefined
      ? { permissionMode: update.permissionMode }
      : {}),
  };
  if (update.target === undefined) return next;
  if (update.target.type === "target-thread") {
    return { ...next, targetThreadId: update.target.threadId };
  }
  const { targetThreadId: _targetThreadId, ...withoutTargetThread } = next;
  return {
    ...withoutTargetThread,
    environment: update.target.environment,
  };
}

function parseRunCursor(
  cursor: string | undefined,
): { startedAt: number; id: string } | null {
  if (cursor === undefined) return null;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator <= 0) throw new Error("Invalid runs cursor");
  const startedAt = Number(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (!Number.isFinite(startedAt) || id.length === 0) {
    throw new Error("Invalid runs cursor");
  }
  return { startedAt, id };
}

async function projectNameById(
  bb: Pick<ServiceApi, "sdk" | "log">,
): Promise<Map<string, string>> {
  try {
    const projects = projectSummaryListSchema.parse(
      await bb.sdk.projects.list({ includePersonal: true }),
    );
    return new Map(
      projects
        .filter(
          (project) =>
            project.deletedAt === undefined || project.deletedAt === null,
        )
        .map((project) => [project.id, project.name ?? project.id]),
    );
  } catch (error) {
    bb.log.warn(
      `Failed to list projects for automations overview: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return new Map();
  }
}

const projectAvailableSchema = z.object({ id: z.string() }).passthrough();
const projectSummarySchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    deletedAt: z.number().nullable().optional(),
  })
  .passthrough();
const projectSummaryListSchema = z.array(projectSummarySchema);

async function requireProjectAvailable(
  bb: Pick<ServiceApi, "sdk">,
  projectId: string,
): Promise<void> {
  try {
    projectAvailableSchema.parse(await bb.sdk.projects.get({ projectId }));
  } catch (error) {
    throw new Error(
      `Project ${projectId} is not available: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function createAutomationService(args: {
  bb: ServiceApi;
  db: Db;
  pluginDataDir: string;
  serverUrl: string;
}): AutomationService {
  const { bb, db, pluginDataDir, serverUrl } = args;

  return {
    async overview() {
      const projects = await projectNameById(bb);
      const rows = listAllAutomations(db);
      const automations = (
        await Promise.all(
          rows.map(async (row) => {
            const projectName = projects.get(row.projectId);
            if (projects.size > 0 && projectName === undefined) return null;
            try {
              return {
                automation: toStoredAutomationResponse(pluginDataDir, row),
                project: {
                  id: row.projectId,
                  name: projectName ?? row.projectId,
                },
              };
            } catch (error) {
              bb.log.warn(
                `Skipping malformed automation ${row.id}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              return null;
            }
          }),
        )
      ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      return automationsOverviewResponseSchema.parse({ automations });
    },

    list(input) {
      return listAutomationsForProject(db, input.projectId).map((row) =>
        toStoredAutomationResponse(pluginDataDir, row),
      );
    },

    get(input) {
      return toEditableAutomationResponse({
        pluginDataDir,
        row: requireProjectAutomation(db, input),
      });
    },

    async executionOptions(input) {
      const automation = requireProjectAutomation(db, input);
      const execution = parseAutomationExecution(automation.execution);
      if (execution.mode !== "agent") {
        throw new Error(
          "Execution options are only available for agent automations",
        );
      }
      const routing = providerRoutingForEnvironment(execution.environment);
      const loadModels = bb.sdk.providers.models;
      if (loadModels === undefined) {
        throw new Error("Provider model discovery is unavailable.");
      }
      const options = await loadModels({
        ...routing,
        providerId: execution.providerId,
      });
      const provider = options.providers.find(
        (candidate) => candidate.id === execution.providerId,
      );
      if (provider === undefined || !provider.available) {
        throw new Error(`Provider ${execution.providerId} is not available.`);
      }
      const seenModels = new Set<string>();
      const models = [...options.selectedOnlyModels, ...options.models]
        .filter((model) => {
          if (seenModels.has(model.model)) return false;
          seenModels.add(model.model);
          return true;
        })
        .map(({ id, model, displayName }) => ({ id, model, displayName }));
      const permissionModes = provider.capabilities.permissionModes;
      return { models, permissionModes };
    },

    async permissionOptions(input) {
      const automation = requireProjectAutomation(db, input);
      const execution = parseAutomationExecution(automation.execution);
      if (execution.mode !== "agent") {
        throw new Error(
          "Permission options are only available for agent automations",
        );
      }
      const environment = execution.environment;
      const routing =
        environment.type === "reuse"
          ? { environmentId: environment.environmentId }
          : environment.type === "host" && environment.hostId !== undefined
            ? { hostId: environment.hostId }
            : {};
      const providers = await bb.sdk.providers.list(routing);
      const provider = providers.find(
        (candidate) => candidate.id === execution.providerId,
      );
      if (provider === undefined || provider.available === false) {
        throw new Error(`Provider ${execution.providerId} is not available.`);
      }
      return {
        permissionModes: provider.capabilities.permissionModes,
      };
    },

    async create(payload) {
      await requireProjectAvailable(bb, payload.projectId);
      const now = Date.now();
      validateTrigger(payload.trigger, now);
      assertNotRecursiveCreation(db, payload.createdByThreadId);
      if (payload.execution.mode === "agent") {
        await resolvePermissionMode(
          bb,
          payload.execution.providerId,
          payload.execution.permissionMode,
          providerRoutingForEnvironment(payload.execution.environment),
        );
      }
      const automationId = createAutomationId();
      const stored = await resolveStoredExecution({
        pluginDataDir,
        automationId,
        execution: payload.execution,
      });
      let created: AutomationRow;
      try {
        created = createAutomation(db, {
          id: automationId,
          projectId: payload.projectId,
          name: payload.name,
          enabled: payload.enabled,
          trigger: payload.trigger,
          runMode: stored.execution.mode,
          execution: stored.execution,
          origin: payload.origin,
          createdByThreadId: payload.createdByThreadId ?? null,
          nextRunAt: computeInitialNextRunAt({
            trigger: payload.trigger,
            enabled: payload.enabled,
            now,
          }),
        });
      } catch (error) {
        await discardUncommittedScript({
          bb,
          pluginDataDir,
          automationId,
          scriptFile: stored.writtenScriptFile,
        });
        throw error;
      }
      publishAutomationChange(bb, payload.projectId, "automations-changed");
      return toStoredAutomationResponse(pluginDataDir, created);
    },

    async update(input) {
      await requireProjectAvailable(bb, input.projectId);
      const current = requireProjectAutomation(db, input);
      if (input.execution !== undefined && input.agent !== undefined) {
        throw new Error("execution and agent updates cannot be combined");
      }
      const now = Date.now();
      const currentExecution = parseAutomationExecution(current.execution);
      let stagedScriptFile: string | undefined;
      const patch: Parameters<typeof updateAutomation>[1]["patch"] = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.trigger !== undefined) {
        validateTrigger(input.trigger, now);
        patch.trigger = input.trigger;
        patch.nextRunAt = current.enabled
          ? computeNextRunAt(input.trigger, now)
          : null;
      }
      if (input.execution !== undefined) {
        if (input.execution.mode === "agent") {
          await resolvePermissionMode(
            bb,
            input.execution.providerId,
            input.execution.permissionMode,
            providerRoutingForEnvironment(input.execution.environment),
          );
        }
        const stored = await resolveStoredExecution({
          pluginDataDir,
          automationId: current.id,
          execution: input.execution,
        });
        patch.execution = stored.execution;
        stagedScriptFile = stored.writtenScriptFile;
      }
      if (input.agent !== undefined) {
        const updatedExecution = applyAgentExecutionUpdate(
          currentExecution,
          input.agent,
        );
        if (input.agent.permissionMode !== undefined) {
          if (currentExecution.mode !== "agent") {
            throw new Error(
              "Agent execution options can only update agent automations",
            );
          }
          await resolvePermissionMode(
            bb,
            updatedExecution.providerId,
            input.agent.permissionMode,
            providerRoutingForEnvironment(updatedExecution.environment),
          );
        }
        patch.execution = updatedExecution;
      }
      let updated: AutomationRow | null;
      try {
        updated = updateAutomation(db, {
          projectId: input.projectId,
          automationId: input.automationId,
          patch,
        });
      } catch (error) {
        await discardUncommittedScript({
          bb,
          pluginDataDir,
          automationId: current.id,
          scriptFile: stagedScriptFile,
        });
        throw error;
      }
      if (!updated) {
        await discardUncommittedScript({
          bb,
          pluginDataDir,
          automationId: current.id,
          scriptFile: stagedScriptFile,
        });
        throw new Error("Automation not found");
      }
      if (patch.execution !== undefined) {
        await cleanupSupersededScript({
          bb,
          pluginDataDir,
          automationId: current.id,
          previous: currentExecution,
          next: patch.execution,
        });
      }
      publishAutomationChange(bb, input.projectId, "automations-changed");
      return toStoredAutomationResponse(pluginDataDir, updated);
    },

    async delete(input) {
      const automation = requireProjectAutomation(db, input);
      deleteAutomation(db, input);
      await deleteAutomationScriptDir({
        dataDir: pluginDataDir,
        automationId: automation.id,
      });
      publishAutomationChange(bb, input.projectId, [
        "automations-changed",
        "automation-runs-changed",
      ]);
      return { ok: true };
    },

    pause(input) {
      const current = requireProjectAutomation(db, input);
      const updated = setAutomationEnabled(db, {
        projectId: input.projectId,
        automationId: current.id,
        enabled: false,
        nextRunAt: null,
      });
      if (!updated) throw new Error("Automation not found");
      publishAutomationChange(bb, input.projectId, "automations-changed");
      return toStoredAutomationResponse(pluginDataDir, updated);
    },

    resume(input) {
      const current = requireProjectAutomation(db, input);
      const trigger = parseAutomationTrigger(current.triggerConfig);
      const now = Date.now();
      validateTrigger(trigger, now);
      const updated = setAutomationEnabled(db, {
        projectId: input.projectId,
        automationId: current.id,
        enabled: true,
        nextRunAt: computeNextRunAt(trigger, now),
        lastError: null,
        resetConsecutiveFailures: true,
      });
      if (!updated) throw new Error("Automation not found");
      publishAutomationChange(bb, input.projectId, "automations-changed");
      return toStoredAutomationResponse(pluginDataDir, updated);
    },

    async run(input) {
      const automation = requireProjectAutomation(db, input);
      const execution = parseAutomationExecution(automation.execution);
      const now = Date.now();
      const { run, deduped } = createManualRun(db, {
        automationId: automation.id,
        runMode: automation.runMode,
        idempotencyKey: input.idempotencyKey ?? null,
        now,
      });
      if (!deduped) {
        publishAutomationChange(bb, input.projectId, "automation-runs-changed");
        const closeFailedRun = (error: unknown): void => {
          closeAutomationRun(db, {
            runId: run.id,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            now: Date.now(),
          });
        };
        void (async () => {
          try {
            if (execution.mode === "agent") {
              await executeAgentRun(bb, db, {
                automation,
                run,
                execution,
                onFailure: closeFailedRun,
              });
            } else {
              await executeScriptRun(bb, db, {
                pluginDataDir,
                automation,
                run,
                execution,
                onFailure: closeFailedRun,
                serverUrl,
              });
            }
          } catch (error) {
            closeFailedRun(error);
            bb.log.error(
              `Manual automation run ${run.id} failed unexpectedly: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            publishAutomationChange(bb, input.projectId, [
              "automations-changed",
              "automation-runs-changed",
            ]);
          }
        })();
      }
      return { run: toAutomationRunResponse(run) };
    },

    runs(input) {
      requireProjectAutomation(db, input);
      const limit = Math.min(input.limit, AUTOMATION_RUNS_LIMIT_MAX);
      const runs = listAutomationRuns(db, {
        automationId: input.automationId,
        limit: limit + 1,
        cursor: parseRunCursor(input.cursor),
      });
      const hasMore = runs.length > limit;
      const page = hasMore ? runs.slice(0, limit) : runs;
      const last = page[page.length - 1];
      return automationRunListResponseSchema.parse({
        runs: page.map(toAutomationRunResponse),
        nextCursor:
          hasMore && last ? encodeRunCursor(last.startedAt, last.id) : null,
      });
    },
  };
}
