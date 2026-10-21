import { buildExecutionOptions } from "../../services/threads/thread-commands.js";
import { z } from "zod";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { NextStep, NextStepResult } from "@bb/domain";
import type { Hono } from "hono";
import {
  APP_SURFACE_HEADER_NAME,
  parseRequestAppSurface,
} from "@bb/config/app-surface";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import type { PluginService } from "../../services/plugins/plugin-service.js";
import { createThreadFromRequest } from "../../services/threads/thread-create.js";
import {
  acceptNextStep,
  dismissNextStep,
  getNextStep,
  linkNextStepResult,
  proposeNextStep,
  showNextStep,
  undoNextStep,
} from "../../services/threads/next-step.js";

async function callNextStepPlugin(
  plugins: PluginService,
  method: string,
  input: unknown,
  pluginId = "automations",
) {
  const lookup = plugins.getRpcHandler(pluginId, method);
  if (lookup.outcome !== "found")
    throw new ApiError(
      409,
      pluginId === "automations"
        ? "next_step_automations_unavailable"
        : "next_step_notifications_unavailable",
      pluginId === "automations"
        ? "Enable Automations to start this next step"
        : "Enable Notifications to cancel this reminder",
    );
  const result = await plugins.invokeRpcHandler(
    pluginId,
    method,
    lookup.value,
    input,
    { kind: "client" },
  );
  if (!result.ok)
    throw new ApiError(
      409,
      "next_step_automation_failed",
      result.error.message,
    );
  return result.result;
}

async function executeNextStep(
  deps: AppDeps,
  plugins: PluginService,
  suggestion: NextStep,
  acceptedAt: number,
): Promise<NextStepResult> {
  const thread = requirePublicThread(deps.db, suggestion.threadId);
  if (thread.environmentId === null)
    throw new ApiError(
      409,
      "next_step_environment_unavailable",
      "This thread needs an environment before starting the next step",
    );
  const execution = await buildExecutionOptions(
    deps,
    {},
    { threadId: thread.id },
  );
  if (suggestion.action.kind === "task") {
    const child = await createThreadFromRequest(deps, {
      projectId: thread.projectId,
      providerId: thread.providerId,
      parentThreadId: thread.id,
      title: suggestion.title,
      ...execution,
      origin: "app",
      startedOnBehalfOf: null,
      environment: { type: "reuse", environmentId: thread.environmentId },
      input: [
        {
          type: "text",
          text: suggestion.action.task.parallel
            ? `${suggestion.action.task.prompt}\n\nThis work may run in parallel. If independent subtasks need separate threads, create them under parent thread ${thread.id}.`
            : suggestion.action.task.prompt,
          mentions: [],
        },
      ],
    });
    const result: NextStepResult = { kind: "task", threadIds: [child.id] };
    linkNextStepResult(deps.db, { threadId: thread.id, result });
    return result;
  }
  const automation = suggestion.action.automation;
  const response = await callNextStepPlugin(plugins, "automations_create", {
    projectId: thread.projectId,
    name: suggestion.title,
    origin: "app",
    createdByThreadId: thread.id,
    enabled: false,
    trigger: { triggerType: "once", runAt: automation.schedule.runAt },
    execution: {
      mode: "agent",
      prompt: automation.prompt,
      providerId: thread.providerId,
      model: execution.model,
      reasoningLevel: execution.reasoningLevel,
      permissionMode: execution.permissionMode,
      environment: { type: "reuse", environmentId: thread.environmentId },
      resultNotificationKind: "day2_result",
      day2ResultDelivery: { acceptedAt, deliverAt: automation.schedule.runAt },
    },
  });
  const result: NextStepResult = {
    kind: "automation",
    automationId: z.object({ id: z.string() }).parse(response).id,
  };
  linkNextStepResult(deps.db, { threadId: thread.id, result });
  await callNextStepPlugin(plugins, "automations_run", {
    projectId: thread.projectId,
    automationId: result.automationId,
    idempotencyKey: suggestion.id,
  });
  return result;
}

export function registerNextStepRoutes(
  app: Hono,
  deps: AppDeps,
  plugins: PluginService,
): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.threads;
  get(routes.nextStep, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(getNextStep(deps.db, thread.id));
  });
  post(routes.proposeNextStep, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      await proposeNextStep(deps, { threadId: thread.id, ...payload }),
    );
  });
  post(routes.showNextStep, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const surface = parseRequestAppSurface(
      context.req.header(APP_SURFACE_HEADER_NAME),
    );
    if (surface !== "desktop" && surface !== "web")
      return context.json(getNextStep(deps.db, thread.id));
    const result = showNextStep(deps.db, { threadId: thread.id });
    if (result.newlyShown && result.suggestion)
      deps.telemetry.capture({
        name: "suggestion_shown",
        properties: {
          surface: "next_step",
          kind: result.suggestion.action.kind,
          trigger: "agent",
          suggestion_analytics_id: result.suggestion.analyticsId,
        },
      });
    return context.json(result.suggestion);
  });
  post(routes.acceptNextStep, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const suggestion = getNextStep(deps.db, thread.id);
    if (suggestion?.status === "proposed") {
      if (thread.environmentId === null) {
        throw new ApiError(
          409,
          "next_step_environment_unavailable",
          "This thread needs an environment before starting the next step",
        );
      }
      if (
        suggestion.action.kind === "automation" &&
        ["automations_create", "automations_run"].some(
          (method) =>
            plugins.getRpcHandler("automations", method).outcome !== "found",
        )
      ) {
        throw new ApiError(
          409,
          "next_step_automations_unavailable",
          "Enable Automations to start this next step",
        );
      }
      await buildExecutionOptions(deps, {}, { threadId: thread.id });
    }
    const result = await acceptNextStep(deps.db, {
      threadId: thread.id,
      execute: (suggestion, acceptedAt) =>
        executeNextStep(deps, plugins, suggestion, acceptedAt),
    });
    if (result.newlyAccepted)
      deps.telemetry.capture({
        name: "suggestion_accepted",
        properties: {
          surface: "next_step",
          kind: result.suggestion.action.kind,
          suggestion_analytics_id: result.suggestion.analyticsId,
        },
      });
    return context.json(result.suggestion);
  });
  post(routes.dismissNextStep, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const result = dismissNextStep(deps.db, thread.id);
    if (result.newlyDismissed)
      deps.telemetry.capture({
        name: "suggestion_dismissed",
        properties: {
          surface: "next_step",
          kind: result.suggestion.action.kind,
          suggestion_analytics_id: result.suggestion.analyticsId,
          dismiss: "this_thread",
        },
      });
    return context.json(result.suggestion);
  });
  post(routes.undoNextStep, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      await undoNextStep(deps.db, {
        threadId: thread.id,
        undo: async (automationId) => {
          await callNextStepPlugin(
            plugins,
            "experimental_cancelDay2Result",
            { automationId },
            "push-notifications",
          );
          await callNextStepPlugin(plugins, "automations_delete", {
            projectId: thread.projectId,
            automationId,
          });
        },
      }),
    );
  });
}
