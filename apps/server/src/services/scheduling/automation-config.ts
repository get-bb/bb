import type { AutomationRow, AutomationRunRow } from "@bb/db";
import {
  automationExecutionSchema,
  automationRunSchema,
  automationSchema,
  automationTriggerSchema,
  environmentArgsSchema,
  type Automation,
  type AutomationExecution,
  type AutomationRun,
  type AutomationTrigger,
  type EnvironmentArgs,
} from "@bb/server-contract";
import { parseJsonWithSchema } from "../lib/json-parsing.js";

export interface ParsedAutomationDefinition {
  trigger: AutomationTrigger;
  execution: AutomationExecution;
  environment: EnvironmentArgs;
}

export function parseAutomationTrigger(triggerConfig: string): AutomationTrigger {
  return parseJsonWithSchema(triggerConfig, automationTriggerSchema);
}

export function parseAutomationExecution(
  execution: string,
): AutomationExecution {
  return parseJsonWithSchema(execution, automationExecutionSchema);
}

export function parseAutomationEnvironment(
  environment: string,
): EnvironmentArgs {
  return parseJsonWithSchema(environment, environmentArgsSchema);
}

export function parseAutomationDefinition(
  row: Pick<AutomationRow, "triggerConfig" | "execution" | "environment">,
): ParsedAutomationDefinition {
  return {
    trigger: parseAutomationTrigger(row.triggerConfig),
    execution: parseAutomationExecution(row.execution),
    environment: parseAutomationEnvironment(row.environment),
  };
}

export function serializeAutomationTrigger(trigger: AutomationTrigger): string {
  return JSON.stringify(trigger);
}

export function serializeAutomationEnvironment(
  environment: EnvironmentArgs,
): string {
  return JSON.stringify(environment);
}

/**
 * Stored execution never carries inline script content; the content lives on disk
 * under `<dataDir>/automation-scripts/<id>/`. The stored shape carries `scriptFile`
 * (the relative file name) and the resolved `interpreter`/`timeoutMs`/`env`.
 */
export function serializeAutomationExecution(
  execution: AutomationExecution,
): string {
  return JSON.stringify(execution);
}

export function toAutomationResponse(row: AutomationRow): Automation {
  const definition = parseAutomationDefinition(row);
  return automationSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    enabled: row.enabled,
    trigger: definition.trigger,
    execution: definition.execution,
    environment: definition.environment,
    autoArchive: row.autoArchive,
    origin: row.origin,
    createdByThreadId: row.createdByThreadId,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    runCount: row.runCount,
    lastRunStatus: row.lastRunStatus,
    lastRunThreadId: row.lastRunThreadId,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toAutomationRunResponse(row: AutomationRunRow): AutomationRun {
  return automationRunSchema.parse({
    id: row.id,
    automationId: row.automationId,
    runMode: row.runMode,
    threadId: row.threadId,
    status: row.status,
    trigger: row.trigger,
    skipReason: row.skipReason,
    error: row.error,
    output: row.output,
    exitCode: row.exitCode,
    scheduledFor: row.scheduledFor,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  });
}
